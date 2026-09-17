'use strict';

/*
	jsongin with no file and no storage (plan F3.8): the engine's functions over documents given on
	the command line, in a file, or on standard input.

	***One table, one row per verb.*** A row declares its inputs in the parser's own option shape, the
	jsongin members it reaches (for the coverage test of F3.12), and a Run over the parsed values. The
	command file builds its commands from the rows; a served mode will build its tools from them.

	***Documents arrive one of two ways, and the declaration says which***: `--documents` is JSON (one
	document or an array), `--documents-jsonl` is JSON Lines. A verb which reads documents takes
	exactly one of the two.

	***A verb given one document answers for one document***, and given an array answers an array:
	`project`, `update`, `flatten`, `expand` and `get` apply to each document in turn.

	***What jsongin refuses is a finding, not a crash.*** Run answers `{ Result, Findings }`; a throw
	from jsongin becomes one error finding naming the function, and the command exits 3.
	`validate-query` and `schema validate` answer their findings as the result as well, so a caller
	reading standard output sees them.
*/

const jsongin = require( '@liquicode/jsongin' );


//---------------------------------------------------------------------
class EngineError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'EngineError';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return JSON.parse( JSON.stringify( Value ) );
}


//---------------------------------------------------------------------
// Input declarations, shared by the rows.

const DOCUMENTS = {
	'documents': { Type: 'json', JsonType: [ 'object', 'array' ], Describe: 'One document or an array of them.' },
	'documents-jsonl': { Type: 'jsonl', Describe: 'The documents as JSON Lines, one per line.' },
};

// A JsonType is what an MCP client is told the value holds; absent, any JSON value (an expression can be
// a string, a JSON Schema can be a boolean).
function required_json( Name, Describe, JsonType )
{
	let input = {};
	input[ Name ] = { Type: 'json', Required: true, Describe: Describe };
	if ( typeof JsonType !== 'undefined' ) { input[ Name ].JsonType = JsonType; }
	return input;
}

const DIALECT = { 'dialect': { Type: 'string', Choices: [ '2020-12', '2019-09', 'draft-07', 'draft-04' ], Describe: 'The JSON Schema dialect; absent means the schema\'s own, else 2020-12.' } };

const OPERATOR_TABLES = {
	query: 'QueryOperators',
	update: 'UpdateOperators',
	expression: 'ExpressionOperators',
	stage: 'StageOperators',
	accumulator: 'AccumulatorOperators',
};


//---------------------------------------------------------------------
// The documents a verb was given: exactly one of --documents and --documents-jsonl. Answers
// { Documents, Single }, where Single says one document was given rather than an array.

function documents_of( Values )
{
	let json = Values.documents;
	let lines = Values[ 'documents-jsonl' ];
	let has_json = ( typeof json !== 'undefined' );
	let has_lines = ( typeof lines !== 'undefined' );

	if ( has_json && has_lines ) { throw new EngineError( 'Give the documents once: --documents or --documents-jsonl, not both.' ); }
	if ( !has_json && !has_lines ) { throw new EngineError( 'The documents are required: --documents <json> or --documents-jsonl <jsonl>.' ); }

	let documents = has_lines ? lines : json;
	let single = !Array.isArray( documents );
	documents = single ? [ documents ] : documents;

	for ( let index = 0; index < documents.length; index++ )
	{
		if ( !is_object( documents[ index ] ) )
		{
			let where = single ? 'The document' : 'Document ' + index;
			throw new EngineError( where + ' is not a JSON object.' );
		}
	}
	return { Documents: documents, Single: single };
}


// Applies a function to each document, answering one value for one document or an array for many.
function each( Values, Work )
{
	let given = documents_of( Values );
	let results = given.Documents.map( function ( Document ) { return Work( Document ); } );
	return given.Single ? results[ 0 ] : results;
}


function object_input( Values, Name )
{
	let value = Values[ Name ];
	if ( !is_object( value ) ) { throw new EngineError( 'Option [--' + Name + '] must be a JSON object.' ); }
	return value;
}


