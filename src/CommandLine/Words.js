'use strict';

/*
	A command line typed as text, split into words (cut 4: the TUI's Input pane, which has no shell to
	do it).

	***One rule, the same on every platform***, rather than bash's or PowerShell's:
	-	whitespace separates words
	-	"double" and 'single' quotes join a word, and are removed; a quote may start mid-word
	-	inside double quotes, \" and \\ are a quote and a backslash; any other backslash is itself
	-	outside quotes and inside single quotes, a backslash is itself, so a Windows path needs no
		doubling
	-	***a word which begins with { or [ is JSON***: it runs to its matching bracket, its own quotes
		and spaces kept, so `--criteria {"Status": "confirmed"}` is typed as it reads. No command word
		begins with a bracket, and quoting JSON as a shell would still works. (Found by the TUI model
		test: with quotes as syntax, every JSON option lost its quotes.)

	***A line being typed is answered too***: an unclosed quote or bracket is reported as Open rather
	than refused, and a line ending in whitespace has an empty word being typed, so completion knows
	where it is.
*/


//---------------------------------------------------------------------
// From a { or [ at Start, the index just past its matching bracket, or -1 when the text ends first.

function json_end( Text, Start )
{
	let depth = 0;
	let in_string = false;
	for ( let index = Start; index < Text.length; index++ )
	{
		let ch = Text[ index ];
		if ( in_string )
		{
			if ( ch === '\\' ) { index++; continue; }
			if ( ch === '"' ) { in_string = false; }
			continue;
		}
		if ( ch === '"' ) { in_string = true; continue; }
		if ( ch === '{' || ch === '[' ) { depth++; continue; }
		if ( ch === '}' || ch === ']' )
		{
			depth--;
			if ( depth === 0 ) { return index + 1; }
		}
	}
	return -1;
}


//---------------------------------------------------------------------
// Answers { Words, Open, Current }:
//		Words     the words, quotes removed
//		Open      the quote character left open at the end, or null
//		Current   the word being typed at the end: the last word, or '' after trailing whitespace

function SplitWords( Text )
{
	let text = String( Text === null || typeof Text === 'undefined' ? '' : Text );
	let words = [];
	let word = '';
	let in_word = false;
	let quote = null;

	for ( let index = 0; index < text.length; index++ )
	{
		let ch = text[ index ];

		if ( quote === '"' )
		{
			if ( ch === '\\' && ( text[ index + 1 ] === '"' || text[ index + 1 ] === '\\' ) ) { word += text[ index + 1 ]; index++; continue; }
			if ( ch === '"' ) { quote = null; continue; }
			word += ch;
			continue;
		}
		if ( quote === '\'' )
		{
			if ( ch === '\'' ) { quote = null; continue; }
			word += ch;
			continue;
		}

		if ( !in_word && ( ch === '{' || ch === '[' ) )
		{
			let end = json_end( text, index );
			if ( end < 0 )
			{
				// Still being typed: the rest of the line is this word, and the bracket is open.
				words.push( text.slice( index ) );
				return { Words: words, Open: ch, Current: text.slice( index ) };
			}
			word = text.slice( index, end );
			in_word = true;
			index = end - 1;
			continue;
		}
		if ( ch === '"' || ch === '\'' ) { quote = ch; in_word = true; continue; }
		if ( /\s/.test( ch ) )
		{
			if ( in_word ) { words.push( word ); word = ''; in_word = false; }
			continue;
		}
		word += ch;
		in_word = true;
	}
	if ( in_word ) { words.push( word ); }

	let trailing_space = ( quote === null ) && /\s$/.test( text );
	return {
		Words: words,
		Open: quote,
		Current: ( trailing_space || words.length === 0 ) ? '' : words[ words.length - 1 ],
	};
}


//---------------------------------------------------------------------
// A word written so SplitWords reads it back as it is: bare when it can be, else double quoted.

function QuoteWord( Word )
{
	let word = String( Word );
	if ( word !== '' && !/[\s"']/.test( word ) && !/^[{[]/.test( word ) ) { return word; }
	return '"' + word.replace( /\\(?=["\\]|$)/g, '\\\\' ).replace( /"/g, '\\"' ) + '"';
}


//---------------------------------------------------------------------
module.exports = {
	SplitWords: SplitWords,
	QuoteWord: QuoteWord,
};
