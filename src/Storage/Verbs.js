'use strict';

/*
	The ad hoc storage verbs (plan F3.7): the Storage Interface on the command line, against a data
	source the file declares.

	***A verb with a kind runs as an object of that kind.*** `find` builds a Query, `insert` an
	Insert, `update` an Update and `delete` a Delete, and the runner runs it exactly as it runs one
	in the file - so the result, the report line, `Into`, trigger firings, statistics and trace are
	the same as `jsonx run` gives. The object is validated first with the file's own rules, added to
	a copy of the file, so a refused criteria is caught before anything opens.

	***A verb without a kind makes one storage call*** (`find-one`, `count`, `replace`, `flush`,
	`drop`, `refresh-index`, `ping`) under a report of its own.

	***`join` and `union` read two data sources***, and are the only verbs which do. jsonstor's
	interface spans one collection, so the reading is two ordinary `FindMany2` calls and jsongin
	matches what comes back - the same two functions `jsonx engine join` and `jsonx engine union`
	run over documents given on the command line. `--criteria` keeps the meaning it has in every
	other verb here, which documents to read; the join criteria is `--on`.

	***The guard*** (F3.7): an `update` or `delete` whose criteria selects everything - `{}`, `null`,
	or absent, which jsonstor reads as everything too - and every `drop`, is refused without `--yes`.

	***`--save <name>` stores the built object in the file and runs nothing***, so saving a delete
	never deletes and the guard is not asked. Only a verb with a kind can be saved: `find-one` is not
	a Query of one, because a Query answers an array and FindOne a document.
*/

const jsongin = require( '@liquicode/jsongin' );

const Draft = require( '../File/Draft.js' );


//---------------------------------------------------------------------
// One row per verb. Functions are the storage functions it can make, for the coverage test;
// Kind is the object it builds, or null; Guard is 'criteria', 'always' or null.

const VERBS = {
	'find': { Kind: 'Query', Functions: [ 'FindMany2' ], Guard: null, Describe: 'Read documents: a Query run once.' },
	'find-one': { Kind: null, Functions: [ 'FindOne' ], Guard: null, Describe: 'Read the first document the criteria selects, or null.' },
	'count': { Kind: null, Functions: [ 'Count' ], Guard: null, Describe: 'Count the documents the criteria selects.' },
	'join': { Kind: null, Functions: [ 'FindMany2' ], Guard: null, Describe: 'Read two data sources and answer each document with what it matched in the other.' },
	'union': { Kind: null, Functions: [ 'FindMany2' ], Guard: null, Describe: 'Read two data sources, one set of documents after the other.' },
	'insert': { Kind: 'Insert', Functions: [ 'InsertMany' ], Guard: null, Describe: 'Insert one document or an array of them: an Insert run once.' },
	'update': { Kind: 'Update', Functions: [ 'UpdateMany', 'UpdateOne' ], Guard: 'criteria', Describe: 'Change the documents the criteria selects: an Update run once.' },
	'replace': { Kind: null, Functions: [ 'ReplaceOne' ], Guard: null, Describe: 'Replace the first document the criteria selects.' },
	'delete': { Kind: 'Delete', Functions: [ 'DeleteMany', 'DeleteOne' ], Guard: 'criteria', Describe: 'Remove the documents the criteria selects: a Delete run once.' },
	'flush': { Kind: null, Functions: [ 'FlushStorage' ], Guard: null, Describe: 'Write out what the adapter holds in memory.' },
	'drop': { Kind: null, Functions: [ 'DropStorage' ], Guard: 'always', Describe: 'Remove the whole store: the table, file or folder.' },
	'refresh-index': { Kind: null, Functions: [ 'RefreshIndex' ], Guard: null, Describe: 'Rebuild the index jsonstor keeps for the store.' },
	'ping': { Kind: null, Functions: [ 'Count' ], Guard: null, Describe: 'Open the data source and count its documents.' },
};


//---------------------------------------------------------------------
class VerbError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'VerbError';
	}
}


