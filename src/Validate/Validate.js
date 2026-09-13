'use strict';

/*
	Validating a jsonx file: findings, each { Severity, Path, Message }, as spec section 14 lists
	them.

	***The structural checks are written by hand, one for each item of 14.1, and each message cites
	the section it enforces.*** The schema's own messages are generic ("The value matches a schema
	it must not match"), and a schema `oneOf` across the five kinds turns one missing field into a
	dozen findings - measured when the specification was written.

	***The schema still decides structure.*** After the hand checks, the file is validated against
	Appendix A, and any schema finding which no hand finding covers is reported as a generic error.
	That should never happen, and test/Validate.test.js asserts that it does not for every error
	case it holds - so the schema checks the hand checks are complete, rather than the two being
	allowed to drift.

	***What only an engine can decide is asked of the engine***: jsongin for a criteria
	(`ValidateQuery`) and an update document (`Update` applied to an empty document), jsonproc for
	the step operators. The adapter settings check is handed in as CheckSettings, because the
	catalog it needs belongs to a session.

	Paths are dotted from the root of the file: `Objects.6.Steps.0.$call.Name`. The root is ''.
*/

const Names = require( '../File/Names.js' );
const Schema = require( '../File/Schema.js' );
const Environment = require( '../Session/Environment.js' );


const KINDS = [ 'Insert', 'Query', 'Update', 'Delete', 'Process' ];

// The storage functions a trigger can fire on (spec 13.3).
const TRIGGER_FUNCTIONS = [
	'InsertOne', 'InsertMany',
	'FindOne', 'FindMany', 'FindMany2',
	'UpdateOne', 'UpdateMany', 'ReplaceOne',
	'DeleteOne', 'DeleteMany',
];

const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function is_name( Value )
{
	return ( typeof Value === 'string' ) && ( Value !== '' );
}

function is_integer( Value )
{
	return ( typeof Value === 'number' ) && Number.isInteger( Value );
}

function type_of( Value )
{
	if ( Value === null ) { return 'null'; }
	if ( Array.isArray( Value ) ) { return 'an array'; }
	if ( typeof Value === 'object' ) { return 'an object'; }
	return 'a ' + typeof Value;
}

function path_of( Base, Field )
{
	if ( Base === '' ) { return String( Field ); }
	return Base + '.' + Field;
}

function article( Kind )
{
	return ( /^[AEIOU]/.test( Kind ) ? 'An ' : 'A ' ) + Kind;
}


//---------------------------------------------------------------------
// Validates a whole file.
//
// Options:
//		jsongin         the engine asked about criteria and update documents
//		jsonproc        the runtime asked about step operators
//		Env             the environment variables, for the unset-variable warning
//		CheckSettings   function ( AdapterName, Settings ) -> findings with paths relative to the
//		                data source; absent means settings are not checked

function ValidateFile( Document, Options )
{
	let options = is_object( Options ) ? Options : {};
	let jsongin = options.jsongin || require( '@liquicode/jsongin' );
	let jsonproc = options.jsonproc || require( '@liquicode/jsonproc' );
	let env = is_object( options.Env ) ? options.Env : {};

	let findings = [];
	function add( Severity, Path, Message ) { findings.push( { Severity: Severity, Path: Path, Message: Message } ); }
	function error( Path, Message ) { add( 'error', Path, Message ); }
	function warning( Path, Message ) { add( 'warning', Path, Message ); }
	function note( Path, Message ) { add( 'note', Path, Message ); }

	if ( !is_object( Document ) )
	{
		error( '', 'A jsonx file must be a JSON object, not ' + type_of( Document ) + ' (3.1).' );
		return findings;
	}

	check_file( Document, error, warning );
	check_names( Document, error );

	let entries = Names.Entries( Document );
	for ( let index = 0; index < entries.length; index++ )
	{
		let item = entries[ index ];
		if ( item.Section === 'DataSources' ) { check_data_source( item, options, env, error, warning ); }
		if ( item.Section === 'Objects' ) { check_object( item, jsongin, jsonproc, error, warning ); }
		if ( item.Section === 'Triggers' ) { check_trigger( item, error ); }
	}

	let references = Names.References( Document );
	check_references( Document, references, error );
	check_cycles( Document, references, error );
	check_unreferenced( Document, references, note );

	cross_check_schema( Document, jsongin, findings, error );

	return SortFindings( findings );
}


//---------------------------------------------------------------------
// The file's own fields and its three arrays (3.2, 3.3, 15.1).

