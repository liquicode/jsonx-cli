'use strict';

/*
	The command line mode: arguments in, an exit code out.

	***Main takes its arguments and its streams as parameters*** and returns the exit code rather
	than exiting, so a test drives the whole mode in process and the bin is the only caller which
	touches `process`.

	The order is fixed: parse (a usage mistake is exit 2 and nothing else happens), answer
	`--help` for the level reached, answer `--version` at the root, then hand the parse to the
	node's handler. A group reached without a command prints its help to standard error with
	exit 2, because the caller asked for something that is not a command.
*/

const jsonx_cli = require( '../../src/jsonx-cli.js' );
const Parser = require( '../../src/CommandLine/Parser.js' );
const Help = require( '../../src/CommandLine/Help.js' );
const InputJson = require( '../../src/CommandLine/InputJson.js' );
const Commands = require( '../../commands/jsonx.js' );


//---------------------------------------------------------------------
// The exit codes every mode of the command line reports.

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_VALIDATION = 3;


//---------------------------------------------------------------------
// The streams of the running process, in the shape Main reads and writes.

function ProcessIo()
{
	let io = Parser.DefaultIo();
	io.Stdout = function ( Text ) { process.stdout.write( Text ); };
	io.Stderr = function ( Text ) { process.stderr.write( Text ); };
	io.Env = process.env;
	io.Cwd = process.cwd();
	// Standard input a line at a time, for a command which reads commands there (jsonx debug).
	io.Lines = function ()
	{
		return require( 'readline' ).createInterface( { input: process.stdin, crlfDelay: Infinity } );
	};
	return io;
}


//---------------------------------------------------------------------
async function Main( Argv, Io, Tree )
{
	let tree = Tree || Commands.TREE;
	let argv = Array.isArray( Argv ) ? Argv : [];
	let parsed = null;

	try
	{
		parsed = InputJson.ParseInvocation( tree, argv, Io );
	}
	catch ( error )
	{
		if ( !( error instanceof Parser.UsageError ) ) { throw error; }
		let command = [ tree.Command ].concat( error.Path ).join( ' ' );
		Io.Stderr( error.message + '\nRun ' + command + ' --help.\n' );
		return EXIT_USAGE;
	}

	if ( parsed.Help )
	{
		Io.Stdout( Help.HelpText( tree, parsed.Path ) );
		return EXIT_OK;
	}

	if ( parsed.Path.length === 0 && parsed.Options.version === true )
	{
		Io.Stdout( jsonx_cli.Version + '\n' );
		return EXIT_OK;
	}

	let node = Parser.NodeAt( tree, parsed.Path );

	if ( typeof node.Handler !== 'function' )
	{
		// The bare program with nothing asked of it is a request for help, not a mistake.
		if ( parsed.Path.length === 0 && argv.length === 0 )
		{
			Io.Stdout( Help.HelpText( tree, parsed.Path ) );
			return EXIT_OK;
		}
		Io.Stderr( Help.HelpText( tree, parsed.Path ) );
		return EXIT_USAGE;
	}

	let context = { Tree: tree, Io: Io, Parser: Parser };
	return await node.Handler( parsed, context );
}


//---------------------------------------------------------------------
module.exports = {
	EXIT_OK: EXIT_OK,
	EXIT_FAILED: EXIT_FAILED,
	EXIT_USAGE: EXIT_USAGE,
	EXIT_VALIDATION: EXIT_VALIDATION,
	ProcessIo: ProcessIo,
	Main: Main,
};
