'use strict';

/*
	Help text for any level of a command tree, rendered from the same tree the parser reads.

	***Help is never written by hand.*** A command, an argument or an option appears here because
	it is declared, so help cannot describe an option the parser refuses or miss one it accepts.
*/

const Parser = require( './Parser.js' );


const COLUMN = 30;


//---------------------------------------------------------------------
function row( Left, Right )
{
	if ( Left.length + 2 >= COLUMN ) { return '  ' + Left + '\n' + ' '.repeat( COLUMN ) + Right; }
	return '  ' + Left.padEnd( COLUMN - 2 ) + Right;
}


//---------------------------------------------------------------------
function describe_value( Declaration )
{
	let notes = [];
	if ( Array.isArray( Declaration.Choices ) ) { notes.push( Declaration.Choices.join( ' | ' ) ); }
	if ( typeof Declaration.Default !== 'undefined' && ( Declaration.Type || 'string' ) !== 'boolean' )
	{
		notes.push( 'default ' + JSON.stringify( Declaration.Default ) );
	}
	if ( Declaration.Repeat === true ) { notes.push( 'repeatable' ); }
	if ( Declaration.Required === true ) { notes.push( 'required' ); }
	if ( ( Declaration.Type || 'string' ) === 'json' ) { notes.push( 'JSON, @file, or - for stdin' ); }

	let text = Declaration.Describe || '';
	if ( notes.length > 0 ) { text += ( text ? ' ' : '' ) + '(' + notes.join( ', ' ) + ')'; }
	return text;
}


//---------------------------------------------------------------------
function option_rows( Options )
{
	let rows = [];
	let names = Object.keys( Options ).sort();
	for ( let index = 0; index < names.length; index++ )
	{
		let name = names[ index ];
		let declaration = Options[ name ];
		let type = declaration.Type || 'string';
		let spelling = ( declaration.Alias ? '-' + declaration.Alias + ', ' : '    ' ) + '--' + name;
		if ( type !== 'boolean' ) { spelling += ' <' + type + '>'; }
		rows.push( row( spelling, describe_value( declaration ) ) );
	}
	return rows;
}


//---------------------------------------------------------------------
function HelpText( Tree, Path )
{
	let path = Array.isArray( Path ) ? Path : [];
	let node = Parser.NodeAt( Tree, path );
	let program = Tree.Command || 'jsonx';
	let lines = [];

	// Usage.
	let usage = [ program ].concat( path );

	// ***A hidden command parses but is never offered***, such as the completion callback.
	let shown = Array.isArray( node.Commands )
		? node.Commands.filter( function ( Child ) { return Child.Hidden !== true; } )
		: [];
	let has_commands = shown.length > 0;
	if ( has_commands ) { usage.push( '<command>' ); }
	let positionals = Array.isArray( node.Positionals ) ? node.Positionals : [];
	for ( let index = 0; index < positionals.length; index++ )
	{
		let positional = positionals[ index ];
		let text = positional.Name + ( positional.Repeat === true ? '...' : '' );
		usage.push( positional.Required === true ? '<' + text + '>' : '[' + text + ']' );
	}
	usage.push( '[options]' );
	lines.push( 'Usage: ' + usage.join( ' ' ) );

	if ( node.Describe )
	{
		lines.push( '' );
		lines.push( node.Describe );
	}

	if ( has_commands )
	{
		lines.push( '' );
		lines.push( 'Commands:' );
		for ( let index = 0; index < shown.length; index++ )
		{
			let child = shown[ index ];
			let words = [ child.Command ].concat( Array.isArray( child.Aliases ) ? child.Aliases : [] );
			lines.push( row( words.join( ', ' ), child.Describe || '' ) );
		}
	}

	if ( positionals.length > 0 )
	{
		lines.push( '' );
		lines.push( 'Arguments:' );
		for ( let index = 0; index < positionals.length; index++ )
		{
			let positional = positionals[ index ];
			lines.push( row( '<' + positional.Name + '>', describe_value( positional ) ) );
		}
	}

	// ***The command's own options first, then the global ones***, so what is particular to the
	// command is not buried under what every command takes.
	let in_force = Parser.OptionsAt( Tree, path );
	let globals = ( Tree.GlobalOptions && typeof Tree.GlobalOptions === 'object' ) ? Tree.GlobalOptions : {};
	let own = {};
	let global = {};
	let names = Object.keys( in_force );
	for ( let index = 0; index < names.length; index++ )
	{
		let name = names[ index ];
		if ( globals[ name ] === in_force[ name ] ) { global[ name ] = in_force[ name ]; }
		else { own[ name ] = in_force[ name ]; }
	}

	if ( Object.keys( own ).length > 0 )
	{
		lines.push( '' );
		lines.push( 'Options:' );
		lines.push.apply( lines, option_rows( own ) );
	}
	if ( Object.keys( global ).length > 0 )
	{
		lines.push( '' );
		lines.push( 'Global options:' );
		lines.push.apply( lines, option_rows( global ) );
	}

	if ( has_commands )
	{
		lines.push( '' );
		lines.push( 'Run ' + [ program ].concat( path ).join( ' ' ) + ' <command> --help for more on a command.' );
	}

	lines.push( '' );
	return lines.join( '\n' );
}


//---------------------------------------------------------------------
module.exports = {
	HelpText: HelpText,
};
