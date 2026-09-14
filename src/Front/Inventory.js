'use strict';

/*
	What a front end shows of a file, and what it offers to do with an entry (plan F5.1), with no screen
	and no socket: the TUI's model calls these, and the WebSocket answers them for the Web UI (cut 5,
	decision 1: the process decides, so a page of plain script tags needs no parser).

	Moved from modes/tui/Model.js unchanged (cut 5, step 1).
*/

const Parser = require( '../CommandLine/Parser.js' );
const Edit = require( '../File/Edit.js' );


const SEVERITY_RANK = { note: 1, warning: 2, error: 3 };

// Commands a front end does not send: they are front ends or shells of their own.
const NOT_SENT = [ 'serve', 'mcp', 'tui', 'completion', '__complete' ];

// The actions an entry's menu lists first, in this order; the rest follow in the tree's order.
const FIRST_ACTIONS = [ 'run', 'trigger run', 'debug', 'datasource find', 'datasource count', 'plan', 'explain', 'validate' ];

// ***Actions which are the point of the menu***, sent at once although they change data: what the person
// chose was to run it (user, 2026-09-14: "no way to run/execute any of the objects").
const RUN_ACTIONS = [ 'run', 'trigger run', 'debug' ];

// Commands which may change or remove what is there. MCP marks them destructive, and a menu does not send
// them at once. Every other command which is not read-only is additive: it inserts, adds or saves.
const DESTRUCTIVE_WORDS = [ 'run', 'update', 'delete', 'replace', 'drop', 'remove', 'rename', 'set', 'format', 'flush', 'refresh-index' ];


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return ( typeof Value === 'undefined' ) ? undefined : JSON.parse( JSON.stringify( Value ) );
}


//---------------------------------------------------------------------
// The inventory of a document: every entry in file order, with the worst severity found in it.
//
//		{ Section, Index, Kind, Name, Label, Severity: 'error' | 'warning' | 'note' | null }

function InventoryOf( Document, Findings )
{
	let worst = {};
	( Array.isArray( Findings ) ? Findings : [] ).forEach( function ( Finding )
	{
		let parts = String( Finding.Path || '' ).split( '.' );
		if ( parts.length < 2 || !/^\d+$/.test( parts[ 1 ] ) ) { return; }
		let key = parts[ 0 ] + '.' + parts[ 1 ];
		if ( !worst[ key ] || SEVERITY_RANK[ Finding.Severity ] > SEVERITY_RANK[ worst[ key ] ] ) { worst[ key ] = Finding.Severity; }
	} );

	let items = [];
	[ 'DataSources', 'Objects', 'Triggers' ].forEach( function ( Section )
	{
		let entries = ( is_object( Document ) && Array.isArray( Document[ Section ] ) ) ? Document[ Section ] : [];
		entries.forEach( function ( Entry, Index )
		{
			if ( !is_object( Entry ) ) { return; }
			let kind = ( Section === 'Objects' ) ? ( Entry.Kind || null ) : ( Section === 'DataSources' ? 'DataSource' : 'Trigger' );
			items.push( {
				Section: Section,
				Index: Index,
				Kind: kind,
				Name: ( typeof Entry.Name === 'string' ) ? Entry.Name : '(unnamed)',
				Label: ( Section === 'DataSources' ) ? String( Entry.AdapterName || '' ) : ( Section === 'Triggers' ? 'runs ' + String( Entry.Process || '' ) : String( Entry.DataSource || '' ) ),
				Severity: worst[ Section + '.' + Index ] || null,
			} );
		} );
	} );
	return items;
}


//---------------------------------------------------------------------
// ***An entry's actions are read from the command tree*** (plan F5.1: "actions come from F3.1/F3.2"):
// every command, not hidden and not a front end, whose first positional declares it completes to this
// kind of entry. A command added to the table with such a positional joins the menu with no change here.
//
//		{ Command: 'datasource find', Path, Label, Describe, Sends }
//
// `Sends` is true when the command can be sent with the entry's name alone and changes nothing, or is
// one of RUN_ACTIONS. Otherwise choosing it puts the command in Input to finish or confirm with Enter:
// it needs more (rename's new name, update's criteria), or it changes the file or the data (remove,
// flush), judged by the words MCP marks destructive.

