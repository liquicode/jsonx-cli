'use strict';

/*
	The command line, parsed against a command tree declared as data.

	***The grammar is yargs' grammar, and the parser is our own.*** Commands and sub-commands,
	`--long` and `-s`, `--key=value` and `--key value`, `--no-flag`, typed values with defaults,
	repeatable options, positionals, and help at every level - shaped so that a later swap to
	yargs would be mechanical. Nothing in the family depends on a parser package.

	***An unknown option is an error rather than a value nobody reads***, and reading an option
	that was never declared throws. Both rules come from the facility's lib/args.js: an option
	which is silently ignored is a command which looks healthy and is aimed wrong.

	A node of the tree:

		{
			Command: 'info',                      // the word typed; the root's is the program name
			Describe: 'What a data source says about itself.',
			Commands: [ node, ... ],              // children, for a group
			Positionals: [ { Name, Type, Required, Repeat, Choices, Describe } ],
			Options: { 'rows': { Type, Alias, Default, Repeat, Required, Choices, Inherit, Describe } },
			GlobalOptions: { ... },               // the root only: accepted at every level
			Handler: async function ( Parsed, Context ) { ... },
		}

	Types are `string`, `number`, `integer`, `boolean` and `json`. A `json` value is inline JSON,
	`@path` to read a file, or `-` to read standard input. ***Reading goes through the Io handed
	in***, so a test parses a file reference without touching a disk.

	***An option declared on a node applies to that node and every node below it***, unless it
	carries `Inherit: false`. That is how `--version` belongs to the program and not to its
	commands.
*/

const LIB_FS = require( 'fs' );


const TYPES = [ 'string', 'number', 'integer', 'boolean', 'json' ];


//---------------------------------------------------------------------
// A mistake in how the command line was typed. Exit code 2.

class UsageError extends Error
{
	constructor( Message, Path )
	{
		super( Message );
		this.name = 'UsageError';
		this.Path = Array.isArray( Path ) ? Path : [];
	}
}


//---------------------------------------------------------------------
// The streams a parse may read from.

function DefaultIo()
{
	return {
		ReadFile: function ( Path ) { return LIB_FS.readFileSync( Path, 'utf8' ); },
		ReadStdin: function () { return LIB_FS.readFileSync( 0, 'utf8' ); },
	};
}


//---------------------------------------------------------------------
function child_named( Node, Word )
{
	if ( !Array.isArray( Node.Commands ) ) { return null; }
	for ( let index = 0; index < Node.Commands.length; index++ )
	{
		if ( Node.Commands[ index ].Command === Word ) { return Node.Commands[ index ]; }
	}
	return null;
}


//---------------------------------------------------------------------
// The options in force at a node: the root's global options, then each node's own options from
// the root down, where an option marked Inherit: false counts only on its own node.

function OptionsAt( Tree, Path )
{
	let options = {};

	function take( Table, Own )
	{
		if ( Table === null || typeof Table !== 'object' ) { return; }
		let names = Object.keys( Table );
		for ( let index = 0; index < names.length; index++ )
		{
			let option = Table[ names[ index ] ];
			if ( option.Inherit === false && Own === false ) { continue; }
			options[ names[ index ] ] = option;
		}
	}

	take( Tree.GlobalOptions, true );

	let nodes = NodesOnPath( Tree, Path );
	for ( let index = 0; index < nodes.length; index++ )
	{
		take( nodes[ index ].Options, ( index === nodes.length - 1 ) );
	}
	return options;
}


//---------------------------------------------------------------------
// The nodes from the root to the end of a path, root first.

function NodesOnPath( Tree, Path )
{
	let nodes = [ Tree ];
	let node = Tree;
	for ( let index = 0; index < Path.length; index++ )
	{
		node = child_named( node, Path[ index ] );
		if ( node === null ) { throw new UsageError( 'Unknown command [' + Path.slice( 0, index + 1 ).join( ' ' ) + '].', Path.slice( 0, index ) ); }
		nodes.push( node );
	}
	return nodes;
}


//---------------------------------------------------------------------
// The option a spelling names at a node - a long name, or a one letter alias - or null.