function check_file( Document, error, warning )
{
	if ( typeof Document.Jsonx !== 'undefined' )
	{
		if ( typeof Document.Jsonx !== 'string' )
		{
			error( 'Jsonx', 'Jsonx must be a string naming a version of the specification, not ' + type_of( Document.Jsonx ) + ' (3.2).' );
		}
		else if ( later_version( Document.Jsonx, Schema.SPEC_VERSION ) )
		{
			warning( 'Jsonx', 'This file names version ' + Document.Jsonx + ' of the specification; this reader was written to ' + Schema.SPEC_VERSION + ' (15.1).' );
		}
	}
	if ( typeof Document.Name !== 'undefined' && !is_name( Document.Name ) )
	{
		error( 'Name', 'The file\'s Name must be a non-empty string (3.2).' );
	}
	if ( typeof Document.Description !== 'undefined' && typeof Document.Description !== 'string' )
	{
		error( 'Description', 'Description must be a string, not ' + type_of( Document.Description ) + ' (3.2).' );
	}

	for ( let index = 0; index < Names.SECTIONS.length; index++ )
	{
		let section = Names.SECTIONS[ index ];
		let list = Document[ section ];
		if ( typeof list === 'undefined' ) { continue; }
		if ( !Array.isArray( list ) )
		{
			error( section, section + ' must be an array, not ' + type_of( list ) + ' (3.3).' );
			continue;
		}
		for ( let element = 0; element < list.length; element++ )
		{
			if ( !is_object( list[ element ] ) )
			{
				error( section + '.' + element, 'Each element of ' + section + ' must be a JSON object, not ' + type_of( list[ element ] ) + ' (3.3).' );
			}
		}
	}
	return;
}


//---------------------------------------------------------------------
function later_version( Named, Known )
{
	if ( !/^\d+(\.\d+)*$/.test( Named ) ) { return false; }
	let named = Named.split( '.' ).map( Number );
	let known = Known.split( '.' ).map( Number );
	for ( let index = 0; index < Math.max( named.length, known.length ); index++ )
	{
		let left = named[ index ] || 0;
		let right = known[ index ] || 0;
		if ( left !== right ) { return left > right; }
	}
	return false;
}


//---------------------------------------------------------------------
// One namespace across the three arrays, and the reserved names (3.5, 3.6).

function check_names( Document, error )
{
	let entries = Names.Entries( Document );
	let first = {};

	for ( let index = 0; index < entries.length; index++ )
	{
		let item = entries[ index ];
		let name = item.Entry.Name;
		let path = path_of( item.Path, 'Name' );

		if ( typeof name === 'undefined' )
		{
			error( path, 'Every entry of ' + item.Section + ' must carry a Name (3.5).' );
			continue;
		}
		if ( !is_name( name ) )
		{
			error( path, 'Name must be a non-empty string (3.5).' );
			continue;
		}
		if ( Names.RESERVED_NAMES.includes( name ) )
		{
			error( path, 'The name [' + name + '] is reserved for a host function (3.6).' );
		}
		if ( Object.prototype.hasOwnProperty.call( first, name ) )
		{
			error( path, 'The name [' + name + '] is already used by ' + first[ name ] + '; one file has one namespace (3.5).' );
			continue;
		}
		first[ name ] = item.Path;
	}
	return;
}


//---------------------------------------------------------------------
// A data source (section 4).

