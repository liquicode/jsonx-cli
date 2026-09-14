'use strict';

/*
	A command line typed into a front end's Input (plan F5.2), read with no screen and no socket: what
	sending it would do. Nothing is sent here; the front end sends the Document it is answered.

	Moved from the TUI model's send_command (cut 5, step 1), so the TUI and the Web UI, whose line the
	process reads (cut 5, decision 1), decide alike.

	***A served line never reads a file or standard input.*** The parser reads `@path` and `-` through
	the Io it is handed, and a line sent to the process by anyone who can call would otherwise read the
	server's files. ServedIo refuses both, and lists no directory.
*/

const Parser = require( '../CommandLine/Parser.js' );
const InputJson = require( '../CommandLine/InputJson.js' );
const Words = require( '../CommandLine/Words.js' );
const Help = require( '../CommandLine/Help.js' );
const Verbs = require( '../Storage/Verbs.js' );
const Inventory = require( './Inventory.js' );


const SERVED_REFUSAL = 'a line sent to a jsonx process takes JSON inline; @file and - would read the server\'s files.';


//---------------------------------------------------------------------
// The Io a line read for a process uses: nothing on its disk and nothing on its standard input.

function ServedIo()
{
	return {
		ReadFile: function () { throw new Error( SERVED_REFUSAL ); },
		ReadStdin: function () { throw new Parser.UsageError( 'Standard input cannot be read here: ' + SERVED_REFUSAL ); },
		ListDirectory: function () { return []; },
		Env: {},
		Cwd: '',
	};
}


//---------------------------------------------------------------------
function usage( Message )
{
	return { Outcome: 'usage', Findings: [ { Severity: 'error', Path: '', Message: Message } ] };
}


//---------------------------------------------------------------------
// What sending a typed line would do. Answers one of:
//
//		{ Outcome: 'usage', Findings }              an unclosed quote or bracket, or the parser's refusal
//		{ Outcome: 'help', Text }                   help, or a group reached without a command
//		{ Outcome: 'refused', Findings }            a command no front end sends
//		{ Outcome: 'debug', Document, Label }       jsonx debug, to be opened as a conversation
//		{ Outcome: 'confirm', Message, Document, Label }   the --yes rule would refuse it (F6.3): ask, and
//		                                            on yes send Document with `yes: true`
//		{ Outcome: 'invoke', Document, Label }      send Document
//
// Label is the line as its words, for a log. Io defaults to the parser's own (the local machine).
// Options.Front names the front end in a refusal ("the TUI"); absent, "a front end".

function ReadLine( Tree, Text, Io, Options )
{
	let io = Io || Parser.DefaultIo();
	let front = ( Options && typeof Options.Front === 'string' ) ? Options.Front : 'a front end';
	let split = Words.SplitWords( String( ( typeof Text === 'undefined' || Text === null ) ? '' : Text ) );
	if ( split.Open !== null )
	{
		return usage( ( split.Open === '{' || split.Open === '[' ) ? 'The JSON beginning ' + split.Open + ' is not closed.' : 'A ' + split.Open + ' quote is not closed.' );
	}
	let words = split.Words.slice();
	if ( words[ 0 ] === 'jsonx' ) { words.shift(); }

	let parsed = null;
	try
	{
		parsed = InputJson.ParseInvocation( Tree, words, io );
	}
	catch ( error )
	{
		if ( !( error instanceof Parser.UsageError ) ) { throw error; }
		return usage( error.message );
	}

	if ( parsed.Help ) { return { Outcome: 'help', Text: Help.HelpText( Tree, parsed.Path ) }; }

	let node = Parser.NodeAt( Tree, parsed.Path );
	if ( typeof node.Handler !== 'function' ) { return { Outcome: 'help', Text: Help.HelpText( Tree, parsed.Path ) }; }
	if ( Inventory.NOT_SENT.includes( parsed.Path[ 0 ] ) )
	{
		return { Outcome: 'refused', Findings: [ { Severity: 'error', Path: '', Message: '[' + parsed.Path.join( ' ' ) + '] is not run from ' + front + '.' } ] };
	}

	let document = InputJson.ToDocument( parsed );
	let label = words.join( ' ' );
	if ( parsed.Path[ 0 ] === 'debug' ) { return { Outcome: 'debug', Document: document, Label: label }; }

	// ***The --yes rule (F6.3) asks the person***, rather than refusing.
	let verb = parsed.Path[ 1 ];
	if ( parsed.Path[ 0 ] === 'datasource' && Verbs.VERBS[ verb ] && Verbs.VERBS[ verb ].Guard !== null && typeof parsed.Options.save !== 'string' )
	{
		let refusal = Verbs.Guard( verb, parsed.Options );
		if ( refusal !== null )
		{
			return { Outcome: 'confirm', Message: refusal.replace( /^Refused: /, '' ).replace( /\s*Confirm with[\s\S]*$/, '' ), Document: document, Label: label };
		}
	}

	return { Outcome: 'invoke', Document: document, Label: label };
}


//---------------------------------------------------------------------
module.exports = {
	SERVED_REFUSAL: SERVED_REFUSAL,
	ServedIo: ServedIo,
	ReadLine: ReadLine,
};
