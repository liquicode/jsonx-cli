'use strict';

/*
	`--input-json`: a whole invocation as one JSON document.

	***A model emits an object more reliably than a quoted shell line***, and a program building a
	call should not have to quote at all. So an invocation can arrive as

		{ "Command": "datasource describe", "name": "Bookings", "rows": 5, "file": "observatory.jsonx" }

	where `Command` is the command path, as a string of words or an array of them, and every other
	key is named exactly as the argument or option is declared. The result is the same shape
	ParseArgs returns, so a handler cannot tell the two apart.

	***`--input-json` is the whole command line when it is used.*** Mixing it with typed arguments
	would need a rule for which one wins, and a caller who wanted both can put everything in the
	document.

	***Values arrive already typed***, so they are checked rather than coerced: `rows` must be a
	number in the document, and a `json` option takes the JSON value itself, with no `@file` or
	`-` reading. The document's own `--input-json <file | ->` is the one place a file or standard
	input is read.
*/

const Parser = require( './Parser.js' );


const OPTION_NAME = 'input-json';


//---------------------------------------------------------------------
// Whether an argument list asks for --input-json, and the value it gave.

function find_input_json( Argv )
{
	for ( let index = 0; index < Argv.length; index++ )
	{
		let token = Argv[ index ];
		if ( token === '--' ) { return null; }
		if ( token === '--' + OPTION_NAME ) { return { Index: index, Value: Argv[ index + 1 ], Tokens: 2 }; }
		if ( token.startsWith( '--' + OPTION_NAME + '=' ) ) { return { Index: index, Value: token.slice( OPTION_NAME.length + 3 ), Tokens: 1 }; }
	}
	return null;
}


//---------------------------------------------------------------------
function check_type( Declaration, Label, Value, Path )
{
	let type = Declaration.Type || 'string';
	let ok = true;
	if ( type === 'string' ) { ok = ( typeof Value === 'string' ); }
	if ( type === 'number' ) { ok = ( typeof Value === 'number' && Number.isFinite( Value ) ); }
	if ( type === 'integer' ) { ok = ( typeof Value === 'number' && Number.isInteger( Value ) ); }
	if ( type === 'boolean' ) { ok = ( typeof Value === 'boolean' ); }
	if ( !ok ) { throw new Parser.UsageError( Label + ' must be a ' + type + ' in the input document.', Path ); }

	if ( Array.isArray( Declaration.Choices ) && !Declaration.Choices.includes( Value ) )
	{
		throw new Parser.UsageError( Label + ' must be one of ' + Declaration.Choices.join( ', ' ) + ', not [' + Value + '].', Path );
	}
	return;
}


//---------------------------------------------------------------------
// A parse from an input document.

