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
const Validate = require( '../src/Validate/Validate.js' );
const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
// Returns { Document, Path, Catalog, ValidateOptions } or { ExitCode }.

function LoadFile( Parsed, Context )
{
	let io = Context.Io;
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
		io.Stderr( error.message + '\n' );
		return { ExitCode: error.IsUsage ? 2 : 1 };
	}

	let read = Reader.ParseText( text );
	let document = read.Document;
	if ( document === null || typeof document !== 'object' || Array.isArray( document ) )
	{
		let findings = ( read.Findings.length > 0 ) ? read.Findings : Validate.ValidateFile( document, {} );
		for ( let index = 0; index < findings.length; index++ ) { io.Stderr( Report.FormatFinding( findings[ index ] ) ); }
		io.Stderr( 'The file cannot be read as a jsonx file.\n' );
		return { ExitCode: 3 };
	}

	let catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: require( '@liquicode/jsonstor' )() } );
	return {
		Document: document,
		Path: resolved.Path,
		Catalog: catalog,
		ValidateOptions: { jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: catalog.ValidateSettings },
	};
}


//---------------------------------------------------------------------
module.exports = {
	LoadFile: LoadFile,
};
