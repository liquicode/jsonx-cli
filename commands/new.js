'use strict';

/*
	jsonx new <kind> [--name <name>]

	A skeleton to start from (plan F3.4): a whole file, or one entry of the file - data source, query,
	insert, update, delete, process or trigger. Written to standard output; reads no jsonx file.

		jsonx new file --name Inventory > inventory.jsonx
		jsonx new query --name "Recent rows" | jsonx query add --json -

	Exit codes: 0 written; 2 a usage mistake, including --file.
*/

const Skeletons = require( '../src/File/Skeletons.js' );
const Report = require( '../src/Report.js' );
const FileCommand = require( './file.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	let refused = FileCommand.RefuseFile( Parsed, Context, 'jsonx new' );
	if ( refused !== null ) { return refused; }

	Report.WriteResult( Context.Io, value( 'output' ), Skeletons.Skeleton( value( 'kind' ), value( 'name' ) ) );
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'new',
	Describe: 'Write a skeleton to start from: a whole file, or one data source, object or trigger.',
	Positionals: [
		{ Name: 'kind', Type: 'string', Required: true, Choices: Skeletons.KINDS, Describe: 'What to write.' },
	],
	Options: {
		'name': { Type: 'string', Describe: 'The Name it carries; absent keeps the skeleton\'s own.' },
	},
	Handler: handler,
};
