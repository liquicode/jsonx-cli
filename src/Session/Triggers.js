'use strict';

/*
	Triggers, as a jsonstor storage filter (spec section 13).

	Lifted from jsonx-studio's src/Studio/Triggers.js, which carries the reasoning: a trigger
	runtime is a filter; an insert's documents are its arguments, a find's are its result, and an
	update's, replace's or delete's are whatever its criteria selects, captured before the call.

	What changed from Studio, to the specification:

	-	***A trigger names a Process***, and the Process's Criteria decides which documents it runs
		for (13.2). There is no trigger Condition.
	-	***A trigger does not fire while its own Process is running*** (13.7; user, 2026-09-13).
		Studio passed every call made inside any trigger straight through; here, every other
		trigger on the data source still fires. The rule is finite: the set of running Processes
		can only grow to the number of Processes.
	-	***A Before trigger on an insert can change the document stored*** (13.5): the document the
		run ends with is what the insert receives.
	-	***A trigger fires on an operation, not on a function*** (13.3; user, 2026-09-18): `On` says
		Insert, Find, Update or Delete, and a call fires the triggers whose `On` holds the operation
		the call belongs to (`Names.TRIGGER_OPERATIONS`). Which of a pair the runner calls - a
		DeleteOne for a first-only Delete - is nothing a person says or can predict. Where a call's
		documents come from is still the function's own (`WATCHED_FUNCTIONS`).
	-	***Before is a gate, and After is a consequence*** (13.5; user, 2026-09-18). Every Before
		trigger runs for every document the call will touch before the storage is called, and a
		Process which fails refuses the whole call. ***A call which touches one document is gated on
		that one***, the storage's own first match: Studio, and this filter until that day, ran a
		first-only Delete's trigger for every document its criteria selected, the one it removed
		and the ones it did not. A gate on an Update is shown the update and the document as it
		would become (`Event.Update`, `Event.Proposed`), which jsongin works out as it does for
		every storage.
	-	***An After trigger runs for what the storage says it touched*** (user, 2026-09-18): the
		filter asks an update, a replace or a delete for its documents (`ReturnDocuments`) and hands
		the caller the count it asked for. Nothing is captured and read back, so a document an
		update moved out of its own criteria is still seen. ***What "touched" means is the
		storage's answer***: jsonstor's UpdateMany answers the documents it matched, changed or
		not (its story, open since 2026-09-13), and this filter inherits that until it is mended.
	-	***An After trigger cannot refuse***: the write was made and stands (6.7), so its failure
		fails the object which made the call and says that the write was made.
	-	***A triggered Process which fails fails the storage call*** that fired it, so the object
		making the call fails and says why (6.7). Studio reported and swallowed it.

	The session supplies the running: Settings.Session is

		{
			ProcessFor( Trigger )                  -> the Process object, or null
			IsActive( ProcessName )                -> whether that Process is running now
			RunTriggered( Trigger, Process, Input ) -> the finished run; throws on failure
		}
*/

const jsongin = require( '@liquicode/jsongin' );

const Names = require( '../File/Names.js' );


const FILTER_NAME = 'jsonx-triggers';

const WATCHED_FUNCTIONS = {
	InsertOne: 'arguments',
	InsertMany: 'arguments',
	FindOne: 'result',
	FindMany: 'result',
	FindMany2: 'result',
	UpdateOne: 'criteria',
	UpdateMany: 'criteria',
	ReplaceOne: 'criteria',
	DeleteOne: 'criteria',
	DeleteMany: 'criteria',
};

// The calls which touch one document of those their criteria selects: the first the storage finds.
const ONE_DOCUMENT_FUNCTIONS = [ 'UpdateOne', 'ReplaceOne', 'DeleteOne' ];

// Where each of the criteria calls takes its Options, which is its last parameter.
const OPTIONS_INDEX = { UpdateOne: 2, UpdateMany: 2, ReplaceOne: 2, DeleteOne: 1, DeleteMany: 1 };


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function as_document_array( Value )
{
	if ( Array.isArray( Value ) ) { return Value; }
	if ( is_object( Value ) ) { return [ Value ]; }
	return [];
}

function clone( Value )
{
	return ( typeof Value === 'undefined' ) ? undefined : JSON.parse( JSON.stringify( Value ) );
}


//---------------------------------------------------------------------
function primary_key_fields( Storage )
{
	if ( is_object( Storage.PrimaryKeyInfo ) && Array.isArray( Storage.PrimaryKeyInfo.Fields ) && Storage.PrimaryKeyInfo.Fields.length > 0 )
	{
		return Storage.PrimaryKeyInfo.Fields;
	}
	return [ '_id' ];
}


//---------------------------------------------------------------------
// A criteria selecting exactly these documents by their identifiers, or null.