// What a built object is called in a finding's path.
const AD_HOC_PATH = '(ad hoc)';


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return ( typeof Value === 'undefined' ) ? undefined : JSON.parse( JSON.stringify( Value ) );
}

function verb_of( Verb )
{
	let verb = VERBS[ Verb ];
	if ( !verb ) { throw new VerbError( 'Unknown storage verb [' + Verb + '].' ); }
	return verb;
}


//---------------------------------------------------------------------
// The object a verb with a kind stands for. Values are named as the options are: criteria,
// projection, sort, skip, max, into, documents, update, first-only.

function BuildObject( Verb, DataSource, Values, Name )
{
	let verb = verb_of( Verb );
	if ( verb.Kind === null ) { throw new VerbError( '[' + Verb + '] is not an object of any kind, so it cannot be built or saved.' ); }

	let values = is_object( Values ) ? Values : {};
	let entry = { Kind: verb.Kind, Name: ( typeof Name === 'string' ) ? Name : null, DataSource: DataSource };
	if ( entry.Name === null ) { delete entry.Name; }

	// ***Only what was given is written***, because a writer omits a field it has no reason to set
	// rather than writing null (spec 9.2).
	function given( Key ) { return typeof values[ Key ] !== 'undefined'; }

	if ( verb.Kind === 'Query' )
	{
		entry.Criteria = given( 'criteria' ) ? clone( values.criteria ) : {};
		if ( given( 'projection' ) ) { entry.Projection = clone( values.projection ); }
		if ( given( 'sort' ) ) { entry.Sort = clone( values.sort ); }
		if ( given( 'skip' ) ) { entry.SkipCount = values.skip; }
		// ***Zero means every document*** (user, 2026-09-18): the object leaves MaxCount out, since the
		// specification refuses 0 (9.3), and a profile which defaults max still has a way to read everything.
		if ( given( 'max' ) && values.max !== 0 ) { entry.MaxCount = values.max; }
		if ( given( 'into' ) ) { entry.Into = values.into; }
	}
	if ( verb.Kind === 'Insert' )
	{
		entry.Documents = Array.isArray( values.documents ) ? clone( values.documents ) : [ clone( values.documents ) ];
	}
	if ( verb.Kind === 'Update' )
	{
		entry.Criteria = clone( values.criteria );
		entry.Update = clone( values.update );
		if ( values[ 'first-only' ] === true ) { entry.FirstOnly = true; }
	}
	if ( verb.Kind === 'Delete' )
	{
		entry.Criteria = clone( values.criteria );
		if ( values[ 'first-only' ] === true ) { entry.FirstOnly = true; }
	}
	return entry;
}


//---------------------------------------------------------------------
// Why a verb is refused without --yes, or null when it is not.
//
// ***One message for every mode***: the command line types --yes, and a Web API body or an MCP
// call sends "yes": true, so the confirmation names both.

const CONFIRM = 'Confirm with --yes on the command line, or "yes": true in a Web API or MCP request.';

function Guard( Verb, Values )
{
	let verb = verb_of( Verb );
	let values = is_object( Values ) ? Values : {};
	if ( values.yes === true ) { return null; }

	if ( verb.Guard === 'always' )
	{
		return 'Refused: [' + Verb + '] removes the whole store. ' + CONFIRM;
	}
	if ( verb.Guard === 'criteria' )
	{
		let criteria = values.criteria;
		let everything = ( typeof criteria === 'undefined' ) || ( criteria === null ) || ( is_object( criteria ) && Object.keys( criteria ).length === 0 );
		if ( everything )
		{
			return 'Refused: [' + Verb + '] with this criteria selects every document in the data source. ' + CONFIRM;
		}
	}
	return null;
}


//---------------------------------------------------------------------
// The errors a built object has, judged by the file's own rules: it is placed in a copy of the file
// as a draft (src/File/Draft.js) and validated there. Only the errors, and ***a path into the copy
// names nothing in the file***, so the entry's position is replaced by what the person typed it as:
// `Objects.7.Update` reads `(ad hoc).Update`.

