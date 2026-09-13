'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Validate = require( '../src/Validate/Validate.js' );
const Spec = require( './fixtures/Spec.js' );

/*
	Appendix B's indexes, which every case below changes one thing in:

		DataSources  0 Telescopes  1 Bookings  2 Assignments  3 Notes
		Objects      0 Two telescopes (Insert)          1 Three bookings (Insert)
		             2 Confirm the bookings... (Update) 3 Drop the cancelled bookings (Delete)
		             4 Assign a dome... (Process, Bookings, Into Assignments)
		             5 Note a long booking (Process, Bookings, Into Notes)
		             6 Prepare the season (Process, no DataSource, calls 0-4)
		Triggers     0 Note every long booking as it arrives -> Note a long booking
*/


//---------------------------------------------------------------------
// Validates Appendix B after a change, and holds every result to the completeness rule: the
// schema never has to add a finding the hand checks missed.

function validate( Change, Options )
{
	let document = Spec.AppendixB();
	if ( typeof Change === 'function' ) { Change( document ); }
	let findings = Validate.ValidateFile( document, Object.assign( { Env: {} }, Options || {} ) );

	let generic = findings.filter( function ( Finding ) { return /Does not match the jsonx schema/.test( Finding.Message ); } );
	LIB_ASSERT.deepStrictEqual( generic, [], 'the hand checks missed something the schema caught' );
	return findings;
}

function expect( Findings, Severity, Path, Pattern )
{
	let found = Findings.some( function ( Finding )
	{
		return Finding.Severity === Severity && Finding.Path === Path && Pattern.test( Finding.Message );
	} );
	LIB_ASSERT.ok( found, 'expected ' + Severity + ' at [' + Path + '] matching ' + Pattern + ' in:\n' + JSON.stringify( Findings, null, 2 ) );
}

function absent( Findings, Path )
{
	let found = Findings.filter( function ( Finding ) { return Finding.Path === Path; } );
	LIB_ASSERT.deepStrictEqual( found, [], 'expected no finding at [' + Path + ']' );
}


