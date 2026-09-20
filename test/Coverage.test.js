'use strict';

/*
	Library coverage (plan F3.12): every public jsongin function, every Storage Interface function, and
	jsonproc's Start, Execute, Step and Resume are reachable from the command table.

	***A command says what it reaches*** with `Library: [ 'jsongin.Filter', 'jsonstor.FindMany2' ]`.
	This test fails when an export has no command and is not in NOT_COMMANDS, when a NOT_COMMANDS
	entry names nothing or is also declared, and when a command declares something which is not an
	export - so the list cannot drift either way. The same idea as Explain's operator coverage test,
	which fails on an unphrased operator.
*/

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );
const jsonstor = require( '@liquicode/jsonstor' );

const Commands = require( '../commands/jsonx.js' );


//---------------------------------------------------------------------
// The exports no command reaches, each with the reason.

const NOT_COMMANDS = {
	'jsongin.NewJsongin': 'engine machinery: builds another engine',
	'jsongin.Library': 'engine machinery: the package description',
	'jsongin.Settings': 'engine machinery: the engine\'s settings',
	'jsongin.OpLog': 'engine machinery: a logging hook',
	'jsongin.OpError': 'engine machinery: an error hook',
	'jsongin.Text': 'engine machinery: string helpers the operators use',
	'jsongin.Clone': 'identity on the command line: a value read is already a copy',
	'jsongin.SafeClone': 'identity on the command line',
	'jsongin.Parse': 'every command\'s input: the parser reads JSON already',
	'jsongin.Format': 'every command\'s output: --output writes JSON already',
	'jsongin.ShortType': 'a value predicate with no document-level use',
	'jsongin.BsonType': 'a value predicate with no document-level use',
	'jsongin.AsNumber': 'a value conversion with no document-level use',
	'jsongin.AsBoolean': 'a value conversion with no document-level use',
	'jsongin.AsDate': 'a value conversion with no document-level use',
	'jsongin.CompareValues': 'a value comparison; engine sort reaches it',
	'jsongin.LooseEquals': 'a value comparison with no document-level use',
	'jsongin.StrictEquals': 'a value comparison with no document-level use',
	'jsongin.IsQuery': 'a predicate over a criteria\'s shape',
	'jsongin.SplitPath': 'path plumbing; engine get reads a path',
	'jsongin.JoinPaths': 'path plumbing',
	'jsongin.ResolveCandidates': 'path plumbing',
	'jsongin.SetValue': 'path plumbing; engine update sets values',
	'jsongin.DeleteValue': 'path plumbing; engine update removes values',
	'jsongin.Hybridize': 'a storage encoding for adapters, not for documents a person reads',
	'jsongin.Unhybridize': 'a storage encoding for adapters',
};


//---------------------------------------------------------------------
// ***`StorageInterface()` returns fourteen stubs and no FindMany2***, measured by jsonx-studio and
// tracked in jsonstor's story (user, 2026-09-13). When that is fixed, drop the addition below, and
// the count assertion says so.

function storage_functions()
{
	let names = Object.keys( jsonstor().StorageInterface() ).filter( function ( Name ) { return /^[A-Z]/.test( Name ); } );
	if ( !names.includes( 'FindMany2' ) ) { names.push( 'FindMany2' ); }
	return names;
}


function library_exports()
{
	let exports = [];
	Object.keys( jsongin ).forEach( function ( Name ) { exports.push( 'jsongin.' + Name ); } );
	storage_functions().forEach( function ( Name ) { exports.push( 'jsonstor.' + Name ); } );
	[ 'Start', 'Execute', 'Step', 'Resume' ].forEach( function ( Name ) { exports.push( 'jsonproc.' + Name ); } );
	return exports;
}


// Every Library declaration in a tree, with the command which declares it.
function declared_in( Tree )
{
	let declared = {};
	function walk( Node, Path )
	{
		( Array.isArray( Node.Library ) ? Node.Library : [] ).forEach( function ( Name )
		{
			if ( !declared[ Name ] ) { declared[ Name ] = []; }
			declared[ Name ].push( Path.join( ' ' ) );
		} );
		( Array.isArray( Node.Commands ) ? Node.Commands : [] ).forEach( function ( Child ) { walk( Child, Path.concat( [ Child.Command ] ) ); } );
	}
	walk( Tree, [ Tree.Command ] );
	return declared;
}


// The three ways the coverage can be wrong, each a list.
function coverage_problems( Exports, Declared, NotCommands )
{
	return {
		Uncovered: Exports.filter( function ( Name ) { return !Declared[ Name ] && !Object.prototype.hasOwnProperty.call( NotCommands, Name ); } ),
		NotExports: Object.keys( Declared ).filter( function ( Name ) { return !Exports.includes( Name ); } ),
		StaleExemptions: Object.keys( NotCommands ).filter( function ( Name ) { return !Exports.includes( Name ) || Boolean( Declared[ Name ] ); } ),
	};
}


//---------------------------------------------------------------------
describe( 'Library coverage (F3.12)', function ()
{

	it( 'counts fifteen storage functions and jsonproc\'s four', function ()
	{
		LIB_ASSERT.strictEqual( storage_functions().length, 15, storage_functions().join( ', ' ) );
		[ 'Start', 'Execute', 'Step', 'Resume' ].forEach( function ( Name ) { LIB_ASSERT.strictEqual( typeof jsonproc[ Name ], 'function', Name ); } );
	} );

	it( 'reaches every export from a command, or says why not', function ()
	{
		let problems = coverage_problems( library_exports(), declared_in( Commands.TREE ), NOT_COMMANDS );
		LIB_ASSERT.deepStrictEqual( problems, { Uncovered: [], NotExports: [], StaleExemptions: [] } );
	} );

	it( 'fails for an export nothing reaches, a declaration of nothing, and a stale exemption', function ()
	{
		let exports = [ 'jsongin.Filter', 'jsongin.Brand', 'jsongin.Clone' ];
		let declared = { 'jsongin.Filter': [ 'jsonx engine filter' ], 'jsongin.Imaginary': [ 'jsonx x' ], 'jsongin.Clone': [ 'jsonx y' ] };
		let exemptions = { 'jsongin.Clone': 'identity', 'jsongin.Gone': 'removed' };
		LIB_ASSERT.deepStrictEqual( coverage_problems( exports, declared, exemptions ), {
			Uncovered: [ 'jsongin.Brand' ],
			NotExports: [ 'jsongin.Imaginary' ],
			StaleExemptions: [ 'jsongin.Clone', 'jsongin.Gone' ],
		} );
	} );

	it( 'gives every exemption a reason', function ()
	{
		Object.keys( NOT_COMMANDS ).forEach( function ( Name ) { LIB_ASSERT.ok( NOT_COMMANDS[ Name ].length > 10, Name ); } );
	} );

} );