function check_data_source( Item, Options, Env, error, warning )
{
	let entry = Item.Entry;
	let base = Item.Path;
	let shape_ok = true;

	if ( !is_name( entry.AdapterName ) )
	{
		error( path_of( base, 'AdapterName' ), 'A data source must carry an AdapterName, a non-empty string (4.1).' );
		shape_ok = false;
	}
	if ( typeof entry.Settings !== 'undefined' && !is_object( entry.Settings ) )
	{
		error( path_of( base, 'Settings' ), 'Settings must be a JSON object, not ' + type_of( entry.Settings ) + ' (4.2).' );
		shape_ok = false;
	}
	if ( typeof entry.Filters !== 'undefined' )
	{
		if ( !Array.isArray( entry.Filters ) )
		{
			error( path_of( base, 'Filters' ), 'Filters must be an array, not ' + type_of( entry.Filters ) + ' (4.3).' );
		}
		else
		{
			for ( let index = 0; index < entry.Filters.length; index++ )
			{
				let filter = entry.Filters[ index ];
				let filter_path = path_of( base, 'Filters.' + index );
				if ( !is_object( filter ) )
				{
					error( filter_path, 'A filter descriptor must be a JSON object, not ' + type_of( filter ) + ' (4.3).' );
					continue;
				}
				if ( !is_name( filter.FilterName ) )
				{
					error( path_of( filter_path, 'FilterName' ), 'A filter descriptor must carry a FilterName, a non-empty string (4.3).' );
				}
				if ( typeof filter.Settings !== 'undefined' && !is_object( filter.Settings ) )
				{
					error( path_of( filter_path, 'Settings' ), 'A filter\'s Settings must be a JSON object, not ' + type_of( filter.Settings ) + ' (4.3).' );
				}
			}
		}
	}

	if ( shape_ok && typeof Options.CheckSettings === 'function' )
	{
		let settings_findings = Options.CheckSettings( entry.AdapterName, is_object( entry.Settings ) ? entry.Settings : {} );
		for ( let index = 0; index < settings_findings.length; index++ )
		{
			let finding = settings_findings[ index ];
			let path = path_of( base, finding.Path || 'AdapterName' );
			if ( finding.Severity === 'warning' ) { warning( path, finding.Message ); }
			else { error( path, finding.Message ); }
		}
	}

	// One warning per unset variable per data source, at its first use.
	let warned = [];
	let references = Environment.References( entry );
	for ( let index = 0; index < references.length; index++ )
	{
		let reference = references[ index ];
		if ( Environment.IsSet( Env, reference.Name ) || warned.includes( reference.Name ) ) { continue; }
		warned.push( reference.Name );
		warning( path_of( base, reference.Path ), 'The environment variable ' + reference.Name + ' is not set here, and the data source will not open until it is (4.6).' );
	}
	return;
}


//---------------------------------------------------------------------
// An object (sections 5, 8-12).

function check_object( Item, jsongin, jsonproc, error, warning )
{
	let entry = Item.Entry;
	let base = Item.Path;
	let kind = entry.Kind;

	if ( typeof kind === 'undefined' )
	{
		error( path_of( base, 'Kind' ), 'An object must carry a Kind (5.1).' );
		return;
	}
	if ( typeof kind !== 'string' || !KINDS.includes( kind ) )
	{
		error( path_of( base, 'Kind' ), 'Unknown Kind [' + kind + ']; a Kind is Insert, Query, Update, Delete or Process (5.2).' );
		return;
	}

	// DataSource (5.4, 12.3).
	if ( typeof entry.DataSource === 'undefined' )
	{
		if ( kind !== 'Process' ) { error( path_of( base, 'DataSource' ), article( kind ) + ' must carry a DataSource (5.4).' ); }
	}
	else if ( !is_name( entry.DataSource ) )
	{
		error( path_of( base, 'DataSource' ), 'DataSource must be a non-empty string naming a data source (5.4).' );
	}

	// Into (6.5).
	if ( typeof entry.Into !== 'undefined' )
	{
		if ( kind !== 'Query' && kind !== 'Process' )
		{
			error( path_of( base, 'Into' ), article( kind ) + ' does not take an Into; only a Query or a Process does (6.5).' );
		}
		else if ( !is_name( entry.Into ) )
		{
			error( path_of( base, 'Into' ), 'Into must be a non-empty string naming a data source (6.5).' );
		}
		else if ( entry.Into === entry.DataSource )
		{
			error( path_of( base, 'Into' ), 'An object must not name its own DataSource as its Into (6.5).' );
		}
	}

	if ( kind === 'Insert' ) { check_insert( entry, base, error, warning ); }
	if ( kind === 'Query' ) { check_query( entry, base, jsongin, error, warning ); }
	if ( kind === 'Update' ) { check_update( entry, base, jsongin, error, warning ); }
	if ( kind === 'Delete' ) { check_delete( entry, base, jsongin, error, warning ); }
	if ( kind === 'Process' ) { check_process( entry, base, jsongin, jsonproc, error ); }
	return;
}


//---------------------------------------------------------------------
function check_criteria( Entry, Base, Required, Section, jsongin, error )
{
	let path = path_of( Base, 'Criteria' );

	if ( typeof Entry.Criteria === 'undefined' )
	{
		if ( Required ) { error( path, article( Entry.Kind ) + ' must carry a Criteria; write {} to select every document (' + Section + ').' ); }
		return false;
	}
	if ( !is_object( Entry.Criteria ) )
	{
		error( path, 'Criteria must be a JSON object, not ' + type_of( Entry.Criteria ) + ' (7.1).' );
		return false;
	}
	try
	{
		jsongin.ValidateQuery( Entry.Criteria );
	}
	catch ( failure )
	{
		error( path, 'jsongin refuses this Criteria: ' + clause( failure.message ) + ' (7.1).' );
		return false;
	}
	return true;
}


