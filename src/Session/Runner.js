'use strict';

/*
	The runner: runs one object of a jsonx file by name (spec sections 6, 8-12).

	***Each run returns a report, and an object failing is a report, not an exception.***

		{ Name, Kind, Ok, Result, Summary, Ms, Error, Calls: [ report ], Fired: [ report ], Statistics: [ ... ] }

	Calls holds the runs of the objects a Process called, in order; Fired holds the runs of the
	Processes triggers started because of this object's storage calls. A report is built as the
	run goes, so a failure deep inside still leaves every earlier run in the tree.

	***The result of each kind is spec 6.3's.*** An Update reports `{ Selected, Changed }`, and
	Changed is measured rather than taken from jsonstor: UpdateMany answers how many documents it
	matched, including those it set to the value they already held (measured 2026-09-13). The
	selected documents are read before the update and read back by primary key after it, as
	jsonx-studio's Execute.js did.

	***A Process calls an object by naming it in `$call`*** (12.8), and the call's answer is that
	object's result. A failure of the object is a failure of the step, which a `$try` can catch.

	***Every storage call goes through call_storage.*** With Statistics on, it asks jsonstor for the
	call's measurement (`Options.Statistics`), unwraps `{ Result, Statistics }`, and records the
	measurement on the report of the object which made the call.
*/

const jsongin = require( '@liquicode/jsongin' );

const Names = require( '../File/Names.js' );
const Triggers = require( './Triggers.js' );


// Each host function's parameters, in order, under the Storage Interface's names (spec 12.7).
// Options, the last parameter of each, is never taken from a process.
const HOST_PARAMETERS = {
	Count: [ 'Criteria' ],
	FindOne: [ 'Criteria', 'Projection' ],
	FindMany: [ 'Criteria', 'Projection' ],
	FindMany2: [ 'Criteria', 'Projection', 'Sort', 'Paging' ],
	InsertOne: [ 'Document' ],
	InsertMany: [ 'Documents' ],
	UpdateOne: [ 'Criteria', 'Updates' ],
	UpdateMany: [ 'Criteria', 'Updates' ],
	ReplaceOne: [ 'Criteria', 'Document' ],
	DeleteOne: [ 'Criteria' ],
	DeleteMany: [ 'Criteria' ],
};