// ***Refused before there is anything to apply it to.*** jsongin reads a criteria only against a
// document, so filtering no documents accepted any criteria at all (found 2026-09-13 by the smoke
// run). A criteria is validated, and an update document or projection is applied to {} as a trial,
// before any document is read.
function criteria_input( Values )
{
	let criteria = object_input( Values, 'criteria' );
	jsongin.ValidateQuery( criteria );
	return criteria;
}

function update_input( Values )
{
	let update = object_input( Values, 'update' );
	jsongin.Update( {}, update );
	return update;
}

function projection_input( Values )
{
	let projection = object_input( Values, 'projection' );
	jsongin.Project( {}, projection );
	return projection;
}


// A schema finding as a jsonx finding: the instance location as a dotted path, with the document's
// position in front when there were several.
function schema_findings( Findings, Prefix )
{
	return Findings.map( function ( Finding )
	{
		let parts = String( Finding.instanceLocation || '' ).split( '/' ).filter( function ( Part ) { return Part !== ''; } )
			.map( function ( Part ) { return Part.replace( /~1/g, '/' ).replace( /~0/g, '~' ); } );
		if ( Prefix !== null ) { parts.unshift( String( Prefix ) ); }
		return { Severity: 'error', Path: parts.join( '.' ), Message: Finding.error + ' (' + Finding.keywordLocation + ')' };
	} );
}


//---------------------------------------------------------------------
// The verbs. Group names a sub-group (`schema`); Inputs are option declarations; Library lists the
// jsongin members reached; Findings says the result is a findings list.

