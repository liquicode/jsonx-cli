'use strict';

/*
	The names in a jsonx file: the entries which carry them, and every place one is used.

	***One walk, read by everything that needs to know where a name is used*** - validation,
	`rename`, `remove` and `plan`. A second walk written for one of them would be the one that
	forgot `$try.Catch`.

	A reference is

		{ Name, Sort, Path, Owner, Field, HasWith }

	where Sort is what the name must be:

		'DataSource'  an object's DataSource or Into, or a host function call's literal
		              With.DataSource
		'Object'      a $call whose Name is not a host function: an object of the file
		'Process'     a trigger's Process

	and Path is a dotted path from the root of the file (`Objects.6.Steps.0.$call.Name`).
*/


const SECTIONS = [ 'DataSources', 'Objects', 'Triggers' ];

// The jsonstor document functions a runner makes available to a process (spec 12.7), whose names
// no entry may take (spec 3.6).
const HOST_FUNCTIONS = [
	'Count', 'FindOne', 'FindMany', 'FindMany2',
	'InsertOne', 'InsertMany', 'UpdateOne', 'UpdateMany', 'ReplaceOne',
	'DeleteOne', 'DeleteMany',
];

const RESERVED_NAMES = HOST_FUNCTIONS;

// The operations a trigger fires on, and the jsonstor functions each one covers (spec 13.3). A
// trigger does not tell a call which touches one document from a call which touches many: which
// of a pair is called is the runner's business (a Delete with FirstOnly is a DeleteOne), and a
// triggered process runs once per document either way. A replaced document is a changed one.
const TRIGGER_OPERATIONS = {
	Insert: [ 'InsertOne', 'InsertMany' ],
	Find: [ 'FindOne', 'FindMany', 'FindMany2' ],
	Update: [ 'UpdateOne', 'UpdateMany', 'ReplaceOne' ],
	Delete: [ 'DeleteOne', 'DeleteMany' ],
};

// The operation a jsonstor function belongs to, or null when no trigger fires on it.
function OperationOf( FunctionName )
{
	for ( let operation in TRIGGER_OPERATIONS )
	{
		if ( TRIGGER_OPERATIONS[ operation ].includes( FunctionName ) ) { return operation; }
	}
	return null;
}

// The fields of each step operator which hold a nested list of steps.
const NESTED_STEPS = {
	'$when': [ 'Then', 'Else' ],
	'$while': [ 'Do' ],
	'$forEach': [ 'Do' ],
	'$try': [ 'Do', 'Catch' ],
};


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Every entry of the three sections which is an object, in file order.

function Entries( Document )
{
	let entries = [];
	if ( !is_object( Document ) ) { return entries; }

	for ( let section_index = 0; section_index < SECTIONS.length; section_index++ )
	{
		let section = SECTIONS[ section_index ];
		let list = Document[ section ];
		if ( !Array.isArray( list ) ) { continue; }

		for ( let index = 0; index < list.length; index++ )
		{
			let entry = list[ index ];
			if ( !is_object( entry ) ) { continue; }
			entries.push( {
				Section: section,
				Index: index,
				Entry: entry,
				Name: ( typeof entry.Name === 'string' ) ? entry.Name : null,
				Path: section + '.' + index,
			} );
		}
	}
	return entries;
}


//---------------------------------------------------------------------
// The first entry carrying a name, or null.

function FindEntry( Document, Name )
{
	let entries = Entries( Document );
	for ( let index = 0; index < entries.length; index++ )
	{
		if ( entries[ index ].Name === Name ) { return entries[ index ]; }
	}
	return null;
}


//---------------------------------------------------------------------
// Visits every step of a list and of the lists nested inside it.
//
// Visit( Step, Operator, Path ) is called for each step which is an object with exactly one key.

function WalkSteps( Steps, Path, Visit )
{
	if ( !Array.isArray( Steps ) ) { return; }

	for ( let index = 0; index < Steps.length; index++ )
	{
		let step = Steps[ index ];
		let step_path = Path + '.' + index;
		if ( !is_object( step ) ) { continue; }

		let keys = Object.keys( step );
		if ( keys.length !== 1 ) { continue; }

		let operator = keys[ 0 ];
		Visit( step, operator, step_path );

		let body = step[ operator ];
		let nested = NESTED_STEPS[ operator ];
		if ( !nested || !is_object( body ) ) { continue; }

		for ( let field_index = 0; field_index < nested.length; field_index++ )
		{
			let field = nested[ field_index ];
			WalkSteps( body[ field ], step_path + '.' + operator + '.' + field, Visit );
		}
	}
	return;
}


//---------------------------------------------------------------------
// Every place a name is used.

function References( Document )
{
	let references = [];
	let entries = Entries( Document );

	for ( let index = 0; index < entries.length; index++ )
	{
		let item = entries[ index ];
		let entry = item.Entry;

		if ( item.Section === 'Objects' )
		{
			if ( typeof entry.DataSource === 'string' )
			{
				references.push( { Name: entry.DataSource, Sort: 'DataSource', Path: item.Path + '.DataSource', Owner: item.Name, Field: 'DataSource' } );
			}
			if ( typeof entry.Into === 'string' )
			{
				references.push( { Name: entry.Into, Sort: 'DataSource', Path: item.Path + '.Into', Owner: item.Name, Field: 'Into' } );
			}

			WalkSteps( entry.Steps, item.Path + '.Steps', function ( Step, Operator, StepPath )
			{
				if ( Operator !== '$call' ) { return; }
				let call = Step.$call;
				if ( !is_object( call ) || typeof call.Name !== 'string' ) { return; }

				let call_path = StepPath + '.$call';
				if ( HOST_FUNCTIONS.includes( call.Name ) )
				{
					// ***Only a literal data source name is a reference.*** A `$` string is an
					// expression computed at run time, and no reader can resolve it.
					if ( is_object( call.With ) && typeof call.With.DataSource === 'string' && !call.With.DataSource.startsWith( '$' ) )
					{
						references.push( { Name: call.With.DataSource, Sort: 'DataSource', Path: call_path + '.With.DataSource', Owner: item.Name, Field: '$call.With.DataSource' } );
					}
					return;
				}

				references.push( {
					Name: call.Name, Sort: 'Object', Path: call_path + '.Name', Owner: item.Name, Field: '$call.Name',
					HasWith: ( typeof call.With !== 'undefined' ),
				} );
			} );
		}

		if ( item.Section === 'Triggers' && typeof entry.Process === 'string' )
		{
			references.push( { Name: entry.Process, Sort: 'Process', Path: item.Path + '.Process', Owner: item.Name, Field: 'Process' } );
		}
	}

	return references;
}


//---------------------------------------------------------------------
module.exports = {
	SECTIONS: SECTIONS,
	HOST_FUNCTIONS: HOST_FUNCTIONS,
	RESERVED_NAMES: RESERVED_NAMES,
	TRIGGER_OPERATIONS: TRIGGER_OPERATIONS,
	OperationOf: OperationOf,
	NESTED_STEPS: NESTED_STEPS,
	Entries: Entries,
	FindEntry: FindEntry,
	WalkSteps: WalkSteps,
	References: References,
};
