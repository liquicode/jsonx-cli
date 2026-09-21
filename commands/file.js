'use strict';

/*
	Loading a jsonx file for a command which reads or edits it without running anything, and the
	options every such command shares.

	A file which is not JSON, or not an object, cannot be edited: its findings go to standard error
	with exit 3. A file with other errors can, so that it can be repaired an edit at a time.
*/

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Reader = require( '../src/File/Reader.js' );
const Report = require( '../src/Report.js' );
const Validate = require( '../src/Validate/Validate.js' );
const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );


//---------------------------------------------------------------------
// Returns { Document, Path, Label, Catalog, ValidateOptions, Binds, Sets } or { ExitCode }. Label is
// what a report calls the file (Report.FileLabel). Binds and Sets
// are the held session's overrides when a served command loads, and absent otherwise.
//
// ***A served command reads the document the session holds***, not the disk, so an edit changes
// the file every later request sees.

function LoadFile( Parsed, Context )
{
	let io = Context.Io;

	if ( Context.Held )
	{
		let held = Context.Held;
		return {
			Document: held.Session.Document,
			Path: held.Path,
			Label: held.Label,
			Catalog: held.Session.Catalog,
			ValidateOptions: { jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: held.Session.Catalog.ValidateSettings },
			Binds: held.Binds,
			Sets: held.Sets,
		};
	}

	let file = Context.Parser.Value( Context.Tree, Parsed, 'file' );

	let resolved = null;
	let text = null;
	try
	{
		resolved = Reader.ResolvePath( file, io.Env, io.Cwd, io );
		text = Reader.ReadText( resolved.Path, io );
	}
	catch ( error )
	{
		if ( !( error instanceof Reader.FileError ) ) { throw error; }
		Context.Out.Log( error.message + '\n' );
		return { ExitCode: error.IsUsage ? 2 : 1 };
	}

	let read = Reader.ParseText( text );
	let document = read.Document;
	if ( document === null || typeof document !== 'object' || Array.isArray( document ) )
	{
		let findings = ( read.Findings.length > 0 ) ? read.Findings : Validate.ValidateFile( document, {} );
		for ( let index = 0; index < findings.length; index++ ) { Context.Out.Finding( findings[ index ] ); }
		Context.Out.Log( 'The file cannot be read as a jsonx file.\n' );
		return { ExitCode: 3 };
	}

	let catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: require( '@liquicode/jsonstor' )() } );
	return {
		Document: document,
		Path: resolved.Path,
		Label: Report.FileLabel( resolved.Path, Context.Parser.Value( Context.Tree, Parsed, 'report-paths' ) ),
		Catalog: catalog,
		ValidateOptions: { jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: catalog.ValidateSettings },
	};
}


//---------------------------------------------------------------------
// For a command which reads no jsonx file: --file is a global option, so it parses anywhere, and a
// command which accepted and ignored it would look healthy while aimed at nothing. Returns an exit
// code when --file was given, else null.

function RefuseFile( Parsed, Context, What )
{
	if ( Parsed.Given.file !== true ) { return null; }
	Context.Out.Log( 'Option [--file] has no effect on ' + What + ', which reads no jsonx file.\n' );
	return 2;
}


//---------------------------------------------------------------------
module.exports = {
	LoadFile: LoadFile,
	RefuseFile: RefuseFile,
};
