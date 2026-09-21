'use strict';

/*
	jsonx format [--check]

	Rewrites the file in canonical order (plan F3.4, src/File/Format.js): tab indented, fields in
	Appendix A's order, unknown fields kept, array order kept. A file with validation errors can be
	formatted; one which is not a JSON object cannot.

	The result on standard output is `{ Path, Changed }`. With --check nothing is written, and a file
	which would change exits 1, for a check before a commit. A difference of line endings alone is
	not a change.

	Exit codes: 0 formatted, or already formatted; 1 --check found a change, or the file cannot be
	read; 2 no file can be chosen; 3 the file is not a JSON object.
*/

const Format = require( '../src/File/Format.js' );
const Reader = require( '../src/File/Reader.js' );
const Writer = require( '../src/File/Writer.js' );
const FileCommand = require( './file.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	let loaded = FileCommand.LoadFile( Parsed, Context );
	if ( typeof loaded.ExitCode === 'number' ) { return loaded.ExitCode; }

	let formatted = Format.FormatDocument( loaded.Document );
	let canonical = Writer.FormatDocument( formatted );
	let changed = !Format.IsFormatted( Reader.ReadText( loaded.Path, io ), canonical );
	let quiet = value( 'quiet' );

	if ( value( 'check' ) )
	{
		Context.Out.Result( { Path: loaded.Path, Changed: changed } );
		if ( changed && !quiet ) { Context.Out.Log( loaded.Label + ' is not formatted. Run jsonx format to rewrite it.\n' ); }
		return changed ? 1 : 0;
	}

	if ( changed ) { Writer.WriteFile( loaded.Path, formatted, io.WriteFile ? io : null ); }
	Context.Out.Result( { Path: loaded.Path, Changed: changed } );
	if ( !quiet ) { Context.Out.Log( loaded.Label + ( changed ? ' formatted.\n' : ' is already formatted.\n' ) ); }
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'format',
	Describe: 'Rewrite the file in canonical order, tab indented, keeping unknown fields and array order.',
	Options: {
		'check': { Type: 'boolean', Describe: 'Write nothing; exit 1 when the file would change.' },
	},
	Handler: handler,
};