//---------------------------------------------------------------------
function check_first_only( Entry, Base, Section, error )
{
	if ( typeof Entry.FirstOnly !== 'undefined' && typeof Entry.FirstOnly !== 'boolean' )
	{
		error( path_of( Base, 'FirstOnly' ), 'FirstOnly must be true or false, not ' + type_of( Entry.FirstOnly ) + ' (' + Section + ').' );
	}
	return;
}


//---------------------------------------------------------------------
function check_insert( Entry, Base, error, warning )
{
	let path = path_of( Base, 'Documents' );
	if ( !Array.isArray( Entry.Documents ) )
	{
		error( path, 'An Insert must carry Documents, an array of JSON objects (8.1).' );
		return;
	}
	if ( Entry.Documents.length === 0 )
	{
		warning( path, 'This Insert\'s Documents is empty, so it inserts nothing (8.1).' );
	}
	for ( let index = 0; index < Entry.Documents.length; index++ )
	{
		if ( !is_object( Entry.Documents[ index ] ) )
		{
			error( path_of( path, index ), 'Each of Documents must be a JSON object, not ' + type_of( Entry.Documents[ index ] ) + ' (8.1).' );
		}
	}
	return;
}


//---------------------------------------------------------------------
function check_query( Entry, Base, jsongin, error, warning )
{
	check_criteria( Entry, Base, true, '9.1', jsongin, error );

	if ( typeof Entry.Projection !== 'undefined' && !is_object( Entry.Projection ) )
	{
		error( path_of( Base, 'Projection' ), 'Projection must be a JSON object, not ' + type_of( Entry.Projection ) + ' (7.4).' );
	}

	if ( typeof Entry.Sort !== 'undefined' )
	{
		if ( !is_object( Entry.Sort ) )
		{
			error( path_of( Base, 'Sort' ), 'Sort must be a JSON object of field names, not ' + type_of( Entry.Sort ) + ' (7.3).' );
		}
		else
		{
			let fields = Object.keys( Entry.Sort );
			for ( let index = 0; index < fields.length; index++ )
			{
				let value = Entry.Sort[ fields[ index ] ];
				if ( value !== 1 && value !== -1 )
				{
					error( path_of( Base, 'Sort.' + fields[ index ] ), 'A Sort value must be 1 or -1, not ' + JSON.stringify( value ) + ' (7.3).' );
				}
			}
		}
	}

	if ( typeof Entry.SkipCount !== 'undefined' && !( is_integer( Entry.SkipCount ) && Entry.SkipCount >= 0 ) )
	{
		error( path_of( Base, 'SkipCount' ), 'SkipCount must be an integer of zero or more, not ' + JSON.stringify( Entry.SkipCount ) + ' (9.4).' );
	}
	if ( typeof Entry.MaxCount !== 'undefined' && !( is_integer( Entry.MaxCount ) && Entry.MaxCount > 0 ) )
	{
		error( path_of( Base, 'MaxCount' ), 'MaxCount must be an integer greater than zero, not ' + JSON.stringify( Entry.MaxCount ) + ' (9.3).' );
	}
	if ( typeof Entry.SkipCount !== 'undefined' && typeof Entry.Sort === 'undefined' )
	{
		warning( path_of( Base, 'SkipCount' ), 'This Query skips documents without a Sort, and a page of an unordered result is not a page (9.4).' );
	}
	return;
}


//---------------------------------------------------------------------
function check_update( Entry, Base, jsongin, error, warning )
{
	check_criteria( Entry, Base, true, '10.1', jsongin, error );
	check_first_only( Entry, Base, '10.3', error );

	let path = path_of( Base, 'Update' );
	if ( !is_object( Entry.Update ) )
	{
		error( path, 'An Update must carry Update, an update document (10.2).' );
		return;
	}
	if ( Object.keys( Entry.Update ).length === 0 )
	{
		warning( path, 'This Update\'s update document is empty, so it changes nothing (10.2).' );
		return;
	}
	try
	{
		jsongin.Update( {}, JSON.parse( JSON.stringify( Entry.Update ) ) );
	}
	catch ( failure )
	{
		error( path, 'jsongin refuses this update document: ' + clause( failure.message ) + ' (7.2).' );
	}
	return;
}


//---------------------------------------------------------------------
function check_delete( Entry, Base, jsongin, error, warning )
{
	let criteria_ok = check_criteria( Entry, Base, true, '11.1', jsongin, error );
	check_first_only( Entry, Base, '11.2', error );

	if ( criteria_ok && Object.keys( Entry.Criteria ).length === 0 )
	{
		warning( path_of( Base, 'Criteria' ), 'This Delete\'s Criteria is {}, so it empties the data source (11.1).' );
	}
	return;
}


