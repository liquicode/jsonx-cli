'use strict';

/*
	jsonx trigger run <name>

	A trigger run by hand, which runs its Process over its data source (spec 13.3). The trigger
	group itself - with the manage verbs beside this command - is built in manage.js.
*/

const SessionCommand = require( './session.js' );
const Session = require( '../src/Session/Session.js' );


//---------------------------------------------------------------------
async function run_handler( Parsed, Context )
{
	let opened = await SessionCommand.OpenSession( Parsed, Context, { Statistics: Context.Parser.Value( Context.Tree, Parsed, 'verbose' ) } );
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
	RunCommand: {
		Command: 'run',
		Describe: 'Run a trigger by hand: its Process over its data source.',
		Positionals: [
			{ Name: 'name', Type: 'string', Required: true, Describe: 'The trigger to run.' },
		],
		Options: Object.assign( {}, SessionCommand.RUN_OPTIONS ),
		Handler: run_handler,
	},
};
