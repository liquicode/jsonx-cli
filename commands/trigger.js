'use strict';

/*
	jsonx trigger <command>

	Cut 1 step 5 holds `run`: a trigger run by hand, which runs its Process over its data source
	(spec 13.3). The manage verbs join in step 6.
*/

const SessionCommand = require( './session.js' );
const Session = require( '../src/Session/Session.js' );


//---------------------------------------------------------------------
async function run_handler( Parsed, Context )
{
	let opened = await SessionCommand.OpenSession( Parsed, Context );
	if ( typeof opened.ExitCode === 'number' ) { return opened.ExitCode; }

	let name = Context.Parser.Value( Context.Tree, Parsed, 'name' );

	let report = null;
	try
	{
		report = await opened.Session.RunTrigger( name );
	}
	catch ( error )
	{
		await opened.Session.Release();
		if ( !( error instanceof Session.SessionError ) ) { throw error; }
		Context.Io.Stderr( error.message + '\n' );
		return 2;
	}
	return await SessionCommand.FinishRun( report, opened.Session, Parsed, Context );
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'trigger',
	Describe: 'Work with the file\'s triggers.',
	Commands: [
		{
			Command: 'run',
			Describe: 'Run a trigger by hand: its Process over its data source.',
			Positionals: [
				{ Name: 'name', Type: 'string', Required: true, Describe: 'The trigger to run.' },
			],
			Options: Object.assign( {}, SessionCommand.SESSION_OPTIONS ),
			Handler: run_handler,
		},
	],
};