//---------------------------------------------------------------------
describe( 'Validate 14.1: the file', function ()
{

	it( '14.1.1 a file which is not an object', function ()
	{
		let findings = Validate.ValidateFile( [], {} );
		expect( findings, 'error', '', /must be a JSON object, not an array \(3\.1\)/ );
	} );

	it( '14.1.2 Jsonx, Name and Description of the wrong type', function ()
	{
		let findings = validate( function ( D ) { D.Jsonx = 2; D.Name = ''; D.Description = 5; } );
		expect( findings, 'error', 'Jsonx', /must be a string/ );
		expect( findings, 'error', 'Name', /non-empty string \(3\.2\)/ );
		expect( findings, 'error', 'Description', /must be a string/ );
	} );

	it( '14.1.3 a section which is not an array, and an element which is not an object', function ()
	{
		expect( validate( function ( D ) { D.Triggers = 'x'; } ), 'error', 'Triggers', /must be an array/ );
		expect( validate( function ( D ) { D.Objects.push( 7 ); } ), 'error', 'Objects.7', /must be a JSON object, not a number/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.1.4: names', function ()
{

	it( 'a missing Name, and one which is not a non-empty string', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 0 ].Name; } ), 'error', 'Objects.0.Name', /must carry a Name \(3\.5\)/ );
		expect( validate( function ( D ) { D.Triggers[ 0 ].Name = 5; } ), 'error', 'Triggers.0.Name', /non-empty string \(3\.5\)/ );
	} );

	it( 'a name repeated across sections', function ()
	{
		let findings = validate( function ( D ) { D.DataSources[ 0 ].Name = 'Prepare the season'; } );
		expect( findings, 'error', 'Objects.6.Name', /already used by DataSources\.0/ );
	} );

	it( 'a reserved name', function ()
	{
		expect( validate( function ( D ) { D.DataSources[ 3 ].Name = 'FindOne'; } ), 'error', 'DataSources.3.Name', /reserved for a host function \(3\.6\)/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.1.5: data sources', function ()
{

	it( 'AdapterName, Settings and Filters', function ()
	{
		expect( validate( function ( D ) { delete D.DataSources[ 0 ].AdapterName; } ), 'error', 'DataSources.0.AdapterName', /\(4\.1\)/ );
		expect( validate( function ( D ) { D.DataSources[ 0 ].Settings = []; } ), 'error', 'DataSources.0.Settings', /\(4\.2\)/ );
		expect( validate( function ( D ) { D.DataSources[ 0 ].Filters = {}; } ), 'error', 'DataSources.0.Filters', /\(4\.3\)/ );

		let findings = validate( function ( D ) { D.DataSources[ 0 ].Filters = [ {}, { FilterName: 'x', Settings: 's' }, 3 ]; } );
		expect( findings, 'error', 'DataSources.0.Filters.0.FilterName', /FilterName/ );
		expect( findings, 'error', 'DataSources.0.Filters.1.Settings', /must be a JSON object/ );
		expect( findings, 'error', 'DataSources.0.Filters.2', /must be a JSON object/ );
	} );

	it( 'settings against the adapter, through CheckSettings', function ()
	{
		let asked = [];
		let findings = validate( null, {
			CheckSettings: function ( AdapterName, Settings )
			{
				asked.push( AdapterName );
				if ( AdapterName !== 'jsonstor-memory' || asked.length > 1 ) { return []; }
				return [
					{ Severity: 'error', Path: 'Settings.Path', Message: 'Path is required.' },
					{ Severity: 'warning', Path: 'Settings.Extra', Message: 'Extra is not described.' },
				];
			},
		} );
		LIB_ASSERT.strictEqual( asked.length, 4 );
		expect( findings, 'error', 'DataSources.0.Settings.Path', /Path is required/ );
		expect( findings, 'warning', 'DataSources.0.Settings.Extra', /not described/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.1.6-8: Kind, DataSource and Into', function ()
{

	it( '14.1.6 a missing or unknown Kind', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 0 ].Kind; } ), 'error', 'Objects.0.Kind', /must carry a Kind/ );
		expect( validate( function ( D ) { D.Objects[ 0 ].Kind = 'Upsert'; } ), 'error', 'Objects.0.Kind', /Unknown Kind \[Upsert\]/ );
	} );

	it( '14.1.7 a missing, empty, undefined or wrong-sort DataSource or Into', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 0 ].DataSource; } ), 'error', 'Objects.0.DataSource', /An Insert must carry a DataSource/ );
		expect( validate( function ( D ) { D.Objects[ 2 ].DataSource = ''; } ), 'error', 'Objects.2.DataSource', /non-empty string/ );
		expect( validate( function ( D ) { D.Objects[ 2 ].DataSource = 'Two telescopes'; } ), 'error', 'Objects.2.DataSource', /is an insert, not a data source \(3\.8\)/ );
		expect( validate( function ( D ) { D.Objects[ 4 ].Into = 'Nowhere'; } ), 'error', 'Objects.4.Into', /No data source is named \[Nowhere\]/ );
	} );

	it( '14.1.8 an Into on a kind which takes none, and an Into equal to the DataSource', function ()
	{
		expect( validate( function ( D ) { D.Objects[ 2 ].Into = 'Notes'; } ), 'error', 'Objects.2.Into', /does not take an Into/ );
		expect( validate( function ( D ) { D.Objects[ 4 ].Into = 'Bookings'; } ), 'error', 'Objects.4.Into', /own DataSource as its Into/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.1.9-13: the kinds', function ()
{

	it( '14.1.9 Documents', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 0 ].Documents; } ), 'error', 'Objects.0.Documents', /\(8\.1\)/ );
		expect( validate( function ( D ) { D.Objects[ 0 ].Documents = [ 1 ]; } ), 'error', 'Objects.0.Documents.0', /must be a JSON object/ );
	} );

	it( '14.1.10 Criteria missing, not an object, or refused by jsongin', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 2 ].Criteria; } ), 'error', 'Objects.2.Criteria', /must carry a Criteria.*\(10\.1\)/ );
		expect( validate( function ( D ) { D.Objects[ 3 ].Criteria = []; } ), 'error', 'Objects.3.Criteria', /must be a JSON object, not an array/ );
		expect( validate( function ( D ) { D.Objects[ 2 ].Criteria = { Hours: { $size: 2.5 } }; } ), 'error', 'Objects.2.Criteria', /jsongin refuses this Criteria: .*\$size.* \(7\.1\)\.$/ );
		expect( validate( function ( D ) { D.Objects.push( { Kind: 'Query', Name: 'Q', DataSource: 'Bookings' } ); } ), 'error', 'Objects.7.Criteria', /\(9\.1\)/ );
	} );

	it( '14.1.11 Projection, Sort, MaxCount and SkipCount', function ()
	{
		let findings = validate( function ( D )
		{
			D.Objects.push( { Kind: 'Query', Name: 'Q', DataSource: 'Bookings', Criteria: {}, Projection: [], Sort: { Night: 2 }, MaxCount: 0, SkipCount: -1 } );
		} );
		expect( findings, 'error', 'Objects.7.Projection', /\(7\.4\)/ );
		expect( findings, 'error', 'Objects.7.Sort.Night', /must be 1 or -1, not 2/ );
		expect( findings, 'error', 'Objects.7.MaxCount', /greater than zero/ );
		expect( findings, 'error', 'Objects.7.SkipCount', /zero or more/ );

		expect( validate( function ( D ) { D.Objects.push( { Kind: 'Query', Name: 'Q', DataSource: 'Bookings', Criteria: {}, Sort: [ { Field: 'Night' } ] } ); } ),
			'error', 'Objects.7.Sort', /must be a JSON object of field names, not an array/ );
	} );

	it( '14.1.12 an Update document missing or refused by jsongin', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 2 ].Update; } ), 'error', 'Objects.2.Update', /\(10\.2\)/ );
		expect( validate( function ( D ) { D.Objects[ 2 ].Update = { $nope: 1 }; } ), 'error', 'Objects.2.Update', /jsongin refuses this update document: .*\$nope.*[^.] \(7\.2\)\.$/ );
	} );

	it( '14.1.13 FirstOnly which is not a boolean', function ()
	{
		expect( validate( function ( D ) { D.Objects[ 3 ].FirstOnly = 'yes'; } ), 'error', 'Objects.3.FirstOnly', /\(11\.2\)/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.1.14-16: Process, $call and cycles', function ()
{

	it( '14.1.14 Steps, a malformed step, an unknown operator nested in $try.Catch, and Criteria with no DataSource', function ()
	{
		expect( validate( function ( D ) { delete D.Objects[ 5 ].Steps; } ), 'error', 'Objects.5.Steps', /\(12\.2\)/ );
		expect( validate( function ( D ) { D.Objects[ 5 ].Steps[ 0 ] = { $do: {}, $return: 1 }; } ), 'error', 'Objects.5.Steps.0', /exactly one step operator/ );
		expect( validate( function ( D ) { D.Objects[ 6 ].Steps.push( { $try: { Do: [], Catch: [ { $bogus: 1 } ] } } ); } ),
			'error', 'Objects.6.Steps.6.$try.Catch.0.$bogus', /Unknown step operator \[\$bogus\]/ );
		expect( validate( function ( D ) { D.Objects[ 6 ].Criteria = {}; } ), 'error', 'Objects.6.Criteria', /no DataSource runs once and must not carry a Criteria/ );
	} );

	it( '14.1.15 a $call naming nothing, naming an object with With, or naming a data source', function ()
	{
		expect( validate( function ( D ) { D.Objects[ 6 ].Steps[ 0 ] = { $call: { Name: 'Nothing' } }; } ),
			'error', 'Objects.6.Steps.0.$call.Name', /\[Nothing\] is neither a host function nor an object of this file \(12\.9\)/ );
		expect( validate( function ( D ) { D.Objects[ 6 ].Steps[ 0 ].$call.With = { X: 1 }; } ),
			'error', 'Objects.6.Steps.0.$call.With', /takes no With/ );
		expect( validate( function ( D ) { D.Objects[ 6 ].Steps[ 0 ] = { $call: { Name: 'Notes' } }; } ),
			'error', 'Objects.6.Steps.0.$call.Name', /is a data source; a \$call names/ );
		expect( validate( function ( D ) { D.Objects[ 6 ].Steps[ 0 ] = { $call: {} }; } ),
			'error', 'Objects.6.Steps.0.$call.Name', /must carry a Name/ );
	} );

	it( '14.1.15 a host function call without, or with an undefined, literal With.DataSource', function ()
	{
		expect( validate( function ( D ) { D.Objects[ 4 ].Steps[ 0 ].$call.With = { Criteria: {} }; } ),
			'error', 'Objects.4.Steps.0.$call.With', /A call to FindOne must carry With\.DataSource/ );
		expect( validate( function ( D ) { D.Objects[ 4 ].Steps[ 0 ].$call.With.DataSource = 'Nowhere'; } ),
			'error', 'Objects.4.Steps.0.$call.With.DataSource', /No data source is named \[Nowhere\]/ );

		let computed = validate( function ( D ) { D.Objects[ 4 ].Steps[ 0 ].$call.With.DataSource = '$Document.Source'; } );
		absent( computed, 'Objects.4.Steps.0.$call.With.DataSource' );
	} );

	it( '14.1.16 a Process calling itself, directly and through another, reported once', function ()
	{
		expect( validate( function ( D ) { D.Objects[ 6 ].Steps.push( { $call: { Name: 'Prepare the season' } } ); } ),
			'error', 'Objects.6', /\[Prepare the season\] calls itself: Prepare the season -> Prepare the season \(12\.8\)/ );

		let findings = validate( function ( D )
		{
			D.Objects[ 5 ].Steps.unshift( { $call: { Name: 'Prepare the season' } } );
			D.Objects[ 6 ].Steps.push( { $call: { Name: 'Note a long booking' } } );
		} );
		let cycles = findings.filter( function ( Finding ) { return /calls itself/.test( Finding.Message ); } );
		LIB_ASSERT.strictEqual( cycles.length, 1 );
		expect( findings, 'error', 'Objects.5', /Note a long booking -> Prepare the season -> Note a long booking/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.1.17: triggers', function ()
{

	it( 'On, When and Process', function ()
	{
		expect( validate( function ( D ) { D.Triggers[ 0 ].On = []; } ), 'error', 'Triggers.0.On', /non-empty array/ );
		expect( validate( function ( D ) { D.Triggers[ 0 ].On = [ 'Count' ]; } ), 'error', 'Triggers.0.On.0', /cannot fire on \[Count\]/ );
		expect( validate( function ( D ) { D.Triggers[ 0 ].When = 'Later'; } ), 'error', 'Triggers.0.When', /"Before" or "After"/ );
		expect( validate( function ( D ) { delete D.Triggers[ 0 ].On; } ), 'error', 'Triggers.0.When', /must not appear without On/ );
		expect( validate( function ( D ) { delete D.Triggers[ 0 ].Process; } ), 'error', 'Triggers.0.Process', /must carry Process/ );
		expect( validate( function ( D ) { D.Triggers[ 0 ].Process = 'Nobody'; } ), 'error', 'Triggers.0.Process', /No Process is named \[Nobody\]/ );
		expect( validate( function ( D ) { D.Triggers[ 0 ].Process = 'Confirm the bookings with good seeing'; } ), 'error', 'Triggers.0.Process', /is an update, not a Process/ );
		expect( validate( function ( D ) { D.Triggers[ 0 ].Process = 'Prepare the season'; } ), 'error', 'Triggers.0.Process', /has no DataSource/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate 14.2 and 14.3: warnings and notes', function ()
{

	it( 'an empty Update, an empty Insert, a Delete of everything, and a page without a Sort', function ()
	{
		expect( validate( function ( D ) { D.Objects[ 2 ].Update = {}; } ), 'warning', 'Objects.2.Update', /changes nothing/ );
		expect( validate( function ( D ) { D.Objects[ 0 ].Documents = []; } ), 'warning', 'Objects.0.Documents', /inserts nothing/ );
		expect( validate( function ( D ) { D.Objects[ 3 ].Criteria = {}; } ), 'warning', 'Objects.3.Criteria', /empties the data source/ );
		expect( validate( function ( D ) { D.Objects.push( { Kind: 'Query', Name: 'Q', DataSource: 'Bookings', Criteria: {}, SkipCount: 5 } ); } ),
			'warning', 'Objects.7.SkipCount', /without a Sort/ );
	} );

	it( 'an unset environment variable, and none once it is set', function ()
	{
		let change = function ( D ) { D.DataSources[ 2 ].Settings = { Password: '${env:JSONX_TEST_PASSWORD}' }; };
		expect( validate( change ), 'warning', 'DataSources.2.Settings.Password', /JSONX_TEST_PASSWORD is not set here/ );
		absent( validate( change, { Env: { JSONX_TEST_PASSWORD: 'x' } } ), 'DataSources.2.Settings.Password' );
	} );

	it( 'a later version of the specification, and none for this one or an earlier one', function ()
	{
		expect( validate( function ( D ) { D.Jsonx = '9.1'; } ), 'warning', 'Jsonx', /version 9\.1.*written to 0\.2/ );
		absent( validate( function ( D ) { D.Jsonx = '0.1'; } ), 'Jsonx' );
	} );

	it( 'a data source or a non-Process object nothing refers to; never an unreferenced Process', function ()
	{
		let findings = validate( function ( D )
		{
			D.DataSources.push( { Name: 'Spare', AdapterName: 'jsonstor-memory' } );
			D.Objects.push( { Kind: 'Query', Name: 'Unused query', DataSource: 'Bookings', Criteria: {} } );
		} );
		expect( findings, 'note', 'DataSources.4', /data source \[Spare\]/ );
		expect( findings, 'note', 'Objects.7', /Query \[Unused query\]/ );
		absent( findings, 'Objects.6' );
	} );

} );


//---------------------------------------------------------------------
describe( 'Validate: order and scope', function ()
{

	it( 'lists errors, then warnings, then notes', function ()
	{
		let findings = validate( function ( D )
		{
			D.DataSources.push( { Name: 'Spare', AdapterName: 'jsonstor-memory' } );
			D.Objects[ 2 ].Update = {};
			D.Objects[ 0 ].Kind = 'Upsert';
		} );
		let severities = findings.map( function ( Finding ) { return Finding.Severity; } );
		let sorted = severities.slice().sort( function ( Left, Right ) { return [ 'error', 'warning', 'note' ].indexOf( Left ) - [ 'error', 'warning', 'note' ].indexOf( Right ); } );
		LIB_ASSERT.deepStrictEqual( severities, sorted );
		LIB_ASSERT.deepStrictEqual( [ severities[ 0 ], severities[ severities.length - 1 ] ], [ 'error', 'note' ] );
	} );

	it( 'scopes findings to one entry, and answers null for a name nothing carries', function ()
	{
		let document = Spec.AppendixB();
		document.Objects[ 6 ].Steps[ 0 ] = { $call: { Name: 'Nothing' } };
		document.Objects[ 2 ].Update = {};

		let scoped = Validate.ValidateEntry( document, 'Prepare the season', { Env: {} } );
		LIB_ASSERT.ok( scoped.length > 0 );
		LIB_ASSERT.ok( scoped.every( function ( Finding ) { return Finding.Path.startsWith( 'Objects.6' ); } ) );
		LIB_ASSERT.strictEqual( Validate.ValidateEntry( document, 'Nobody', {} ), null );
	} );

	it( 'turns a JSON pointer into a dotted path', function ()
	{
		LIB_ASSERT.strictEqual( Validate.PointerToPath( '/Objects/6/Steps/0/$call/With~1Odd' ), 'Objects.6.Steps.0.$call.With/Odd' );
		LIB_ASSERT.strictEqual( Validate.PointerToPath( '' ), '' );
	} );

} );