function CriteriaForDocuments( Documents, KeyFields )
{
	if ( Documents.length === 0 ) { return null; }

	if ( KeyFields.length === 1 )
	{
		let field = KeyFields[ 0 ];
		let values = [];
		for ( let index = 0; index < Documents.length; index++ )
		{
			let value = jsongin.GetValue( Documents[ index ], field );
			if ( typeof value !== 'undefined' ) { values.push( value ); }
		}
		if ( values.length === 0 ) { return null; }
		let criteria = {};
		criteria[ field ] = { $in: values };
		return criteria;
	}

	let branches = [];
	for ( let index = 0; index < Documents.length; index++ )
	{
		let branch = {};
		let complete = true;
		for ( let field_index = 0; field_index < KeyFields.length; field_index++ )
		{
			let value = jsongin.GetValue( Documents[ index ], KeyFields[ field_index ] );
			if ( typeof value === 'undefined' ) { complete = false; break; }
			branch[ KeyFields[ field_index ] ] = value;
		}
		if ( complete ) { branches.push( branch ); }
	}
	return ( branches.length === 0 ) ? null : { $or: branches };
}


//---------------------------------------------------------------------
// The triggers which apply to one call at one moment.

function select_triggers( Triggers, FunctionName, When )
{
	let operation = Names.OperationOf( FunctionName );
	if ( operation === null ) { return []; }
	return Triggers.filter( function ( Trigger )
	{
		if ( !Array.isArray( Trigger.On ) || !Trigger.On.includes( operation ) ) { return false; }
		return ( ( Trigger.When === 'Before' ) ? 'Before' : 'After' ) === When;
	} );
}


//---------------------------------------------------------------------
// What a Before trigger is shown of a change which has not been made yet: for an update, the
// update document and the document as it would become; for a replace, the replacement. Answers
// a function of the document, or null for a call which changes nothing a gate could compare.

function proposed_for( FunctionName, CallArguments )
{
	if ( FunctionName === 'ReplaceOne' )
	{
		return function () { return { Proposed: clone( CallArguments[ 1 ] ) }; };
	}
	if ( FunctionName !== 'UpdateOne' && FunctionName !== 'UpdateMany' ) { return null; }
	return function ( Document )
	{
		let shown = { Update: clone( CallArguments[ 1 ] ) };
		// An update jsongin refuses is one the storage refuses too, and the call will say so.
		try { shown.Proposed = jsongin.Update( clone( Document ), clone( CallArguments[ 1 ] ) ); }
		catch ( error ) { delete shown.Proposed; }
		return shown;
	};
}


//---------------------------------------------------------------------
function matches( Document, Criteria )
{
	return jsongin.Filter( [ Document ], is_object( Criteria ) ? Criteria : {} ).length === 1;
}


//---------------------------------------------------------------------
// The filter plugin. Settings: { DataSource, Triggers, Session }.

