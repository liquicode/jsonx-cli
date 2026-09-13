'use strict';

/*
	Checks that the type declaration and the ESM wrapper both describe the library which is
	actually running.

	***Both of those files are written by hand, and both drift silently.*** Copied in shape from
	jsonproc's build/types-check.js, which carries the reasoning, and taken two levels deeper
	because this library is a table of components rather than one flat runtime:

		1. The package: every member of src/jsonx-cli.js is declared on JsonxCliLibrary, declared
		   as a named export, and re-exported by src/jsonx-cli.mjs - and nothing more.
		2. The components: every group and component under `Library` is declared on
		   LibraryComponents, and nothing more.
		3. The members: every member a component exports is declared on the interface its
		   LibraryComponents entry names (`Parser: ParserModule;`), and nothing more.

	The declaration is read by indentation, not by understanding TypeScript: an interface sits one
	tab in and its members two, a group's components three.

	Usage:
		npm run types-check
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );

const REPO = LIB_PATH.resolve( __dirname, '..' );
const LIBRARY_FILE = LIB_PATH.join( REPO, 'src', 'jsonx-cli.js' );
const WRAPPER_FILE = LIB_PATH.join( REPO, 'src', 'jsonx-cli.mjs' );
const TYPES_FILE = LIB_PATH.join( REPO, 'types', 'jsonx-cli.d.ts' );


//---------------------------------------------------------------------
function types_lines()
{
	return LIB_FS.readFileSync( TYPES_FILE, 'utf8' ).split( /\r?\n/ );
}


//---------------------------------------------------------------------
// The lines of one interface's body, or null when it is not declared.

function interface_body( Name )
{
	let lines = types_lines();
	let body = [];
	let inside = false;
	for ( let index = 0; index < lines.length; index++ )
	{
		let line = lines[ index ];
		if ( inside === false )
		{
			if ( new RegExp( '^\\texport interface ' + Name + '\\b' ).test( line ) ) { inside = true; }
			continue;
		}
		if ( line === '\t}' ) { return body; }
		body.push( line );
	}
	return inside ? body : null;
}


//---------------------------------------------------------------------
// The member names of an interface: identifiers at two tabs followed by a call, a generic, a
// question mark or a type.

function interface_members( Name )
{
	let body = interface_body( Name );
	if ( body === null ) { return null; }
	let members = [];
	for ( let index = 0; index < body.length; index++ )
	{
		let found = body[ index ].match( /^\t\t([A-Za-z_][A-Za-z0-9_]*)\s*[(<:?]/ );
		if ( found ) { members.push( found[ 1 ] ); }
	}
	return members;
}


//---------------------------------------------------------------------
// LibraryComponents as { 'Group.Component' or 'Component': InterfaceName }.

function declared_components()
{
	let body = interface_body( 'LibraryComponents' ) || [];
	let components = {};
	let group = null;
	for ( let index = 0; index < body.length; index++ )
	{
		let line = body[ index ];
		let opens = line.match( /^\t\t([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*$/ );
		if ( opens ) { group = opens[ 1 ]; continue; }
		if ( /^\t\t\};?\s*$/.test( line ) ) { group = null; continue; }

		let top = line.match( /^\t\t([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/ );
		if ( top && group === null ) { components[ top[ 1 ] ] = top[ 2 ]; continue; }

		let inner = line.match( /^\t\t\t([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/ );
		if ( inner && group !== null ) { components[ group + '.' + inner[ 1 ] ] = inner[ 2 ]; }
	}
	return components;
}


//---------------------------------------------------------------------
// The library's components as { 'Group.Component' or 'Component': module }.
//
// A group is a plain object whose members are all modules; anything else under Library is a
// component itself. The library file says which is which by how it nests its requires.

function running_components( Library, Declared )
{
	let components = {};
	let names = Object.keys( Library );
	for ( let index = 0; index < names.length; index++ )
	{
		let name = names[ index ];
		let value = Library[ name ];
		let declared_as_group = Object.keys( Declared ).some( function ( Key ) { return Key.startsWith( name + '.' ); } );
		let declared_as_component = Object.prototype.hasOwnProperty.call( Declared, name );

		if ( declared_as_group || ( !declared_as_component && Object.keys( value ).every( function ( Key ) { return /^[A-Z]/.test( Key ) && value[ Key ] && typeof value[ Key ] === 'object'; } ) ) )
		{
			let inner = Object.keys( value );
			for ( let inner_index = 0; inner_index < inner.length; inner_index++ )
			{
				components[ name + '.' + inner[ inner_index ] ] = value[ inner[ inner_index ] ];
			}
			continue;
		}
		components[ name ] = value;
	}
	return components;
}


//---------------------------------------------------------------------
function read_names( File, Pattern )
{
	let text = LIB_FS.readFileSync( File, 'utf8' );
	let names = [];
	let found = Pattern.exec( text );
	while ( found !== null )
	{
		names.push( found[ 1 ] );
		found = Pattern.exec( text );
	}
	return names;
}


//---------------------------------------------------------------------
function missing_from( ListA, ListB )
{
	let missing = [];
	for ( let index = 0; index < ListA.length; index++ )
	{
		if ( ListB.includes( ListA[ index ] ) === false ) { missing.push( ListA[ index ] ); }
	}
	return missing;
}


//---------------------------------------------------------------------
function Check()
{
	let library = require( LIBRARY_FILE );
	let library_members = Object.keys( library );
	let declared_members = interface_members( 'JsonxCliLibrary' ) || [];
	let declared_exports = read_names( TYPES_FILE, /^\texport const ([A-Za-z_][A-Za-z0-9_]*)\s*:/gm );
	let wrapper_exports = read_names( WRAPPER_FILE, /^export const ([A-Za-z_][A-Za-z0-9_]*)\s*=/gm );

	let findings = [];

	function report( Message, Names )
	{
		if ( Names.length === 0 ) { return; }
		findings.push( { Message: Message, Names: Names } );
	}

	// Level 1: the package.
	report( 'On the library but not declared in the JsonxCliLibrary interface', missing_from( library_members, declared_members ) );
	report( 'Declared in the JsonxCliLibrary interface but not on the library', missing_from( declared_members, library_members ) );
	report( 'On the library but not re-exported by src/jsonx-cli.mjs', missing_from( library_members, wrapper_exports ) );
	report( 'Re-exported by src/jsonx-cli.mjs but not on the library', missing_from( wrapper_exports, library_members ) );
	report( 'On the library but not declared as a named export in the .d.ts', missing_from( library_members, declared_exports ) );
	report( 'Declared as a named export in the .d.ts but not on the library', missing_from( declared_exports, library_members ) );

	// Level 2: the components.
	let declared = declared_components();
	let running = running_components( library.Library, declared );
	report( 'A component of Library not declared on LibraryComponents', missing_from( Object.keys( running ), Object.keys( declared ) ) );
	report( 'Declared on LibraryComponents but not a component of Library', missing_from( Object.keys( declared ), Object.keys( running ) ) );

	// Level 3: the members of each component.
	let component_names = Object.keys( running );
	let member_count = 0;
	for ( let index = 0; index < component_names.length; index++ )
	{
		let component = component_names[ index ];
		if ( !Object.prototype.hasOwnProperty.call( declared, component ) ) { continue; }

		let interface_name = declared[ component ];
		let members = interface_members( interface_name );
		if ( members === null )
		{
			report( 'LibraryComponents names an interface which is not declared', [ component + ': ' + interface_name ] );
			continue;
		}
		let exported = Object.keys( running[ component ] );
		member_count += exported.length;
		report( 'Exported by ' + component + ' but not declared on ' + interface_name, missing_from( exported, members ) );
		report( 'Declared on ' + interface_name + ' but not exported by ' + component, missing_from( members, exported ) );
	}

	return {
		LibraryMembers: library_members,
		DeclaredMembers: declared_members,
		DeclaredExports: declared_exports,
		WrapperExports: wrapper_exports,
		Components: component_names,
		ComponentMembers: member_count,
		Findings: findings,
	};
}


//---------------------------------------------------------------------
function main()
{
	let result = Check();

	console.log( '' );
	console.log( 'Types Check' );
	console.log( '' );
	console.log( `   library members               : ${result.LibraryMembers.length}` );
	console.log( `   declared on the interface     : ${result.DeclaredMembers.length}` );
	console.log( `   named exports in the .d.ts    : ${result.DeclaredExports.length}` );
	console.log( `   re-exported by jsonx-cli.mjs  : ${result.WrapperExports.length}` );
	console.log( `   components                    : ${result.Components.length}` );
	console.log( `   component members             : ${result.ComponentMembers}` );
	console.log( '' );

	if ( result.Findings.length === 0 )
	{
		console.log( '   The library, the declaration, and the ESM wrapper agree.' );
		console.log( '' );
		return;
	}

	for ( let index = 0; index < result.Findings.length; index++ )
	{
		let finding = result.Findings[ index ];
		console.log( `   ${finding.Message}:` );
		console.log( `      ${finding.Names.join( ', ' )}` );
	}
	console.log( '' );

	process.exitCode = 1;
}


//---------------------------------------------------------------------
module.exports = {
	Check: Check,
};

if ( require.main === module ) { main(); }