function find_option( Options, Spelling, IsAlias )
{
	let names = Object.keys( Options );
	for ( let index = 0; index < names.length; index++ )
	{
		let name = names[ index ];
		if ( IsAlias )
		{
			if ( Options[ name ].Alias === Spelling ) { return name; }
		}
		else if ( name === Spelling )
		{
			return name;
		}
	}
	return null;
}


//---------------------------------------------------------------------
// Whether an option by this spelling is declared anywhere below a node, for the message which
// tells somebody an option came before its command.

function declared_below( Node, Spelling )
{
	if ( !Array.isArray( Node.Commands ) ) { return null; }
	for ( let index = 0; index < Node.Commands.length; index++ )
	{
		let child = Node.Commands[ index ];
		if ( child.Options && typeof child.Options[ Spelling ] !== 'undefined' ) { return child.Command; }
		let deeper = declared_below( child, Spelling );
		if ( deeper !== null ) { return child.Command + ' ' + deeper; }
	}
	return null;
}


//---------------------------------------------------------------------
// A typed value from the text typed for it.
//
// ***One read of standard input per parse***: a second `-` has nothing left to read, and would
// silently receive an empty document.

function coerce( Declaration, Label, Text, Io, State, Path )
{
	let type = Declaration.Type || 'string';
	if ( !TYPES.includes( type ) ) { throw new Error( Label + ' declares an unknown type [' + type + '].' ); }

	let value = Text;

	if ( type === 'number' || type === 'integer' )
	{
		value = Number( Text );
		if ( Text.trim() === '' || !Number.isFinite( value ) ) { throw new UsageError( Label + ' takes a number, not [' + Text + '].', Path ); }
		if ( type === 'integer' && !Number.isInteger( value ) ) { throw new UsageError( Label + ' takes a whole number, not [' + Text + '].', Path ); }
	}
	else if ( type === 'boolean' )
	{
		if ( Text === 'true' ) { value = true; }
		else if ( Text === 'false' ) { value = false; }
		else { throw new UsageError( Label + ' takes true or false, not [' + Text + '].', Path ); }
	}
	else if ( type === 'json' )
	{
		let source = Text;
		let where = 'inline';
		if ( Text === '-' )
		{
			if ( State.StdinRead ) { throw new UsageError( 'Standard input can be read by only one value; ' + Label + ' asks for it again.', Path ); }
			State.StdinRead = true;
			source = Io.ReadStdin();
			where = 'standard input';
		}
		else if ( Text.startsWith( '@' ) )
		{
			let file_path = Text.slice( 1 );
			try { source = Io.ReadFile( file_path ); }
			catch ( error ) { throw new UsageError( Label + ' could not read [' + file_path + ']: ' + error.message, Path ); }
			where = file_path;
		}
		if ( source.charCodeAt( 0 ) === 0xFEFF ) { source = source.slice( 1 ); }
		try { value = JSON.parse( source ); }
		catch ( error ) { throw new UsageError( Label + ' is not valid JSON (' + where + '): ' + error.message, Path ); }
	}

	check_choices( Declaration, Label, value, Path );
	return value;
}


//---------------------------------------------------------------------
function check_choices( Declaration, Label, Value, Path )
{
	if ( !Array.isArray( Declaration.Choices ) ) { return; }
	if ( Declaration.Choices.includes( Value ) ) { return; }
	throw new UsageError( Label + ' must be one of ' + Declaration.Choices.join( ', ' ) + ', not [' + Value + '].', Path );
}


//---------------------------------------------------------------------
// Whether a token can be the value of the option before it.
//
// A token beginning with a dash is another option, except `-` itself (standard input) and a
// negative number handed to a numeric option.

function can_be_value( Token, Declaration )
{
	if ( typeof Token === 'undefined' ) { return false; }
	if ( Token === '-' ) { return true; }
	if ( !Token.startsWith( '-' ) ) { return true; }
	let type = Declaration.Type || 'string';
	if ( ( type === 'number' || type === 'integer' ) && /^-\d/.test( Token ) ) { return true; }
	return false;
}


//---------------------------------------------------------------------
function store_option( Parsed, Name, Declaration, Value, Path )
{
	if ( Declaration.Repeat === true )
	{
		if ( !Array.isArray( Parsed.Options[ Name ] ) ) { Parsed.Options[ Name ] = []; }
		Parsed.Options[ Name ].push( Value );
		return;
	}
	if ( Object.prototype.hasOwnProperty.call( Parsed.Given, Name ) )
	{
		throw new UsageError( 'Option [--' + Name + '] was given more than once.', Path );
	}
	Parsed.Options[ Name ] = Value;
	return;
}