function ValidateObject( Document, Entry, ValidateOptions )
{
	return Draft.ValidateDraft( Document, Entry, ValidateOptions, AD_HOC_PATH )
		.filter( function ( Finding ) { return Finding.Severity === 'error'; } );
}


//---------------------------------------------------------------------
// The positional parameters of a verb without a kind, by the Storage Interface's order.

function call_parameters( Verb, Values )
{
	let values = is_object( Values ) ? Values : {};
	let criteria = ( typeof values.criteria === 'undefined' ) ? {} : values.criteria;
	if ( Verb === 'find-one' ) { return [ criteria, ( typeof values.projection === 'undefined' ) ? null : values.projection ]; }
	if ( Verb === 'count' ) { return [ criteria ]; }
	if ( Verb === 'replace' ) { return [ values.criteria, values.document ]; }
	if ( Verb === 'ping' ) { return [ {} ]; }
	return [];
}


//---------------------------------------------------------------------
// The FindMany2 parameters for one side of a join or a union: a criteria and nothing else.
// Whole documents, because a join criteria reads their fields and a projection ahead of the match
// could quietly empty the answer.

function read_parameters( Criteria )
{
	return [ ( typeof Criteria === 'undefined' ) ? {} : Criteria, null, null, null ];
}


//---------------------------------------------------------------------
// join and union: two reads, then jsongin. A failed read is the report, as it is for any verb.

async function run_two( Session, Verb, DataSource, Values )
{
	let values = is_object( Values ) ? Values : {};

	// ***The second report is nested by hand, because the first has already been popped.***
	// RunCall attaches its report to whatever is on the runner's stack, and at the top of an ad
	// hoc command there is nothing there - so without this the second read would be a report the
	// run never mentions. Under a stack which already has a parent, RunCall has attached it.
	let nest = ( Session.Runner.Stack.length === 0 );

	let report = await Session.Runner.RunCall( DataSource, 'FindMany2', read_parameters( values.criteria ) );
	if ( !report.Ok ) { return report; }

	let second = await Session.Runner.RunCall( values[ 'with' ], 'FindMany2', read_parameters( values[ 'with-criteria' ] ) );
	if ( nest ) { report.Calls.push( second ); }
	if ( !second.Ok ) { return second; }

	try
	{
		let answered = null;
		if ( Verb === 'union' ) { answered = jsongin.Union( report.Result, second.Result ); }
		else { answered = jsongin.Join( report.Result, second.Result, values.on, values.type, values.as ); }
		report.Result = answered;
		report.Summary = ( ( Verb === 'union' ) ? 'united ' : 'joined ' ) + answered.length
			+ ( ( answered.length === 1 ) ? ' document' : ' documents' );
	}
	catch ( error )
	{
		report.Ok = false;
		report.Result = undefined;
		report.Error = { Code: 'RunFailed', Message: error.message };
	}
	return report;
}


//---------------------------------------------------------------------
// Runs a verb against a session. Returns a run report; the caller has already checked the guard,
// and for a verb with a kind, validated the object.

async function Run( Session, Verb, DataSource, Values )
{
	let verb = verb_of( Verb );

	if ( verb.Kind !== null )
	{
		return await Session.Runner.RunEntry( BuildObject( Verb, DataSource, Values ) );
	}

	if ( ( Verb === 'join' ) || ( Verb === 'union' ) )
	{
		return await run_two( Session, Verb, DataSource, Values );
	}

	let started = Date.now();
	let report = await Session.Runner.RunCall( DataSource, verb.Functions[ 0 ], call_parameters( Verb, Values ) );

	if ( Verb === 'ping' && report.Ok )
	{
		report.Result = {
			Name: DataSource,
			AdapterName: Session.DataSources.Definition( DataSource ).AdapterName,
			Count: report.Result,
			Ms: Date.now() - started,
		};
		report.Summary = 'opened, ' + report.Summary;
	}
	return report;
}


//---------------------------------------------------------------------
module.exports = {
	VERBS: VERBS,
	VerbError: VerbError,
	BuildObject: BuildObject,
	Guard: Guard,
	ValidateObject: ValidateObject,
	Run: Run,
};
