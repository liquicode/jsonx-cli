'use strict';

/*
	jsonx explain <name>

	An entry of the file in English (plan F3.10): a data source, an object or a trigger. Reads the
	file and opens nothing. The result on standard output is `{ Name, Kind, Lines }`; the report on
	standard error is the lines themselves, for a person reading along.

	Exit codes: 0 explained; 2 no file can be chosen, or no entry carries the name; 1 the file cannot
	be read; 3 the file is not a jsonx file at all.
*/

const Explain = require( '../src/Explain/Explain.js' );
const Report = require( '../src/Report.js' );
const FileCommand = require( './file.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	let loaded = FileCommand.LoadFile( Parsed, Context );
	if ( typeof loaded.ExitCode === 'number' ) { return loaded.ExitCode; }

	let name = value( 'name' );
	let explained = Explain.ExplainEntry( loaded.Document, name );
	if ( explained === null )
	{
		io.Stderr( 'No entry is named [' + name + '] in ' + loaded.Path + '.\n' );
		return 2;
	}

	Report.WriteResult( io, value( 'output' ), explained );
	if ( !value( 'quiet' ) ) { io.Stderr( explained.Lines.join( '\n' ) + '\n' ); }
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'explain',
	Describe: 'Say in English what a data source, object or trigger of the file does.',
	Positionals: [
		{ Name: 'name', Type: 'string', Required: true, Complete: 'entries', Describe:'The data source, object or trigger to explain.' },
	],
	Handler: handler,
};