const ENGINE_VERBS = {

	'match': {
		Describe: 'Whether one document matches a criteria: true or false.',
		Inputs: Object.assign( required_json( 'document', 'The document.', 'object' ), required_json( 'criteria', 'The criteria.', 'object' ) ),
		Library: [ 'Query' ],
		Run: function ( Values ) { return jsongin.Query( object_input( Values, 'document' ), criteria_input( Values ) ); },
	},

	'filter': {
		Describe: 'The documents a criteria matches, in order.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'criteria', 'The criteria.', 'object' ) ),
		Library: [ 'Filter' ],
		Run: function ( Values )
		{
			let criteria = criteria_input( Values );
			return jsongin.Filter( documents_of( Values ).Documents, criteria );
		},
	},

	'sort': {
		Describe: 'The documents in the order a sort gives.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'sort', 'The sort, as { Field: 1 or -1 }.', 'object' ) ),
		Library: [ 'Sort' ],
		// jsongin sorts the array it is given in place (measured 2026-09-13), so it is given a copy.
		Run: function ( Values ) { return jsongin.Sort( documents_of( Values ).Documents.slice(), object_input( Values, 'sort' ) ); },
	},

	'project': {
		Describe: 'Each document through a projection.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'projection', 'The projection.', 'object' ) ),
		Library: [ 'Project' ],
		Run: function ( Values )
		{
			let projection = projection_input( Values );
			return each( Values, function ( Document ) { return jsongin.Project( Document, projection ); } );
		},
	},

	'update': {
		Describe: 'Each document with an update document applied.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'update', 'The update document, such as { "$set": { ... } }.', 'object' ) ),
		Library: [ 'Update' ],
		Run: function ( Values )
		{
			let update = update_input( Values );
			return each( Values, function ( Document ) { return jsongin.Update( Document, update ); } );
		},
	},

	'diff': {
		Describe: 'The update document which turns one document into another.',
		Inputs: Object.assign( required_json( 'before', 'The document before.', 'object' ), required_json( 'after', 'The document after.', 'object' ) ),
		Library: [ 'Diff' ],
		Run: function ( Values ) { return jsongin.Diff( object_input( Values, 'before' ), object_input( Values, 'after' ) ); },
	},

	'invert': {
		Describe: 'The update document which undoes a patch applied to a document.',
		Inputs: Object.assign( required_json( 'before', 'The document before the patch.', 'object' ), required_json( 'patch', 'The update document applied to it.', 'object' ) ),
		Library: [ 'Invert' ],
		Run: function ( Values ) { return jsongin.Invert( object_input( Values, 'before' ), object_input( Values, 'patch' ) ); },
	},

	'distinct': {
		Describe: 'The distinct combinations of some fields across the documents.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'fields', 'The fields, as { Field: 1, ... }.', 'object' ) ),
		Library: [ 'Distinct' ],
		Run: function ( Values ) { return jsongin.Distinct( documents_of( Values ).Documents, object_input( Values, 'fields' ) ); },
	},

	'evaluate': {
		Describe: 'The value of an expression against a document.',
		Inputs: Object.assign(
			{ 'document': { Type: 'json', Describe: 'The document the expression reads; absent means {}.' } },
			required_json( 'expression', 'The expression, such as { "$add": [ "$a", 1 ] }.' ) ),
		Library: [ 'Evaluate', 'ExpressionOperators' ],
		Run: function ( Values )
		{
			let document = ( typeof Values.document === 'undefined' ) ? {} : object_input( Values, 'document' );
			return jsongin.Evaluate( document, Values.expression );
		},
	},

	'aggregate': {
		Describe: 'The documents through an aggregation pipeline.',
		Inputs: Object.assign( {}, DOCUMENTS, { 'pipeline': { Type: 'json', JsonType: 'array', Required: true, Describe: 'The pipeline, an array of stages.' } } ),
		Library: [ 'Aggregate', 'StageOperators', 'AccumulatorOperators' ],
		Run: function ( Values )
		{
			if ( !Array.isArray( Values.pipeline ) ) { throw new EngineError( 'Option [--pipeline] must be a JSON array of stages.' ); }
			return jsongin.Aggregate( documents_of( Values ).Documents, Values.pipeline );
		},
	},

	'validate-query': {
		Describe: 'The findings for a criteria, without a document: [] when jsongin accepts it.',
		Inputs: required_json( 'criteria', 'The criteria.', 'object' ),
		Library: [ 'ValidateQuery', 'QueryOperators' ],
		Findings: true,
		Run: function ( Values )
		{
			criteria_input( Values );
			return [];
		},
	},

	'flatten': {
		Describe: 'Each document with nested fields as dotted names.',
		Inputs: Object.assign( {}, DOCUMENTS ),
		Library: [ 'Flatten' ],
		Run: function ( Values ) { return each( Values, function ( Document ) { return jsongin.Flatten( Document ); } ); },
	},

	'expand': {
		Describe: 'Each document with dotted names as nested fields.',
		Inputs: Object.assign( {}, DOCUMENTS ),
		Library: [ 'Expand' ],
		Run: function ( Values ) { return each( Values, function ( Document ) { return jsongin.Expand( Document ); } ); },
	},

	'merge': {
		Describe: 'One document merged over another, field by field.',
		Inputs: Object.assign( required_json( 'document', 'The document merged into.', 'object' ), required_json( 'with', 'The document merged over it.', 'object' ) ),
		Library: [ 'Merge' ],
		Run: function ( Values ) { return jsongin.Merge( object_input( Values, 'document' ), object_input( Values, 'with' ) ); },
	},

	'get': {
		Describe: 'The value at a dotted path in each document.',
		Inputs: Object.assign( {}, DOCUMENTS, { 'path': { Type: 'string', Required: true, Describe: 'The dotted path, such as Site.Dome.' } } ),
		Library: [ 'GetValue' ],
		Run: function ( Values )
		{
			let path = Values.path;
			return each( Values, function ( Document )
			{
				let value = jsongin.GetValue( Document, path );
				return ( typeof value === 'undefined' ) ? null : value;
			} );
		},
	},

	'operators': {
		Describe: 'The operator names jsongin defines, for one family or all of them.',
		Inputs: {},
		Positionals: [ { Name: 'family', Type: 'string', Choices: Object.keys( OPERATOR_TABLES ), Describe: 'One family; absent means every family.' } ],
		Library: [ 'QueryOperators', 'UpdateOperators', 'ExpressionOperators', 'StageOperators', 'AccumulatorOperators' ],
		Run: function ( Values )
		{
			if ( typeof Values.family === 'string' ) { return Object.keys( jsongin[ OPERATOR_TABLES[ Values.family ] ] ); }
			let all = {};
			let families = Object.keys( OPERATOR_TABLES );
			for ( let index = 0; index < families.length; index++ ) { all[ families[ index ] ] = Object.keys( jsongin[ OPERATOR_TABLES[ families[ index ] ] ] ); }
			return all;
		},
	},

	'schema infer': {
		Group: 'schema',
		Describe: 'A JSON Schema inferred from the documents.',
		Inputs: Object.assign( {}, DOCUMENTS, {
			'required-threshold': { Type: 'number', Describe: 'The share of documents a field must appear in to be required, 0 to 1; absent means 1.' },
		}, DIALECT ),
		Library: [ 'InferSchema' ],
		Run: function ( Values )
		{
			let options = {};
			if ( typeof Values[ 'required-threshold' ] === 'number' ) { options.RequiredThreshold = Values[ 'required-threshold' ]; }
			if ( typeof Values.dialect === 'string' ) { options.Dialect = Values.dialect; }
			return jsongin.InferSchema( documents_of( Values ).Documents, options );
		},
	},

	'schema validate': {
		Group: 'schema',
		Describe: 'The findings for each document against a JSON Schema: [] when every one is valid.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'schema', 'The JSON Schema.' ), DIALECT ),
		Library: [ 'ValidateDocument' ],
		Findings: true,
		Run: function ( Values )
		{
			let schema = object_input( Values, 'schema' );
			let options = ( typeof Values.dialect === 'string' ) ? { Dialect: Values.dialect } : {};
			let given = documents_of( Values );
			let findings = [];
			for ( let index = 0; index < given.Documents.length; index++ )
			{
				findings = findings.concat( schema_findings( jsongin.ValidateDocument( given.Documents[ index ], schema, options ), given.Single ? null : index ) );
			}
			return findings;
		},
	},

	'schema init': {
		Group: 'schema',
		Describe: 'A document filled in with the defaults a JSON Schema declares.',
		Inputs: Object.assign( { 'document': { Type: 'json', JsonType: 'object', Describe: 'The document to fill in; absent means {}.' } }, required_json( 'schema', 'The JSON Schema.' ) ),
		Library: [ 'InitSchema' ],
		Run: function ( Values )
		{
			let document = ( typeof Values.document === 'undefined' ) ? {} : object_input( Values, 'document' );
			return jsongin.InitSchema( document, object_input( Values, 'schema' ) );
		},
	},

	'schema project': {
		Group: 'schema',
		Describe: 'Each document with only the fields a JSON Schema declares.',
		Inputs: Object.assign( {}, DOCUMENTS, required_json( 'schema', 'The JSON Schema.' ) ),
		Library: [ 'ProjectSchema' ],
		Run: function ( Values )
		{
			let schema = object_input( Values, 'schema' );
			return each( Values, function ( Document ) { return jsongin.ProjectSchema( Document, schema ); } );
		},
	},

};


//---------------------------------------------------------------------
// Runs a verb. Answers { Result, Findings }: an input mistake throws EngineError (a usage mistake,
// exit 2); a refusal from jsongin is an error finding with no result (exit 3).

function Run( Verb, Values )
{
	let verb = ENGINE_VERBS[ Verb ];
	if ( !verb ) { throw new EngineError( 'Unknown engine verb [' + Verb + '].' ); }
	let values = is_object( Values ) ? Values : {};

	try
	{
		let result = verb.Run( values );
		let findings = ( verb.Findings === true ) ? result : [];
		return { Result: result, Findings: findings };
	}
	catch ( error )
	{
		if ( error instanceof EngineError ) { throw error; }
		let finding = { Severity: 'error', Path: '', Message: 'jsongin refused it: ' + error.message };
		if ( verb.Findings === true ) { return { Result: [ finding ], Findings: [ finding ] }; }
		return { Result: undefined, Findings: [ finding ] };
	}
}


//---------------------------------------------------------------------
module.exports = {
	ENGINE_VERBS: ENGINE_VERBS,
	EngineError: EngineError,
	Run: Run,
};