//---------------------------------------------------------------------
class RunError extends Error
{
	constructor( Message, Code )
	{
		super( Message );
		this.name = 'RunError';
		this.Code = Code || 'RunFailed';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return ( typeof Value === 'undefined' ) ? undefined : JSON.parse( JSON.stringify( Value ) );
}

function plural( Count, Word )
{
	return Count + ' ' + Word + ( Count === 1 ? '' : 's' );
}


//---------------------------------------------------------------------
// Options:
//		Document      the jsonx file
//		DataSources   the session's data sources (DataSources.js)
//		Host          the process host (Host.js)
//		Statistics    true to measure every storage call

function NewRunner( Options )
{
	let options = is_object( Options ) ? Options : {};

	let runner = {
		Document: options.Document,
		DataSources: options.DataSources,
		Host: options.Host,
		Statistics: ( options.Statistics === true ),

		// The reports of the objects running now, outermost first.
		Stack: [],

		// The names of the Processes running now, for the trigger guard (13.7).
		ActiveProcesses: [],

		// Firings with no object running, such as a storage call made from outside a run.
		Fired: [],
	};


	//---------------------------------------------------------------------
	function object_named( Name )
	{
		let item = Names.FindEntry( runner.Document, Name );
		if ( item === null || item.Section !== 'Objects' ) { return null; }
		return item.Entry;
	}


	//---------------------------------------------------------------------
	function new_report( Name, Kind )
	{
		return { Name: Name, Kind: Kind, Ok: true, Result: undefined, Summary: '', Ms: 0, Error: null, Calls: [], Fired: [], Statistics: [] };
	}


	//---------------------------------------------------------------------
	// One storage call on a data source, measured when Statistics is on.

	async function call_storage( DataSourceName, FunctionName, Parameters )
	{
		let storage = runner.DataSources.Open( DataSourceName );
		if ( !runner.Statistics ) { return await storage[ FunctionName ]( ...Parameters ); }

		let options_index = HOST_PARAMETERS[ FunctionName ].length;
		let parameters = Parameters.slice( 0, options_index );
		while ( parameters.length < options_index ) { parameters.push( null ); }
		parameters.push( { Statistics: true } );

		let answer = await storage[ FunctionName ]( ...parameters );
		if ( !is_object( answer ) || typeof answer.Statistics === 'undefined' || !Object.prototype.hasOwnProperty.call( answer, 'Result' ) ) { return answer; }

		let report = runner.Stack[ runner.Stack.length - 1 ];
		if ( report ) { report.Statistics.push( Object.assign( { Function: FunctionName, DataSource: DataSourceName }, answer.Statistics ) ); }
		return answer.Result;
	}


	//---------------------------------------------------------------------
	// Runs an object by name. Input is the starting document of a Process with no DataSource.

	runner.RunObject = async function ( Name, Input )
	{
		let entry = object_named( Name );
		let report = new_report( Name, entry ? entry.Kind : null );

		let parent = runner.Stack[ runner.Stack.length - 1 ];
		if ( parent ) { parent.Calls.push( report ); }

		let started = Date.now();
		runner.Stack.push( report );
		try
		{
			if ( entry === null ) { throw new RunError( 'No object is named [' + Name + '] (3.8).', 'NoSuchObject' ); }
			await run_kind( entry, report, Input );
		}
		catch ( error )
		{
			report.Ok = false;
			report.Result = undefined;
			report.Error = { Code: error.Code || 'RunFailed', Message: error.message };
		}
		finally
		{
			runner.Stack.pop();
			report.Ms = Date.now() - started;
		}
		return report;
	};


	//---------------------------------------------------------------------
	async function run_kind( Entry, Report, Input )
	{
		if ( Entry.Kind === 'Insert' ) { return await run_insert( Entry, Report ); }
		if ( Entry.Kind === 'Query' ) { return await run_query( Entry, Report ); }
		if ( Entry.Kind === 'Update' ) { return await run_update( Entry, Report ); }
		if ( Entry.Kind === 'Delete' ) { return await run_delete( Entry, Report ); }
		if ( Entry.Kind === 'Process' ) { return await run_process( Entry, Report, Input ); }
		throw new RunError( 'The object [' + Entry.Name + '] has no Kind a runner knows (5.2).', 'BadObject' );
	}


	//---------------------------------------------------------------------
	async function insert_into( Name, Documents )
	{
		if ( Documents.length === 0 ) { return 0; }
		return await call_storage( Name, 'InsertMany', [ clone( Documents ) ] );
	}


	//---------------------------------------------------------------------
	// Spec 8.3.

	async function run_insert( Entry, Report )
	{
		let inserted = await call_storage( Entry.DataSource, 'InsertMany', [ clone( Entry.Documents ) ] );
		Report.Result = inserted;
		Report.Summary = 'inserted ' + inserted;
		return;
	}


	//---------------------------------------------------------------------
	// Spec 9.5 and 6.5.

	async function run_query( Entry, Report )
	{
		let paging = null;
		if ( typeof Entry.SkipCount !== 'undefined' || typeof Entry.MaxCount !== 'undefined' )
		{
			paging = {};
			if ( typeof Entry.SkipCount !== 'undefined' ) { paging.SkipCount = Entry.SkipCount; }
			if ( typeof Entry.MaxCount !== 'undefined' ) { paging.MaxCount = Entry.MaxCount; }
		}

		let rows = await call_storage( Entry.DataSource, 'FindMany2', [ Entry.Criteria, Entry.Projection || null, Entry.Sort || null, paging ] );
		rows = Array.isArray( rows ) ? rows : [];

		Report.Result = rows;
		Report.Summary = plural( rows.length, 'row' );
		if ( typeof Entry.Into === 'string' )
		{
			await insert_into( Entry.Into, rows );
			Report.Summary += ', into ' + Entry.Into;
		}
		return;
	}


	//---------------------------------------------------------------------
	// Spec 10.4, with Changed measured.

	async function run_update( Entry, Report )
	{
		let storage = runner.DataSources.Open( Entry.DataSource );
		let first_only = ( Entry.FirstOnly === true );

		let before = await call_storage( Entry.DataSource, 'FindMany', [ Entry.Criteria, null ] );
		before = Array.isArray( before ) ? before : [];
		if ( first_only ) { before = before.slice( 0, 1 ); }

		let selected = await call_storage( Entry.DataSource, first_only ? 'UpdateOne' : 'UpdateMany', [ Entry.Criteria, clone( Entry.Update ) ] );

		let changed = selected;
		let key_fields = ( is_object( storage.PrimaryKeyInfo ) && Array.isArray( storage.PrimaryKeyInfo.Fields ) && storage.PrimaryKeyInfo.Fields.length > 0 )
			? storage.PrimaryKeyInfo.Fields : [ '_id' ];
		let criteria = Triggers.CriteriaForDocuments( before, key_fields );

		if ( criteria !== null )
		{
			let after = await call_storage( Entry.DataSource, 'FindMany', [ criteria, null ] );
			after = Array.isArray( after ) ? after : [];
			changed = 0;
			for ( let index = 0; index < before.length; index++ )
			{
				let key = JSON.stringify( key_fields.map( function ( Field ) { return jsongin.GetValue( before[ index ], Field ); } ) );
				let now = after.find( function ( Document )
				{
					return JSON.stringify( key_fields.map( function ( Field ) { return jsongin.GetValue( Document, Field ); } ) ) === key;
				} );
				if ( !now || !jsongin.StrictEquals( before[ index ], now ) ) { changed++; }
			}
		}

		Report.Result = { Selected: selected, Changed: changed };
		Report.Summary = 'selected ' + selected + ', changed ' + changed;
		return;
	}


	//---------------------------------------------------------------------
	// Spec 11.3.

	async function run_delete( Entry, Report )
	{
		let removed = await call_storage( Entry.DataSource, ( Entry.FirstOnly === true ) ? 'DeleteOne' : 'DeleteMany', [ Entry.Criteria ] );
		Report.Result = removed;
		Report.Summary = 'removed ' + removed;
		return;
	}


	//---------------------------------------------------------------------
	// Spec 12.3-12.5, 12.10 and 6.5.

	async function run_process( Entry, Report, Input )
	{
		if ( typeof Entry.DataSource !== 'string' )
		{
			let start = is_object( Input ) ? clone( Input ) : {};
			let run = await RunProcessOnce( Entry, start );
			Report.Result = run.Result;
			Report.Summary = 'ran once';
			if ( typeof Entry.Into === 'string' && is_object( run.Result ) )
			{
				await insert_into( Entry.Into, [ run.Result ] );
				Report.Summary += ', into ' + Entry.Into;
			}
			return;
		}

		let documents = await call_storage( Entry.DataSource, 'FindMany2', [ is_object( Entry.Criteria ) ? Entry.Criteria : {}, null, null, null ] );
		documents = Array.isArray( documents ) ? documents : [];

		let results = [];
		let inserted = 0;
		for ( let index = 0; index < documents.length; index++ )
		{
			let run = await RunProcessOnce( Entry, { Document: documents[ index ] } );
			results.push( run.Result );
			if ( typeof Entry.Into === 'string' && is_object( run.Result ) )
			{
				inserted += await insert_into( Entry.Into, [ run.Result ] );
			}
			Report.Result = results;
		}

		Report.Result = results;
		Report.Summary = 'ran ' + documents.length;
		if ( typeof Entry.Into === 'string' ) { Report.Summary += ', into ' + Entry.Into + ' ' + inserted; }
		return;
	}


	//---------------------------------------------------------------------
	// One run of a Process from a starting document. Returns the finished run; throws when it
	// failed.

	async function RunProcessOnce( Entry, Start )
	{
		runner.ActiveProcesses.push( Entry.Name );
		let run = null;
		try
		{
			run = await runner.Host.Run( Entry, Start, service_call );
		}
		catch ( error )
		{
			throw new RunError( 'jsonproc refused the Process [' + Entry.Name + ']: ' + error.message, 'BadProcess' );
		}
		finally
		{
			runner.ActiveProcesses.splice( runner.ActiveProcesses.lastIndexOf( Entry.Name ), 1 );
		}

		if ( run.Status !== 'done' )
		{
			let error = is_object( run.Error ) ? run.Error : {};
			throw new RunError( 'The Process [' + Entry.Name + '] failed: ' + ( error.Message || run.Status ), error.Code || 'ProcessFailed' );
		}
		return run;
	}
	runner.RunProcessOnce = RunProcessOnce;


	//---------------------------------------------------------------------
	// What a `$call` asks for: a host function, or an object of the file (12.7, 12.8).

	async function service_call( Name, With )
	{
		let with_document = is_object( With ) ? With : {};

		if ( Object.prototype.hasOwnProperty.call( HOST_PARAMETERS, Name ) )
		{
			if ( typeof with_document.DataSource !== 'string' )
			{
				throw new RunError( 'A call to ' + Name + ' must carry With.DataSource naming a data source (12.7).', 'BadCall' );
			}
			let parameters = HOST_PARAMETERS[ Name ].map( function ( Parameter )
			{
				return ( typeof with_document[ Parameter ] === 'undefined' ) ? null : clone( with_document[ Parameter ] );
			} );
			return await call_storage( with_document.DataSource, Name, parameters );
		}

		if ( Object.keys( with_document ).length > 0 )
		{
			throw new RunError( 'A $call which names the object [' + Name + '] takes no With (12.8).', 'BadCall' );
		}

		let child = await runner.RunObject( Name );
		if ( !child.Ok ) { throw new RunError( 'The object [' + Name + '] failed: ' + child.Error.Message, child.Error.Code ); }
		return child.Result;
	}


	//---------------------------------------------------------------------
	// A Process a trigger started, for the trigger filter. Recorded under the object whose storage
	// call fired it. Throws when the run failed, which fails that storage call.

	runner.RunTriggered = async function ( Trigger, Process, Input )
	{
		let report = new_report( Process.Name, 'Process' );
		report.Trigger = Trigger.Name;

		let owner = runner.Stack[ runner.Stack.length - 1 ];
		if ( owner ) { owner.Fired.push( report ); }
		else { runner.Fired.push( report ); }

		let started = Date.now();
		runner.Stack.push( report );
		try
		{
			let run = await RunProcessOnce( Process, Input );
			report.Result = run.Result;
			report.Summary = 'ran once for ' + ( ( Input && Input.Document && typeof Input.Document._id !== 'undefined' ) ? JSON.stringify( Input.Document._id ) : 'a document' );
			if ( typeof Process.Into === 'string' && is_object( run.Result ) )
			{
				await insert_into( Process.Into, [ run.Result ] );
				report.Summary += ', into ' + Process.Into;
			}
			return run;
		}
		catch ( error )
		{
			report.Ok = false;
			report.Error = { Code: error.Code || 'RunFailed', Message: error.message };
			throw new RunError( 'The trigger [' + Trigger.Name + '] failed: ' + error.message, 'TriggerFailed' );
		}
		finally
		{
			runner.Stack.pop();
			report.Ms = Date.now() - started;
		}
	};


	return runner;
}


//---------------------------------------------------------------------
module.exports = {
	HOST_PARAMETERS: HOST_PARAMETERS,
	RunError: RunError,
	NewRunner: NewRunner,
};