//---------------------------------------------------------------------
// Parses an argument list against a tree.
//
// Returns { Path, Positionals, Options, Given, Help }. ***Nothing is run***: the caller looks up
// the node at Path and decides what to do with it.

function ParseArgs( Tree, Argv, Io )
{
	let io = Io || DefaultIo();
	let argv = Array.isArray( Argv ) ? Argv : [];
	let state = { StdinRead: false };

	let parsed = {
		Path: [],
		Positionals: {},
		Options: {},
		Given: {},
		Help: false,
	};

	let node = Tree;
	let loose = [];
	let options_ended = false;

	for ( let index = 0; index < argv.length; index++ )
	{
		let token = argv[ index ];
		let options = OptionsAt( Tree, parsed.Path );

		// Everything after `--` is a positional.
		if ( options_ended || token === '-' || !token.startsWith( '-' ) )
		{
			// ***A command word descends only while nothing positional has been seen***, so a
			// positional which happens to spell a command name stays a positional.
			if ( !options_ended && loose.length === 0 )
			{
				let child = child_named( node, token );
				if ( child !== null )
				{
					node = child;
					parsed.Path.push( token );
					continue;
				}
				if ( !Array.isArray( node.Positionals ) )
				{
					throw new UsageError( 'Unknown command [' + parsed.Path.concat( [ token ] ).join( ' ' ) + '].', parsed.Path );
				}
			}
			loose.push( token );
			continue;
		}

		if ( token === '--' )
		{
			options_ended = true;
			continue;
		}

		// The spelling, whether it is a one letter alias, and any value after `=`.
		let is_alias = !token.startsWith( '--' );
		let body = is_alias ? token.slice( 1 ) : token.slice( 2 );
		let inline_value = null;
		let equals_at = body.indexOf( '=' );
		if ( equals_at >= 0 )
		{
			inline_value = body.slice( equals_at + 1 );
			body = body.slice( 0, equals_at );
		}

		if ( is_alias && body.length !== 1 )
		{
			throw new UsageError( 'Unknown option [' + token + ']. A short option is one letter; write each one separately.', parsed.Path );
		}

		let name = find_option( options, body, is_alias );
		let negated = false;

		// ***`--no-x` negates x only when x is a declared boolean.*** Stripping `no-` from any
		// name is how a negation becomes a key nobody reads.
		if ( name === null && !is_alias && body.startsWith( 'no-' ) )
		{
			let positive = find_option( options, body.slice( 3 ), false );
			if ( positive !== null && ( options[ positive ].Type || 'string' ) === 'boolean' )
			{
				if ( inline_value !== null ) { throw new UsageError( 'Option [' + token + '] takes no value.', parsed.Path ); }
				name = positive;
				negated = true;
			}
		}

		if ( name === null )
		{
			let below = is_alias ? null : declared_below( node, body );
			if ( below !== null )
			{
				throw new UsageError( 'Option [--' + body + '] belongs to [' + parsed.Path.concat( [ below ] ).join( ' ' ) + '] and must come after that command.', parsed.Path );
			}
			throw new UsageError( 'Unknown option [' + token + ']. Run with --help for the option list.', parsed.Path );
		}

		let declaration = options[ name ];
		let label = 'Option [--' + name + ']';
		let type = declaration.Type || 'string';

		if ( type === 'boolean' )
		{
			let flag = !negated;
			if ( inline_value !== null ) { flag = coerce( declaration, label, inline_value, io, state, parsed.Path ); }
			if ( name === 'help' ) { parsed.Help = flag; }
			store_option( parsed, name, declaration, flag, parsed.Path );
			parsed.Given[ name ] = true;
			continue;
		}

		let text = inline_value;
		if ( text === null )
		{
			if ( !can_be_value( argv[ index + 1 ], declaration ) )
			{
				throw new UsageError( label + ' requires a value.', parsed.Path );
			}
			text = argv[ index + 1 ];
			index++;
		}

		store_option( parsed, name, declaration, coerce( declaration, label, text, io, state, parsed.Path ), parsed.Path );
		parsed.Given[ name ] = true;
	}

	// ***Help is answered before anything is required***, so `--help` on a command missing its
	// arguments shows how to supply them instead of complaining that they are missing.
	if ( parsed.Help ) { return parsed; }

	assign_positionals( parsed, node, loose, io, state );
	apply_defaults( parsed, Tree );

	return parsed;
}


