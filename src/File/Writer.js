'use strict';

/*
	Writing a jsonx file back.

	***The document is edited in place and never rebuilt***, so every field a reader does not
	define is still on it and every key is where it was (spec 15.3). What a write changes is
	whitespace: the file comes back tab-indented, with a trailing newline.

	***Written beside and then renamed over***, so a failure part way through leaves the old file
	whole rather than a truncated one.
*/

const LIB_FS = require( 'fs' );


//---------------------------------------------------------------------
function FormatDocument( Document )
{
	return JSON.stringify( Document, null, '\t' ) + '\n';
}


//---------------------------------------------------------------------
function WriteFile( Path, Document, Io )
{
	let text = FormatDocument( Document );

	if ( Io && typeof Io.WriteFile === 'function' )
	{
		Io.WriteFile( Path, text );
		return text;
	}

	let temporary = Path + '.~writing';
	LIB_FS.writeFileSync( temporary, text, 'utf8' );
	LIB_FS.renameSync( temporary, Path );
	return text;
}


//---------------------------------------------------------------------
module.exports = {
	FormatDocument: FormatDocument,
	WriteFile: WriteFile,
};