//---------------------------------------------------------------------
function check_process( Entry, Base, jsongin, jsonproc, error )
{
	check_criteria( Entry, Base, false, '12.3', jsongin, error );

	if ( typeof Entry.Criteria !== 'undefined' && typeof Entry.DataSource === 'undefined' )
	{
		error( path_of( Base, 'Criteria' ), 'A Process with no DataSource runs once and must not carry a Criteria (12.3).' );
	}

	if ( !Array.isArray( Entry.Steps ) )
	{
		error( path_of( Base, 'Steps' ), 'A Process must carry Steps, an array of jsonproc steps (12.2).' );
		return;
	}
	check_steps( Entry.Steps, path_of( Base, 'Steps' ), jsongin, jsonproc, error );
	return;
}


//---------------------------------------------------------------------
// Each step, and the steps nested inside it (12.2, 12.7, 12.8).

function check_steps( Steps, Path, jsongin, jsonproc, error )
{
	let operators = Object.keys( jsonproc.StepOperators );

	for ( let index = 0; index < Steps.length; index++ )
	{
		let step = Steps[ index ];
		let step_path = path_of( Path, index );

		if ( !is_object( step ) || Object.keys( step ).length !== 1 )
		{
			error( step_path, 'A step must be a JSON object holding exactly one step operator (12.2).' );
			continue;
		}

		let operator = Object.keys( step )[ 0 ];
		if ( !operators.includes( operator ) )
		{
			error( path_of( step_path, operator ), 'Unknown step operator [' + operator + ']; jsonproc defines ' + operators.join( ', ' ) + ' (12.2).' );
			continue;
		}

		let body = step[ operator ];
		if ( operator === '$call' ) { check_call( body, path_of( step_path, '$call' ), jsongin, error ); }

		let nested = Names.NESTED_STEPS[ operator ];
		if ( !nested || !is_object( body ) ) { continue; }
		for ( let field_index = 0; field_index < nested.length; field_index++ )
		{
			let field = nested[ field_index ];
			if ( typeof body[ field ] === 'undefined' ) { continue; }
			let nested_path = path_of( step_path, operator + '.' + field );
			if ( !Array.isArray( body[ field ] ) )
			{
				error( nested_path, operator + '.' + field + ' must be an array of steps (12.2).' );
				continue;
			}
			check_steps( body[ field ], nested_path, jsongin, jsonproc, error );
		}
	}
	return;
}


//---------------------------------------------------------------------
// The first query or update operator a value holds outside `$literal`, as { Operator, Path }, or
// null.

function bare_operator( Value, Operators, Path )
{
	if ( Array.isArray( Value ) )
	{
		for ( let index = 0; index < Value.length; index++ )
		{
			let found = bare_operator( Value[ index ], Operators, path_of( Path, index ) );
			if ( found !== null ) { return found; }
		}
		return null;
	}
	if ( !is_object( Value ) ) { return null; }
	if ( Object.prototype.hasOwnProperty.call( Value, '$literal' ) ) { return null; }

	let keys = Object.keys( Value );
	for ( let index = 0; index < keys.length; index++ )
	{
		let key = keys[ index ];
		if ( Operators.includes( key ) ) { return { Operator: key, Path: path_of( Path, key ) }; }
		let found = bare_operator( Value[ key ], Operators, path_of( Path, key ) );
		if ( found !== null ) { return found; }
	}
	return null;
}