function ParseDocument( Tree, Document )
{
	if ( Document === null || typeof Document !== 'object' || Array.isArray( Document ) )
	{
		throw new Parser.UsageError( 'The input document must be a JSON object.' );
	}

	let path = [];
	if ( typeof Document.Command === 'string' )
	{
		path = Document.Command.split( /\s+/ ).filter( function ( Word ) { return Word !== ''; } );
	}
	else if ( Array.isArray( Document.Command ) )
	{
		path = Document.Command.slice();
	}
	else if ( typeof Document.Command !== 'undefined' )
	{
		throw new Parser.UsageError( 'The input document\'s Command must be a string or an array of words.' );
	}

	let node = Parser.NodeAt( Tree, path );
	let options = Parser.OptionsAt( Tree, path );
	let positionals = Array.isArray( node.Positionals ) ? node.Positionals : [];

	let parsed = { Path: path, Positionals: {}, Options: {}, Given: {}, Help: false };

	let keys = Object.keys( Document );
	for ( let index = 0; index < keys.length; index++ )
	{
		let key = keys[ index ];
		if ( key === 'Command' ) { continue; }
		if ( key === OPTION_NAME ) { throw new Parser.UsageError( 'An input document cannot name another input document.', path ); }
		let value = Document[ key ];

		let positional = null;
		for ( let position = 0; position < positionals.length; position++ )
		{
			if ( positionals[ position ].Name === key ) { positional = positionals[ position ]; }
		}

		let declaration = positional || options[ key ];
		if ( !declaration )
		{
			throw new Parser.UsageError( 'Unknown key [' + key + '] in the input document for [' + ( path.join( ' ' ) || 'jsonx' ) + '].', path );
		}
		let label = positional ? 'Argument <' + key + '>' : 'Option [--' + key + ']';

		if ( ( declaration.Type || 'string' ) !== 'json' )
		{
			if ( declaration.Repeat === true )
			{
				if ( !Array.isArray( value ) ) { throw new Parser.UsageError( label + ' is repeatable and must be an array in the input document.', path ); }
				for ( let item = 0; item < value.length; item++ ) { check_type( declaration, label, value[ item ], path ); }
			}
			else
			{
				check_type( declaration, label, value, path );
			}
		}

		if ( positional ) { parsed.Positionals[ key ] = value; }
		else
		{
			parsed.Options[ key ] = value;
			parsed.Given[ key ] = true;
			if ( key === 'help' ) { parsed.Help = ( value === true ); }
		}
	}

	if ( parsed.Help ) { return parsed; }

	// The same completion ParseArgs makes: required arguments, required options, defaults.
	for ( let index = 0; index < positionals.length; index++ )
	{
		let positional = positionals[ index ];
		if ( positional.Required === true && typeof parsed.Positionals[ positional.Name ] === 'undefined' )
		{
			throw new Parser.UsageError( 'Argument <' + positional.Name + '> is required.', path );
		}
	}

	let names = Object.keys( options );
	for ( let index = 0; index < names.length; index++ )
	{
		let name = names[ index ];
		let declaration = options[ name ];
		if ( Object.prototype.hasOwnProperty.call( parsed.Options, name ) ) { continue; }
		if ( declaration.Required === true ) { throw new Parser.UsageError( 'Option [--' + name + '] is required.', path ); }
		if ( typeof declaration.Default !== 'undefined' ) { parsed.Options[ name ] = declaration.Default; continue; }
		if ( declaration.Repeat === true ) { parsed.Options[ name ] = []; continue; }
		if ( ( declaration.Type || 'string' ) === 'boolean' ) { parsed.Options[ name ] = false; }
	}

	return parsed;
}


//---------------------------------------------------------------------
// Parses a command line, through the input document when it names one.

function ParseInvocation( Tree, Argv, Io )
{
	let io = Io || Parser.DefaultIo();
	let argv = Array.isArray( Argv ) ? Argv : [];

	let found = find_input_json( argv );
	if ( found === null ) { return Parser.ParseArgs( Tree, argv, io ); }

	if ( typeof found.Value === 'undefined' || found.Value === '' )
	{
		throw new Parser.UsageError( 'Option [--' + OPTION_NAME + '] requires a file path, or - for standard input.' );
	}
	if ( argv.length !== found.Tokens )
	{
		throw new Parser.UsageError( 'Option [--' + OPTION_NAME + '] must be the only argument; put everything else in the document.' );
	}

	let text = null;
	try { text = ( found.Value === '-' ) ? io.ReadStdin() : io.ReadFile( found.Value ); }
	catch ( error ) { throw new Parser.UsageError( 'Option [--' + OPTION_NAME + '] could not read [' + found.Value + ']: ' + error.message ); }
	if ( text.charCodeAt( 0 ) === 0xFEFF ) { text = text.slice( 1 ); }

	let document = null;
	try { document = JSON.parse( text ); }
	catch ( error ) { throw new Parser.UsageError( 'Option [--' + OPTION_NAME + '] did not read valid JSON: ' + error.message ); }

	return ParseDocument( Tree, document );
}


//---------------------------------------------------------------------
module.exports = {
	OPTION_NAME: OPTION_NAME,
	ParseDocument: ParseDocument,
	ParseInvocation: ParseInvocation,
};
