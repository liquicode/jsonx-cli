'use strict';

/*
	jsonx validate [name] [--strict]

	The findings for the whole file, or for one entry, as spec section 14 lists them. The result on
	standard output is the findings array; the report on standard error is one block per finding
	and a summary line.

	Exit codes: 0 when there is no error (and, with --strict, no warning); 3 when there is; 2 when
	no file can be chosen or the name matches no entry; 1 when the file cannot be read.
*/

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Reader = require( '../src/File/Reader.js' );
const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let tree = Context.Tree;
	let io = Context.Io;
	let value = function ( Name ) { return Context.Parser.Value( tree, Parsed, Name ); };

	let name = value( 'name' );
	let output = value( 'output' );
	let quiet = value( 'quiet' );

	let resolved = null;
	let text = null;
	try
	{
		resolved = Reader.ResolvePath( value( 'file' ), io.Env, io.Cwd, io );
		text = Reader.ReadText( resolved.Path, io );
	}
	catch ( error )
	{
		if ( !( error instanceof Reader.FileError ) ) { throw error; }
		io.Stderr( error.message + '\n' );
		return error.IsUsage ? 2 : 1;
	}

	let read = Reader.ParseText( text );
	let findings = read.Findings;

	if ( typeof read.Document !== 'undefined' )
	{
		// ***Settings are checked against the adapters***, which loads an external adapter package
		// only when a data source names it (AdapterCatalog.js).
		let catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: require( '@liquicode/jsonstor' )() } );
		let options = { jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: catalog.ValidateSettings };
		if ( typeof name === 'string' )
		{
			findings = Validate.ValidateEntry( read.Document, name, options );
			if ( findings === null )
			{
				io.Stderr( 'No entry is named [' + name + '] in ' + resolved.Path + '.\n' );
				return 2;
			}
		}
		else
		{
			findings = Validate.ValidateFile( read.Document, options );
		}
	}

	Report.WriteResult( io, output, findings );

	let summary = Validate.Summarize( findings );
	if ( !quiet )
	{
		for ( let index = 0; index < findings.length; index++ ) { io.Stderr( Report.FormatFinding( findings[ index ] ) ); }
		let label = ( typeof name === 'string' ) ? resolved.Path + ' [' + name + ']' : resolved.Path;
		io.Stderr( Report.FormatSummary( label, summary ) );
	}

	if ( summary.Errors > 0 ) { return 3; }
	if ( value( 'strict' ) && summary.Warnings > 0 ) { return 3; }
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'validate',
	Describe: 'Report the findings for the file, or for one entry of it.',
	Positionals: [
		{ Name: 'name', Type: 'string', Complete: 'entries', Describe:'The data source, object or trigger to validate; absent means the whole file.' },
	],
	Options: {
		'strict': { Type: 'boolean', Describe: 'Exit 3 on warnings as well as errors.' },
	},
	Handler: handler,
};
