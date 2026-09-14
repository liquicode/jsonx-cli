'use strict';

/*
	jsonx completion <shell>        jsonx __complete -- <words> :<current word>

	`completion` writes the script for a shell (src/CommandLine/CompletionScripts.js). `__complete`
	is the hidden callback those scripts make: one candidate per line on standard output, from the
	command tree and the file (src/CommandLine/Complete.js).

	***Both write text, not JSON***, since a shell reads them; --output does not apply to either and
	is exit 2. `__complete` answers nothing rather than failing, because a shell shows its errors in
	the middle of the line being typed.
*/

const Complete = require( '../src/CommandLine/Complete.js' );
const CompletionScripts = require( '../src/CommandLine/CompletionScripts.js' );
const FileCommand = require( './file.js' );


//---------------------------------------------------------------------
function refuse_output( Parsed, Context, What )
{
	// A completion command reads no jsonx file of its own: `__complete` finds the file from the
	// words it is handed, not from its own --file.
	let refused = FileCommand.RefuseFile( Parsed, Context, What );
	if ( refused !== null ) { return refused; }
	if ( Parsed.Given.output !== true ) { return null; }
	Context.Io.Stderr( 'Option [--output] does not apply to ' + What + ', which writes text for a shell.\n' );
	return 2;
}


//---------------------------------------------------------------------
async function script_handler( Parsed, Context )
{
	let refused = refuse_output( Parsed, Context, 'jsonx completion' );
	if ( refused !== null ) { return refused; }
	Context.Io.Stdout( CompletionScripts.Script( Context.Parser.Value( Context.Tree, Parsed, 'shell' ), Context.Tree.Command ) );
	return 0;
}


//---------------------------------------------------------------------
async function complete_handler( Parsed, Context )
{
	let refused = refuse_output( Parsed, Context, 'jsonx __complete' );
	if ( refused !== null ) { return refused; }

	let words = Context.Parser.Value( Context.Tree, Parsed, 'words' ) || [];
	if ( words.length > 0 && words[ words.length - 1 ].startsWith( Complete.CURRENT_MARK ) )
	{
		words[ words.length - 1 ] = words[ words.length - 1 ].slice( Complete.CURRENT_MARK.length );
	}
	else
	{
		words.push( '' );
	}

	let candidates = [];
	try { candidates = Complete.Candidates( Context.Tree, words, Context.Io ); }
	catch ( error ) { candidates = []; }

	if ( candidates.length > 0 ) { Context.Io.Stdout( candidates.join( '\n' ) + '\n' ); }
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Commands: [
		{
			Command: 'completion',
			Describe: 'Write the shell completion script for bash, zsh or powershell.',
			Positionals: [
				{ Name: 'shell', Type: 'string', Required: true, Choices: CompletionScripts.SHELLS, Describe: 'The shell.' },
			],
			Handler: script_handler,
		},
		{
			Command: '__complete',
			Hidden: true,
			Describe: 'The completion scripts\' callback: the candidates for the words typed, one per line.',
			Positionals: [
				{ Name: 'words', Type: 'string', Repeat: true, Describe: 'The words typed, the last marked with a leading colon.' },
			],
			Handler: complete_handler,
		},
	],
};