//---------------------------------------------------------------------
function check_call( Call, Path, jsongin, error )
{
	if ( !is_object( Call ) )
	{
		error( Path, 'A $call must be a JSON object carrying a Name (12.7).' );
		return;
	}
	if ( !is_name( Call.Name ) )
	{
		error( path_of( Path, 'Name' ), 'A $call must carry a Name, a non-empty string (12.7).' );
		return;
	}

	if ( Names.HOST_FUNCTIONS.includes( Call.Name ) )
	{
		if ( !is_object( Call.With ) || typeof Call.With.DataSource === 'undefined' )
		{
			error( path_of( Path, 'With' ), 'A call to ' + Call.Name + ' must carry With.DataSource naming a data source (12.7).' );
			return;
		}
		if ( !is_name( Call.With.DataSource ) )
		{
			error( path_of( Path, 'With.DataSource' ), 'With.DataSource must be a non-empty string (12.7).' );
		}

		// ***With is an expression document***, so jsonproc reads a query or update operator inside
		// it as an expression operator: one fails, and `$gt` over an array silently becomes a
		// boolean (measured 2026-09-13). `$literal` passes the document through (user, 2026-09-13).
		let kinds = [
			{ Field: 'Criteria', Operators: Object.keys( jsongin.QueryOperators ), Sort: 'a query operator', What: 'the criteria' },
			{ Field: 'Updates', Operators: Object.keys( jsongin.UpdateOperators ), Sort: 'an update operator', What: 'the update document' },
		];
		for ( let index = 0; index < kinds.length; index++ )
		{
			let kind = kinds[ index ];
			let found = bare_operator( Call.With[ kind.Field ], kind.Operators, path_of( Path, 'With.' + kind.Field ) );
			if ( found === null ) { continue; }
			error( found.Path, '[' + found.Operator + '] is ' + kind.Sort + ', but With is an expression document, so jsonproc would read it as an expression; wrap ' + kind.What + ' in $literal (12.7).' );
		}
		return;
	}

	if ( typeof Call.With !== 'undefined' )
	{
		error( path_of( Path, 'With' ), 'A $call which names an object takes no With; the object runs exactly as written (12.8).' );
	}
	return;
}


//---------------------------------------------------------------------
// A trigger's own fields (13.1, 13.3, 13.5). Its Process is resolved with the other references.

function check_trigger( Item, error )
{
	let entry = Item.Entry;
	let base = Item.Path;

	if ( typeof entry.On !== 'undefined' )
	{
		if ( !Array.isArray( entry.On ) || entry.On.length === 0 )
		{
			error( path_of( base, 'On' ), 'On must be a non-empty array of storage function names (13.3).' );
		}
		else
		{
			for ( let index = 0; index < entry.On.length; index++ )
			{
				if ( !TRIGGER_FUNCTIONS.includes( entry.On[ index ] ) )
				{
					error( path_of( base, 'On.' + index ), 'A trigger cannot fire on [' + entry.On[ index ] + ']; it fires on ' + TRIGGER_FUNCTIONS.join( ', ' ) + ' (13.3).' );
				}
			}
		}
	}

	if ( typeof entry.When !== 'undefined' )
	{
		if ( entry.When !== 'Before' && entry.When !== 'After' )
		{
			error( path_of( base, 'When' ), 'When must be "Before" or "After", not ' + JSON.stringify( entry.When ) + ' (13.5).' );
		}
		else if ( typeof entry.On === 'undefined' )
		{
			error( path_of( base, 'When' ), 'When must not appear without On; a trigger with no On is manual (13.5).' );
		}
	}

	if ( !is_name( entry.Process ) )
	{
		error( path_of( base, 'Process' ), 'A trigger must carry Process, the name of a Process in Objects (13.1).' );
	}
	return;
}


//---------------------------------------------------------------------
// Every name used resolves to an entry of the right sort (3.8, 12.9, 13.1).

function check_references( Document, References, error )
{
	let first = {};
	let entries = Names.Entries( Document );
	for ( let index = 0; index < entries.length; index++ )
	{
		let item = entries[ index ];
		if ( item.Name !== null && !Object.prototype.hasOwnProperty.call( first, item.Name ) ) { first[ item.Name ] = item; }
	}

	function sort_of( Item )
	{
		if ( Item.Section === 'DataSources' ) { return 'a data source'; }
		if ( Item.Section === 'Triggers' ) { return 'a trigger'; }
		return ( typeof Item.Entry.Kind === 'string' ) ? article( Item.Entry.Kind ).toLowerCase() : 'an object';
	}

	for ( let index = 0; index < References.length; index++ )
	{
		let reference = References[ index ];
		let target = Object.prototype.hasOwnProperty.call( first, reference.Name ) ? first[ reference.Name ] : null;
		let name = '[' + reference.Name + ']';

		if ( reference.Sort === 'DataSource' )
		{
			if ( target === null ) { error( reference.Path, 'No data source is named ' + name + ' (3.8).' ); }
			else if ( target.Section !== 'DataSources' ) { error( reference.Path, name + ' is ' + sort_of( target ) + ', not a data source (3.8).' ); }
			continue;
		}

		if ( reference.Sort === 'Object' )
		{
			if ( target === null ) { error( reference.Path, name + ' is neither a host function nor an object of this file (12.9).' ); }
			else if ( target.Section !== 'Objects' ) { error( reference.Path, name + ' is ' + sort_of( target ) + '; a $call names a host function or an object (12.9).' ); }
			continue;
		}

		if ( reference.Sort === 'Process' )
		{
			if ( target === null ) { error( reference.Path, 'No Process is named ' + name + ' (13.1).' ); }
			else if ( target.Section !== 'Objects' || target.Entry.Kind !== 'Process' ) { error( reference.Path, name + ' is ' + sort_of( target ) + ', not a Process (13.1).' ); }
			else if ( typeof target.Entry.DataSource === 'undefined' ) { error( reference.Path, 'The Process ' + name + ' has no DataSource, so there is nothing for a trigger to watch (13.1).' ); }
		}
	}
	return;
}