function NewTriggerFilter()
{
	return {

		FilterName: FILTER_NAME,
		FilterDescription: 'Runs a jsonx file\'s triggers when a storage call touches a document its Process selects.',

		GetFilter: function ( jsonstor, Storage, Settings )
		{
			let settings = is_object( Settings ) ? Settings : {};
			let triggers = Array.isArray( settings.Triggers ) ? settings.Triggers : [];
			let session = settings.Session;

			let filter = jsonstor.StorageInterface();
			filter.FilterName = FILTER_NAME;
			filter.Settings = settings;
			filter.Storage = Storage;


			//---------------------------------------------------------------------
			async function read_documents( Criteria )
			{
				let found = await Storage.FindMany( Criteria, null, {} );
				return as_document_array( found );
			}


			//---------------------------------------------------------------------
			// The triggers which can fire now: selected for the call, and not running already.

			function ready( FunctionName, When )
			{
				return select_triggers( triggers, FunctionName, When ).filter( function ( Trigger )
				{
					let process = session.ProcessFor( Trigger );
					return ( process !== null ) && !session.IsActive( process.Name );
				} );
			}


			//---------------------------------------------------------------------
			// Runs each trigger once per document its Process selects. Returns, for each candidate,
			// the document the last run ended with - which is how a Before trigger changes an insert.

			async function fire( FunctionName, When, Candidates, Ready, Shown )
			{
				let finals = Candidates.slice();

				for ( let trigger_index = 0; trigger_index < Ready.length; trigger_index++ )
				{
					let trigger = Ready[ trigger_index ];
					let process = session.ProcessFor( trigger );
					if ( process === null || session.IsActive( process.Name ) ) { continue; }

					for ( let index = 0; index < finals.length; index++ )
					{
						if ( !matches( finals[ index ], process.Criteria ) ) { continue; }

						let event = { Function: FunctionName, Operation: Names.OperationOf( FunctionName ), When: When, DataSource: settings.DataSource, Trigger: trigger.Name };
						if ( typeof Shown === 'function' ) { Object.assign( event, Shown( finals[ index ] ) ); }
						let input = { Document: clone( finals[ index ] ), Event: event };
						let run = await session.RunTriggered( trigger, process, input );
						if ( When === 'Before' && run && is_object( run.State ) && is_object( run.State.Document ) )
						{
							finals[ index ] = run.State.Document;
						}
					}
				}
				return finals;
			}


			//---------------------------------------------------------------------
			function wrap( FunctionName )
			{
				filter[ FunctionName ] = async function ()
				{
					let call_arguments = Array.prototype.slice.call( arguments );
					let source = WATCHED_FUNCTIONS[ FunctionName ];
					if ( typeof source === 'undefined' || !session ) { return await Storage[ FunctionName ]( ...call_arguments ); }

					let before = ready( FunctionName, 'Before' );
					let after = ready( FunctionName, 'After' );
					if ( before.length === 0 && after.length === 0 ) { return await Storage[ FunctionName ]( ...call_arguments ); }

					// What a gate is run for: the documents the call will touch, as they are now. A call
					// which touches one document touches the first the storage finds, and no other.
					let captured = [];
					if ( source === 'criteria' && before.length > 0 )
					{
						if ( ONE_DOCUMENT_FUNCTIONS.includes( FunctionName ) ) { captured = as_document_array( await Storage.FindOne( call_arguments[ 0 ], null, {} ) ); }
						else { captured = await read_documents( call_arguments[ 0 ] ); }
					}

					if ( before.length > 0 )
					{
						if ( source === 'arguments' )
						{
							let submitted = as_document_array( call_arguments[ 0 ] );
							let finals = await fire( FunctionName, 'Before', submitted, before );
							// ***The caller's documents are replaced, never edited in place***: they may be
							// the Documents array of an Insert in the file itself.
							call_arguments[ 0 ] = Array.isArray( call_arguments[ 0 ] ) ? finals : finals[ 0 ];
						}
						else
						{
							await fire( FunctionName, 'Before', captured, before, proposed_for( FunctionName, call_arguments ) );
						}
					}

					// An After trigger runs for what the storage says it touched, so the storage is asked for
					// its documents, and the caller is handed the count it asked for.
					let asked_for_documents = false;
					if ( after.length > 0 && source === 'criteria' )
					{
						let options_index = OPTIONS_INDEX[ FunctionName ];
						let options = is_object( call_arguments[ options_index ] ) ? Object.assign( {}, call_arguments[ options_index ] ) : {};
						asked_for_documents = ( options.ReturnDocuments ? true : false );
						options.ReturnDocuments = true;
						while ( call_arguments.length < options_index ) { call_arguments.push( undefined ); }
						call_arguments[ options_index ] = options;
					}

					let result = await Storage[ FunctionName ]( ...call_arguments );
					let answer = result;

					if ( after.length > 0 )
					{
						let candidates = [];
						if ( source === 'result' ) { candidates = as_document_array( result ); }
						else if ( source === 'arguments' )
						{
							let submitted = as_document_array( call_arguments[ 0 ] );
							let criteria = CriteriaForDocuments( submitted, primary_key_fields( Storage ) );
							candidates = ( criteria === null ) ? submitted : await read_documents( criteria );
							if ( candidates.length === 0 ) { candidates = submitted; }
						}
						else
						{
							// An adapter which answers a count here ignored ReturnDocuments, and nothing else
							// knows what the call touched: loud, because silence would be a trigger which never fires.
							if ( typeof result === 'number' ) { throw new Error( 'The storage answered a count where its documents were asked for (ReturnDocuments), so the triggers on [' + settings.DataSource + '] cannot know what ' + FunctionName + ' touched.' ); }
							candidates = as_document_array( result );
							if ( !asked_for_documents ) { answer = candidates.length; }
						}
						try
						{
							await fire( FunctionName, 'After', candidates, after );
						}
						catch ( error )
						{
							// ***An After trigger cannot refuse what has happened*** (13.5): the write stands, and
							// the failure says so, since there is no transaction to undo it (6.7).
							let said = String( error.message );
							if ( !said.endsWith( '.' ) ) { said += '.'; }
							let made = new Error( said + ' The ' + FunctionName + ' on [' + settings.DataSource + '] had been made, and stands: an After trigger cannot refuse what has happened (13.5).' );
							made.Code = 'TriggerFailedAfter';
							throw made;
						}
					}

					return answer;
				};
				return;
			}

			// The union of the interface and what the storage carries, so FindMany2 and any member an
			// adapter adds is forwarded (Studio's measured correction to jsonstor-oplog's list).
			let names = [];
			let candidates = Object.keys( filter ).concat( Object.keys( Storage ) );
			for ( let index = 0; index < candidates.length; index++ )
			{
				let name = candidates[ index ];
				if ( names.includes( name ) || typeof Storage[ name ] !== 'function' ) { continue; }
				names.push( name );
			}
			for ( let index = 0; index < names.length; index++ ) { wrap( names[ index ] ); }

			filter.PrimaryKeyInfo = Storage.PrimaryKeyInfo;
			filter.AdapterName = Storage.AdapterName;
			filter.DialectVersion = Storage.DialectVersion;

			return filter;
		},
	};
}


//---------------------------------------------------------------------
module.exports = {
	FILTER_NAME: FILTER_NAME,
	WATCHED_FUNCTIONS: WATCHED_FUNCTIONS,
	CriteriaForDocuments: CriteriaForDocuments,
	NewTriggerFilter: NewTriggerFilter,
};
