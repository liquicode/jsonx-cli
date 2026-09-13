'use strict';

/*
	Reading a jsonx file: which file, and its text as a document.

	***A file which is not JSON is a finding, not an exception*** (spec 14.1.1). `ParseText`
	returns the document when there is one and the findings either way, so `jsonx validate` can
	report a broken file the same way it reports a broken object, with a line and a column.

	***Which file is decided in one place*** (user, 2026-09-13): `--file`, else the `JSONX_FILE`
	environment variable, else the single `*.jsonx` in the current directory when there is
	exactly one. Nothing else is guessed.
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );


//---------------------------------------------------------------------
// A file could not be found or read. Carries whether the caller's own arguments were at fault.

class FileError extends Error
{
	constructor( Message, IsUsage )
	{
		super( Message );
		this.name = 'FileError';
		this.IsUsage = ( IsUsage === true );
	}
}


//---------------------------------------------------------------------
// The file system calls this module makes, replaceable by a test.

function file_io( Io )
{
	let io = ( Io && typeof Io === 'object' ) ? Io : {};
	return {
		ReadFile: io.ReadFile || function ( Path ) { return LIB_FS.readFileSync( Path, 'utf8' ); },
		ListDirectory: io.ListDirectory || function ( Path )
		{
			return LIB_FS.readdirSync( Path, { withFileTypes: true } )
				.filter( function ( Entry ) { return Entry.isFile(); } )
				.map( function ( Entry ) { return Entry.name; } );
		},
	};
}


//---------------------------------------------------------------------
// The line and column of a character offset, both counted from 1.

function line_and_column( Text, Offset )
{
	let line = 1;
	let column = 1;
	for ( let index = 0; index < Offset && index < Text.length; index++ )
	{
		if ( Text[ index ] === '\n' ) { line++; column = 1; }
		else { column++; }
	}
	return { Line: line, Column: column };
}


//---------------------------------------------------------------------
// The document in a text, and the findings about it.

function ParseText( Text )
{
	let text = ( typeof Text === 'string' ) ? Text : '';
	if ( text.charCodeAt( 0 ) === 0xFEFF ) { text = text.slice( 1 ); }

	try
	{
		return { Document: JSON.parse( text ), Findings: [] };
	}
	catch ( error )
	{
		// ***Node gives a position for some JSON errors and not others*** (measured on 22.19):
		// `Expected double-quoted property name in JSON at position 7` has one, `Unexpected token
		// '}', "..." is not valid JSON` has none and quotes the text instead. A position becomes a
		// line and a column; the end of the input is the end of the text; anything else keeps
		// Node's own words.
		let message = error.message.replace( /\s*\(line \d+ column \d+\)\s*$/, '' );
		let found = /at position (\d+)/.exec( error.message );
		let offset = found ? Number( found[ 1 ] ) : null;
		if ( offset === null && /Unexpected end of JSON input/.test( error.message ) ) { offset = text.length; }

		let where = '';
		if ( offset !== null )
		{
			let place = line_and_column( text, offset );
			where = ' at line ' + place.Line + ', column ' + place.Column;
			message = message.replace( /\s*in JSON at position \d+/, '' ).replace( /\s*at position \d+/, '' );
		}
		return {
			Document: undefined,
			Findings: [ {
				Severity: 'error',
				Path: '',
				Message: 'The file is not valid JSON' + where + ': ' + message + ' (3.1).',
			} ],
		};
	}
}


//---------------------------------------------------------------------
// The text of a file. A file which is not there, or cannot be read, is a FileError.

function ReadText( Path, Io )
{
	let io = file_io( Io );
	try
	{
		return io.ReadFile( Path );
	}
	catch ( error )
	{
		throw new FileError( 'Cannot read the jsonx file [' + Path + ']: ' + error.message, false );
	}
}


//---------------------------------------------------------------------
// Which file a session uses, and how it was chosen.
//
// Returns { Path, Source } where Source is '--file', 'JSONX_FILE' or 'directory'.

function ResolvePath( File, Env, Cwd, Io )
{
	let cwd = ( typeof Cwd === 'string' ) ? Cwd : process.cwd();
	let env = ( Env && typeof Env === 'object' ) ? Env : {};

	if ( typeof File === 'string' && File !== '' )
	{
		return { Path: LIB_PATH.resolve( cwd, File ), Source: '--file' };
	}

	if ( typeof env.JSONX_FILE === 'string' && env.JSONX_FILE !== '' )
	{
		return { Path: LIB_PATH.resolve( cwd, env.JSONX_FILE ), Source: 'JSONX_FILE' };
	}

	let names = [];
	try
	{
		names = file_io( Io ).ListDirectory( cwd ).filter( function ( Name ) { return /\.jsonx$/i.test( Name ); } ).sort();
	}
	catch ( error )
	{
		names = [];
	}

	if ( names.length === 1 )
	{
		return { Path: LIB_PATH.join( cwd, names[ 0 ] ), Source: 'directory' };
	}

	let tried = '--file was not given, JSONX_FILE is not set, and ' + cwd;
	if ( names.length === 0 )
	{
		throw new FileError( 'No jsonx file: ' + tried + ' holds no .jsonx file.', true );
	}
	throw new FileError( 'No jsonx file: ' + tried + ' holds ' + names.length + ' .jsonx files (' + names.join( ', ' ) + '); name one with --file.', true );
}


//---------------------------------------------------------------------
module.exports = {
	FileError: FileError,
	ParseText: ParseText,
	ReadText: ReadText,
	ResolvePath: ResolvePath,
};