//---------------------------------------------------------------------
// No Process calls itself, directly or through the objects it calls (12.8).

function check_cycles( Document, References, error )
{
	let processes = {};
	let entries = Names.Entries( Document );
	for ( let index = 0; index < entries.length; index++ )
	{
		let item = entries[ index ];
		if ( item.Section !== 'Objects' || item.Entry.Kind !== 'Process' || item.Name === null ) { continue; }
		if ( Object.prototype.hasOwnProperty.call( processes, item.Name ) ) { continue; }
		processes[ item.Name ] = { Item: item, Order: index, Calls: [] };
	}

	for ( let index = 0; index < References.length; index++ )
	{
		let reference = References[ index ];
		if ( reference.Sort !== 'Object' ) { continue; }
		if ( !Object.prototype.hasOwnProperty.call( processes, reference.Owner ) ) { continue; }
		if ( !Object.prototype.hasOwnProperty.call( processes, reference.Name ) ) { continue; }
		let calls = processes[ reference.Owner ].Calls;
		if ( !calls.includes( reference.Name ) ) { calls.push( reference.Name ); }
	}

	let reported = [];
	let state = {};

	function visit( Name, Stack )
	{
		state[ Name ] = 'active';
		Stack.push( Name );

		let calls = processes[ Name ].Calls;
		for ( let index = 0; index < calls.length; index++ )
		{
			let callee = calls[ index ];
			if ( state[ callee ] === 'active' )
			{
				let cycle = Stack.slice( Stack.indexOf( callee ) );
				let key = cycle.slice().sort().join( '\t' );
				if ( reported.includes( key ) ) { continue; }
				reported.push( key );

				// Reported once, on the member which comes first in the file.
				let first = cycle[ 0 ];
				for ( let member = 1; member < cycle.length; member++ )
				{
					if ( processes[ cycle[ member ] ].Order < processes[ first ].Order ) { first = cycle[ member ]; }
				}
				let start = cycle.indexOf( first );
				let ordered = cycle.slice( start ).concat( cycle.slice( 0, start ) ).concat( [ first ] );
				error( processes[ first ].Item.Path, 'The Process [' + first + '] calls itself: ' + ordered.join( ' -> ' ) + ' (12.8).' );
				continue;
			}
			if ( typeof state[ callee ] === 'undefined' ) { visit( callee, Stack ); }
		}

		Stack.pop();
		state[ Name ] = 'done';
	}

	let names = Object.keys( processes );
	for ( let index = 0; index < names.length; index++ )
	{
		if ( typeof state[ names[ index ] ] === 'undefined' ) { visit( names[ index ], [] ); }
	}
	return;
}


//---------------------------------------------------------------------
// A data source, or an object other than a Process, which nothing refers to (14.3.2).

function check_unreferenced( Document, References, note )
{
	let used = References.map( function ( Reference ) { return Reference.Name; } );
	let seen = [];
	let entries = Names.Entries( Document );

	for ( let index = 0; index < entries.length; index++ )
	{
		let item = entries[ index ];
		if ( item.Name === null || seen.includes( item.Name ) ) { continue; }
		seen.push( item.Name );
		if ( used.includes( item.Name ) ) { continue; }

		if ( item.Section === 'DataSources' )
		{
			note( item.Path, 'Nothing in this file refers to the data source [' + item.Name + '] (14.3.2).' );
		}
		else if ( item.Section === 'Objects' && typeof item.Entry.Kind === 'string' && item.Entry.Kind !== 'Process' )
		{
			note( item.Path, 'Nothing in this file calls the ' + item.Entry.Kind + ' [' + item.Name + ']; it runs only when asked for by name (14.3.2).' );
		}
	}
	return;
}


//---------------------------------------------------------------------
// A library's message, ready to have a section cited after it.

function clause( Message )
{
	return String( Message ).replace( /[.\s]+$/, '' );
}


//---------------------------------------------------------------------
// The entry a path is inside (`Objects.3` for `Objects.3.Steps.0`), or the path itself when it
// is not inside one.

