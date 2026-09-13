'use strict';

/*
	What a command writes: its result on standard output, its report on standard error.

	***Standard output carries the result and nothing else***, so a command pipes and redirects.
	Everything a person reads - progress, findings, a summary - goes to standard error, and
	`--quiet` removes it.

	Cut 1 step 3 holds what `jsonx validate` needs: the result formats and the finding lines. The
	per-object run lines join when the runner does.
*/


//---------------------------------------------------------------------
// The result, as --output asks: `json` pretty with tabs, or `jsonl` one line per element of an
// array (one line for anything else, nothing for an empty array).

function FormatResult( Output, Value )
{
	if ( Output === 'jsonl' )
	{
		if ( Array.isArray( Value ) )
		{
			return Value.map( function ( Item ) { return JSON.stringify( Item ) + '\n'; } ).join( '' );
		}
		return JSON.stringify( Value ) + '\n';
	}
	return JSON.stringify( Value, null, '\t' ) + '\n';
}


//---------------------------------------------------------------------
function WriteResult( Io, Output, Value )
{
	Io.Stdout( FormatResult( Output, Value ) );
	return;
}


//---------------------------------------------------------------------
// One finding as a report line: severity, path, message.

function FormatFinding( Finding )
{
	let path = ( Finding.Path === '' ) ? '(file)' : Finding.Path;
	return Finding.Severity.padEnd( 8 ) + path + '\n' + '        ' + Finding.Message + '\n';
}


//---------------------------------------------------------------------
function plural( Count, Word )
{
	return Count + ' ' + Word + ( Count === 1 ? '' : 's' );
}


//---------------------------------------------------------------------
// `observatory.jsonx: 1 error, 0 warnings, 2 notes`

function FormatSummary( Label, Summary )
{
	return Label + ': ' + plural( Summary.Errors, 'error' ) + ', ' + plural( Summary.Warnings, 'warning' ) + ', ' + plural( Summary.Notes, 'note' ) + '\n';
}


//---------------------------------------------------------------------
module.exports = {
	FormatResult: FormatResult,
	WriteResult: WriteResult,
	FormatFinding: FormatFinding,
	FormatSummary: FormatSummary,
};
