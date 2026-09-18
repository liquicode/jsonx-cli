'use strict';

/*
	jsonx explain <name> | --json <object>

	An entry of the file in English (plan F3.10): a data source, an object or a trigger, by name, or a
	draft given as JSON and explained as if it were in the file (src/File/Draft.js). Reads the
	file and opens nothing. The result on standard output is `{ Name, Kind, Lines }`; the report on
	standard error is the lines themselves, for a person reading along.

	Exit codes: 0 explained; 2 no file can be chosen, or no entry carries the name; 1 the file cannot
	be read; 3 the file is not a jsonx file at all.
*/

const Explain = require( '../src/Explain/Explain.js' );
const Draft = require( '../src/File/Draft.js' );
const FileCommand = require( './file.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	let loaded = FileCommand.LoadFile( Parsed, Context );
	if ( typeof loaded.ExitCode === 'number' ) { return loaded.ExitCode; }

	let name = value( 'name' );
	let draft = value( 'json' );
	if ( typeof name === 'string' && typeof draft !== 'undefined' )
	{
		out.Log( '--json is the entry; do not name one as well.\n' );
		return 2;
	}
	if ( typeof name !== 'string' && typeof draft === 'undefined' )
	{
		out.Log( 'Name one entry, or pass --json.\n' );
		return 2;
	}

	// A draft is explained in a copy of the file, where it is found by name (src/File/Draft.js).
	let document = loaded.Document;
	if ( typeof draft !== 'undefined' )
	{
		let placed = Draft.Place( loaded.Document, draft );
		document = placed.Copy;
		name = placed.Name;
	}

	let explained = Explain.ExplainEntry( document, name );
	if ( explained === null )
	{
		out.Log( 'No entry is named [' + name + '] in ' + loaded.Path + '.\n' );
		return 2;
	}

	out.Result( explained );
	if ( !value( 'quiet' ) ) { out.Log( explained.Lines.join( '\n' ) + '\n' ); }
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'explain',
	Describe: 'Say in English what a data source, object or trigger of the file does.',
	Concurrent: true,
	Positionals: [
		{ Name: 'name', Type: 'string', Complete: 'entries', Describe:'The data source, object or trigger to explain; or pass --json.' },
	],
	Options: {
		'json': { Type: 'json', JsonType: 'object', Describe: 'A draft entry as JSON, explained as if it were in the file.' },
	},
	Handler: handler,
};