function entry_scope( Path )
{
	let parts = Path.split( '.' );
	if ( parts.length >= 2 && Names.SECTIONS.includes( parts[ 0 ] ) && /^\d+$/.test( parts[ 1 ] ) )
	{
		return parts[ 0 ] + '.' + parts[ 1 ];
	}
	return Path;
}


//---------------------------------------------------------------------
// Any schema finding which no hand finding covers, reported as a generic error.
//
// ***Covered means a hand error in the same entry***, or one on a path containing the schema's.
// The schema checks an object against every kind through `oneOf`, so a single missing Criteria
// comes back as mismatches at the object, at its Kind, and at fields of the other kinds -
// comparing paths exactly would report every one of those again.

function cross_check_schema( Document, jsongin, Findings, error )
{
	let schema_findings = [];
	try
	{
		schema_findings = jsongin.ValidateDocument( Document, Schema.SCHEMA );
	}
	catch ( failure )
	{
		error( '', 'The jsonx schema could not be applied: ' + failure.message + ' (Appendix A).' );
		return;
	}

	let hand_paths = Findings
		.filter( function ( Finding ) { return Finding.Severity === 'error'; } )
		.map( function ( Finding ) { return Finding.Path; } );

	let added = [];
	for ( let index = 0; index < schema_findings.length; index++ )
	{
		let finding = schema_findings[ index ];
		let path = PointerToPath( finding.instanceLocation );
		let scope = entry_scope( path );
		let covered = hand_paths.some( function ( HandPath )
		{
			if ( scope !== path && entry_scope( HandPath ) === scope ) { return true; }
			return contains( HandPath, path ) || contains( path, HandPath );
		} );
		if ( covered ) { continue; }

		let key = path + '\t' + finding.error;
		if ( added.includes( key ) ) { continue; }
		added.push( key );
		error( path, 'Does not match the jsonx schema: ' + clause( finding.error ) + ' (Appendix A).' );
	}
	return;
}


//---------------------------------------------------------------------
function contains( Outer, Inner )
{
	if ( Outer === '' ) { return true; }
	return ( Inner === Outer ) || Inner.startsWith( Outer + '.' );
}


//---------------------------------------------------------------------
// A JSON pointer as a dotted path: `/Objects/6/Criteria` becomes `Objects.6.Criteria`.

function PointerToPath( Pointer )
{
	if ( typeof Pointer !== 'string' || Pointer === '' ) { return ''; }
	return Pointer.split( '/' ).slice( 1 )
		.map( function ( Part ) { return Part.replace( /~1/g, '/' ).replace( /~0/g, '~' ); } )
		.join( '.' );
}


//---------------------------------------------------------------------
// Errors, then warnings, then notes; file order kept within each.

function SortFindings( Findings )
{
	return Findings
		.map( function ( Finding, Index ) { return { Finding: Finding, Index: Index }; } )
		.sort( function ( Left, Right )
		{
			let by_severity = SEVERITY_ORDER[ Left.Finding.Severity ] - SEVERITY_ORDER[ Right.Finding.Severity ];
			return ( by_severity !== 0 ) ? by_severity : ( Left.Index - Right.Index );
		} )
		.map( function ( Pair ) { return Pair.Finding; } );
}


//---------------------------------------------------------------------
// The findings for one entry: those whose path is the entry's or inside it. Null when no entry
// carries the name.

function ValidateEntry( Document, Name, Options )
{
	let item = Names.FindEntry( Document, Name );
	if ( item === null ) { return null; }

	return ValidateFile( Document, Options ).filter( function ( Finding )
	{
		return contains( item.Path, Finding.Path ) && Finding.Path !== '';
	} );
}


//---------------------------------------------------------------------
// Counts by severity.

function Summarize( Findings )
{
	let summary = { Errors: 0, Warnings: 0, Notes: 0 };
	for ( let index = 0; index < Findings.length; index++ )
	{
		let severity = Findings[ index ].Severity;
		if ( severity === 'error' ) { summary.Errors++; }
		if ( severity === 'warning' ) { summary.Warnings++; }
		if ( severity === 'note' ) { summary.Notes++; }
	}
	return summary;
}


//---------------------------------------------------------------------
module.exports = {
	KINDS: KINDS,
	TRIGGER_FUNCTIONS: TRIGGER_FUNCTIONS,
	ValidateFile: ValidateFile,
	ValidateEntry: ValidateEntry,
	SortFindings: SortFindings,
	Summarize: Summarize,
	PointerToPath: PointerToPath,
};
