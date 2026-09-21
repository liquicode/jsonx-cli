'use strict';

/*
	jsonx validate [name] [--json <object>] [--strict]

	The findings for the whole file, for one entry, or for a draft - an entry given as JSON and checked
	as if it were in the file, with nothing written (src/File/Draft.js) - as spec section 14 lists them. The result on
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
const Draft = require( '../src/File/Draft.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let tree = Context.Tree;
	let io = Context.Io;
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( tree, Parsed, Name ); };

	let name = value( 'name' );
	let draft = value( 'json' );
	let quiet = value( 'quiet' );

	if ( typeof name === 'string' && typeof draft !== 'undefined' )
	{
		out.Log( '--json is the entry; do not name one as well.\n' );
		return 2;
	}

	let resolved = null;
	let read = null;
	if ( Context.Held )
	{
		// A served validate reads the document the session holds (commands/file.js).
		resolved = { Path: Context.Held.Path, Label: Context.Held.Label };
		read = { Document: Context.Held.Session.Document, Findings: [] };
	}
	else
	{
		let text = null;
		try
		{
			resolved = Reader.ResolvePath( value( 'file' ), io.Env, io.Cwd, io );
			text = Reader.ReadText( resolved.Path, io );
			resolved.Label = Report.FileLabel( resolved.Path, value( 'report-paths' ) );
		}
		catch ( error )
		{
			if ( !( error instanceof Reader.FileError ) ) { throw error; }
			out.Log( error.message + '\n' );
			return error.IsUsage ? 2 : 1;
		}
		read = Reader.ParseText( text );
	}

	let findings = read.Findings;

	if ( typeof read.Document !== 'undefined' )
	{
		// ***Settings are checked against the adapters***, which loads an external adapter package
		// only when a data source names it (AdapterCatalog.js).
		let catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: require( '@liquicode/jsonstor' )() } );
		let options = { jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: catalog.ValidateSettings };
		if ( typeof draft !== 'undefined' )
		{
			findings = Draft.ValidateDraft( read.Document, draft, options );
		}
		else if ( typeof name === 'string' )
		{
			findings = Validate.ValidateEntry( read.Document, name, options );
			if ( findings === null )
			{
				out.Log( 'No entry is named [' + name + '] in ' + resolved.Label + '.\n' );
				return 2;
			}
		}
		else
		{
			findings = Validate.ValidateFile( read.Document, options );
		}
	}

	out.Result( findings );

	let summary = Validate.Summarize( findings );
	if ( !quiet )
	{
		for ( let index = 0; index < findings.length; index++ ) { out.Finding( findings[ index ] ); }
		let label = resolved.Label;
		if ( typeof draft !== 'undefined' ) { label = resolved.Label + ' [draft]'; }
		else if ( typeof name === 'string' ) { label = resolved.Label + ' [' + name + ']'; }
		out.Log( Report.FormatSummary( label, summary ) );
	}

	if ( summary.Errors > 0 ) { return 3; }
	if ( value( 'strict' ) && summary.Warnings > 0 ) { return 3; }
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'validate',
	Describe: 'Report the findings for the file, or for one entry of it.',
	Concurrent: true,
	Positionals: [
		{ Name: 'name', Type: 'string', Complete: 'entries', Describe:'The data source, object or trigger to validate; absent means the whole file.' },
	],
	Options: {
		'json': { Type: 'json', JsonType: 'object', Describe: 'A draft entry as JSON, checked as if it were in the file; nothing is written.' },
		'strict': { Type: 'boolean', Describe: 'Exit 3 on warnings as well as errors.' },
	},
	Handler: handler,
};