//---------------------------------------------------------------------
function assign_positionals( Parsed, Node, Loose, Io, State )
{
	let declared = Array.isArray( Node.Positionals ) ? Node.Positionals : [];
	let position = 0;

	for ( let index = 0; index < declared.length; index++ )
	{
		let declaration = declared[ index ];
		let label = 'Argument <' + declaration.Name + '>';

		if ( declaration.Repeat === true )
		{
			let values = [];
			while ( position < Loose.length )
			{
				values.push( coerce( declaration, label, Loose[ position ], Io, State, Parsed.Path ) );
				position++;
			}
			if ( values.length === 0 && declaration.Required === true )
			{
				throw new UsageError( label + ' is required.', Parsed.Path );
			}
			Parsed.Positionals[ declaration.Name ] = values;
			continue;
		}

		if ( position >= Loose.length )
		{
			if ( declaration.Required === true ) { throw new UsageError( label + ' is required.', Parsed.Path ); }
			continue;
		}

		Parsed.Positionals[ declaration.Name ] = coerce( declaration, label, Loose[ position ], Io, State, Parsed.Path );
		position++;
	}

	if ( position < Loose.length )
	{
		let command = Parsed.Path.length === 0 ? 'jsonx' : Parsed.Path.join( ' ' );
		throw new UsageError( 'Unexpected argument [' + Loose[ position ] + '] for [' + command + '].', Parsed.Path );
	}
	return;
}


//---------------------------------------------------------------------
function apply_defaults( Parsed, Tree )
{
	let options = OptionsAt( Tree, Parsed.Path );
	let names = Object.keys( options );

	for ( let index = 0; index < names.length; index++ )
	{
		let name = names[ index ];
		let declaration = options[ name ];
		if ( Object.prototype.hasOwnProperty.call( Parsed.Options, name ) ) { continue; }

		if ( declaration.Required === true )
		{
			throw new UsageError( 'Option [--' + name + '] is required.', Parsed.Path );
		}
		if ( typeof declaration.Default !== 'undefined' )
		{
			Parsed.Options[ name ] = declaration.Default;
			continue;
		}
		if ( declaration.Repeat === true ) { Parsed.Options[ name ] = []; continue; }
		if ( ( declaration.Type || 'string' ) === 'boolean' ) { Parsed.Options[ name ] = false; }
	}
	return;
}


//---------------------------------------------------------------------
// The node a parse ended on.

function NodeAt( Tree, Path )
{
	let nodes = NodesOnPath( Tree, Path );
	return nodes[ nodes.length - 1 ];
}


//---------------------------------------------------------------------
// Reads one argument from a parse, by the name it was declared under.
//
// ***Asking for a name nothing declared throws.*** That is the guard which makes a misread key
// impossible rather than merely unlikely. An option declared but not given reads as undefined.

function Value( Tree, Parsed, Name )
{
	let node = NodeAt( Tree, Parsed.Path );
	let positionals = Array.isArray( node.Positionals ) ? node.Positionals : [];
	for ( let index = 0; index < positionals.length; index++ )
	{
		if ( positionals[ index ].Name === Name ) { return Parsed.Positionals[ Name ]; }
	}

	let options = OptionsAt( Tree, Parsed.Path );
	if ( typeof options[ Name ] !== 'undefined' ) { return Parsed.Options[ Name ]; }

	throw new Error( '[' + Name + '] is not declared for [' + ( Parsed.Path.join( ' ' ) || 'the program' ) + '].' );
}


//---------------------------------------------------------------------
module.exports = {
	TYPES: TYPES,
	UsageError: UsageError,
	DefaultIo: DefaultIo,
	OptionsAt: OptionsAt,
	NodesOnPath: NodesOnPath,
	NodeAt: NodeAt,
	ParseArgs: ParseArgs,
	Value: Value,
	coerce: coerce,
};
