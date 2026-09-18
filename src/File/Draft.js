'use strict';

/*
	A draft: an entry which is not in the file, evaluated exactly as if it were (cut 7, decision 13).
	`validate`, `plan`, `explain` and `run` take one as `--json <object>` beside an entry name, and a
	model building an object checks it here before answering, with nothing written.

	***The draft is placed in a copy of the document and found there by name***, so the four commands
	reach it through the same functions they use for an entry of the file - ValidateEntry, PlanObject,
	ExplainEntry and the runner - and a data source it names, a Process it calls and a trigger which
	watches its data source all resolve as they would for the file's own entry.

	***The draft's shape picks its section*** (spec 4, 5, 13): an object carries `Kind`; a data source
	carries `AdapterName` and no `Kind`; a trigger carries `Process` and neither. Anything else is
	checked as an object, and the findings say what is missing.

	***A draft without a Name is named `(ad hoc)`***, as the storage verbs name a built object.

	***A draft whose Name is already in the file stands in for that entry*** when the two are in the
	same section: the copy holds the draft in the entry's place, and a note says so. The design
	profile proposes a changed version of an existing object; that is not an error. When the name
	belongs to an entry of another section, the draft is appended and the file's own rule reports the
	clash (3.5, one namespace).

	***A finding's path names the draft, not its position in the copy***: `Draft.Update`, not
	`Objects.7.Update`. The storage verbs keep their `(ad hoc)` prefix through the same rewrite.
*/

const Names = require( './Names.js' );
const Validate = require( '../Validate/Validate.js' );


const DRAFT_PATH = 'Draft';
const AD_HOC = '(ad hoc)';


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return JSON.parse( JSON.stringify( Value ) );
}


//---------------------------------------------------------------------
// The section a draft belongs to, by its shape.

function Section( Draft )
{
	if ( !is_object( Draft ) ) { return 'Objects'; }
	if ( typeof Draft.Kind === 'string' ) { return 'Objects'; }
	if ( typeof Draft.AdapterName === 'string' ) { return 'DataSources'; }
	if ( typeof Draft.Process === 'string' ) { return 'Triggers'; }
	return 'Objects';
}


//---------------------------------------------------------------------
// What an entry is called in a message: its Kind for an object, else its section's word.

function what_is( Section_, Entry )
{
	if ( Section_ === 'DataSources' ) { return 'data source'; }
	if ( Section_ === 'Triggers' ) { return 'trigger'; }
	return ( is_object( Entry ) && typeof Entry.Kind === 'string' ) ? Entry.Kind : 'object';
}


//---------------------------------------------------------------------
// Places a draft in a copy of the document. Answers:
//
//		{ Copy, Entry, Name, Section, Path, Note }
//
// Entry is the draft as placed (a copy, named); Path is its dotted path in Copy; Note is the finding
// which says the draft stands in for an entry of the file, or null.

function Place( Document, Draft )
{
	let copy = clone( is_object( Document ) ? Document : {} );
	let entry = is_object( Draft ) ? clone( Draft ) : {};
	let section = Section( entry );

	let name = ( typeof entry.Name === 'string' && entry.Name !== '' ) ? entry.Name : AD_HOC;
	entry.Name = name;

	if ( !Array.isArray( copy[ section ] ) ) { copy[ section ] = []; }

	let note = null;
	let existing = Names.FindEntry( copy, name );
	let index = -1;
	if ( existing !== null && existing.Section === section )
	{
		index = existing.Index;
		copy[ section ][ index ] = entry;
		let article = /^[AEIOU]/.test( what_is( section, existing.Entry ) ) ? 'An' : 'A';
		note = {
			Severity: 'note',
			Path: DRAFT_PATH,
			Message: article + ' ' + what_is( section, existing.Entry ) + ' named [' + name + '] is in the file; the draft is checked in its place.',
		};
	}
	else
	{
		copy[ section ].push( entry );
		index = copy[ section ].length - 1;
	}

	return {
		Copy: copy,
		Entry: entry,
		Name: name,
		Section: section,
		Path: section + '.' + index,
		Note: note,
	};
}


//---------------------------------------------------------------------
// Findings pathed under Path, re-pathed under Prefix (DRAFT_PATH unless given).

function Rewrite( Findings, Path, Prefix )
{
	let prefix = ( typeof Prefix === 'string' ) ? Prefix : DRAFT_PATH;
	return Findings.map( function ( Finding )
	{
		let path = Finding.Path;
		if ( path === Path || path.startsWith( Path + '.' ) ) { path = prefix + path.slice( Path.length ); }
		return { Severity: Finding.Severity, Path: path, Message: Finding.Message };
	} );
}


//---------------------------------------------------------------------
// ***A draft is asked for by name by definition***, so the note that nothing in the file calls it
// (14.3.2) says nothing; it is kept when the draft stands in for an entry, whose callers matter.
// validate and plan both drop it for a fresh draft, through this.

function DropUncalledNote( Findings, Path )
{
	return Findings.filter( function ( Finding )
	{
		return !( Finding.Severity === 'note' && Finding.Path === Path && Finding.Message.endsWith( '(14.3.2).' ) );
	} );
}


//---------------------------------------------------------------------
// The findings for a draft, every severity, as ValidateEntry answers them for an entry of the file.
// Options are ValidateFile's; Prefix replaces DRAFT_PATH in the paths when given.
//
// ***The copy is validated whole and filtered by the draft's path***, not by its name: a draft carrying
// a data source's name is found second by name, and its findings - the clash itself (3.5) - would be
// filtered against the data source's path and lost.

function ValidateDraft( Document, Draft, Options, Prefix )
{
	let placed = Place( Document, Draft );
	let findings = Validate.ValidateFile( placed.Copy, Options ).filter( function ( Finding )
	{
		return ( Finding.Path === placed.Path ) || Finding.Path.startsWith( placed.Path + '.' );
	} );
	if ( placed.Note === null ) { findings = DropUncalledNote( findings, placed.Path ); }
	findings = Rewrite( findings, placed.Path, Prefix );
	if ( placed.Note !== null )
	{
		let note = Object.assign( {}, placed.Note );
		if ( typeof Prefix === 'string' ) { note.Path = Prefix; }
		findings.unshift( note );
	}
	return findings;
}


//---------------------------------------------------------------------
module.exports = {
	DRAFT_PATH: DRAFT_PATH,
	AD_HOC: AD_HOC,
	Section: Section,
	Place: Place,
	Rewrite: Rewrite,
	DropUncalledNote: DropUncalledNote,
	ValidateDraft: ValidateDraft,
};