function ActionsFor( Tree, Item )
{
	if ( !is_object( Item ) ) { return []; }
	let actions = [];

	function completes_to( Complete )
	{
		if ( Complete === 'entries' ) { return true; }
		if ( Complete === 'objects' ) { return Item.Section === 'Objects'; }
		if ( typeof Complete === 'string' && Complete.startsWith( 'objects:' ) ) { return Item.Section === 'Objects' && Item.Kind === Complete.slice( 'objects:'.length ); }
		if ( Complete === 'datasources' ) { return Item.Section === 'DataSources'; }
		if ( Complete === 'triggers' ) { return Item.Section === 'Triggers'; }
		return false;
	}

	function visit( Node, Path )
	{
		if ( Node.Hidden === true || ( Path.length && NOT_SENT.includes( Path[ 0 ] ) ) ) { return; }
		let positionals = Array.isArray( Node.Positionals ) ? Node.Positionals : [];
		if ( typeof Node.Handler === 'function' && positionals.length && completes_to( positionals[ 0 ].Complete ) )
		{
			let command = Path.join( ' ' );
			let needs_more = positionals.slice( 1 ).some( function ( Each ) { return Each.Required === true; } );
			let options = Parser.OptionsAt( Tree, Path );
			if ( Object.keys( options ).some( function ( Name ) { return options[ Name ].Required === true; } ) ) { needs_more = true; }
			let changes = DESTRUCTIVE_WORDS.includes( Path[ Path.length - 1 ] );
			actions.push( {
				Command: command,
				Path: Path.slice(),
				Label: Path[ Path.length - 1 ],
				Describe: Node.Describe || '',
				Sends: RUN_ACTIONS.includes( command ) || ( !needs_more && !changes ),
			} );
		}
		( Array.isArray( Node.Commands ) ? Node.Commands : [] ).forEach( function ( Child ) { visit( Child, Path.concat( [ Child.Command ] ) ); } );
		return;
	}
	visit( Tree, [] );

	let rank = function ( Action ) { let index = FIRST_ACTIONS.indexOf( Action.Command ); return ( index < 0 ) ? FIRST_ACTIONS.length : index; };
	return actions
		.map( function ( Action, Index ) { return { Action: Action, Index: Index }; } )
		.sort( function ( A, B ) { return ( rank( A.Action ) - rank( B.Action ) ) || ( A.Index - B.Index ); } )
		.map( function ( Each ) { return Each.Action; } );
}


//---------------------------------------------------------------------
// The noun an entry typed as JSON belongs to, for add and set: a Kind names its noun; an AdapterName
// is a data source; a Process with no Kind is a trigger. Null when it is none of them.

function NounOf( Entry )
{
	if ( !is_object( Entry ) ) { return null; }
	if ( typeof Entry.Kind === 'string' )
	{
		let noun = Entry.Kind.toLowerCase();
		return ( Edit.NOUNS[ noun ] && Edit.NOUNS[ noun ].Kind === Entry.Kind ) ? noun : null;
	}
	if ( typeof Entry.AdapterName === 'string' ) { return 'datasource'; }
	if ( typeof Entry.Process === 'string' ) { return 'trigger'; }
	return null;
}


//---------------------------------------------------------------------
// A `set` body which makes the entry exactly the one typed: its fields, and null for every field the
// file's entry has that the typed one does not (set removes a field set to null).

function ReplacementBody( Current, Typed )
{
	let body = clone( Typed );
	Object.keys( is_object( Current ) ? Current : {} ).forEach( function ( Key )
	{
		if ( !Object.prototype.hasOwnProperty.call( Typed, Key ) ) { body[ Key ] = null; }
	} );
	return body;
}


//---------------------------------------------------------------------
module.exports = {
	SEVERITY_RANK: SEVERITY_RANK,
	NOT_SENT: NOT_SENT,
	FIRST_ACTIONS: FIRST_ACTIONS,
	RUN_ACTIONS: RUN_ACTIONS,
	DESTRUCTIVE_WORDS: DESTRUCTIVE_WORDS,
	InventoryOf: InventoryOf,
	ActionsFor: ActionsFor,
	NounOf: NounOf,
	ReplacementBody: ReplacementBody,
};
