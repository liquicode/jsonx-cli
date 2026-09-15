'use strict';

/*
	The front requests on the WebSocket (cut 5, decision 1): what the TUI decides locally, answered by the
	process for a front end with no parser - the Web UI, and later the desktop's jsonx terminal pane.

		{ "Id", "Line": "<a typed command line>" }       Front.Line.ReadLine, reading no file
		{ "Id", "Entry": "<a typed JSON entry>" }        Front.Entry.ReadEntry, with its Save and Check
		{ "Id", "Complete": "<Input's text>" }           Front.Completion.CompleteText
		{ "Id", "Actions": "<an entry's name>" }         Front.Inventory.ActionsFor, each with its Line
		{ "Id", "Inventory": true }                      Front.Inventory.InventoryOf, with validate's findings

	***Each answers from the held document and runs nothing.*** None waits on the queue: validate and
	engine operators are concurrent commands, and a data source's fields are asked for without waiting.

	-	***A served line reads no file and no standard input*** (Front.Line.ServedIo), or anyone who can
		call could read the server's files.
	-	***Fields come from `datasource describe`***, which opens the data source and so waits its turn. A
		completion starts that ask and answers the fields known now; one after it answers them. What is
		known is forgotten when the document changes and after every Invoke the socket runs, since a write
		may give a store fields it did not have (the TUI's rule).
*/

const Front = {
	Inventory: require( '../../src/Front/Inventory.js' ),
	Entry: require( '../../src/Front/Entry.js' ),
	Line: require( '../../src/Front/Line.js' ),
	Completion: require( '../../src/Front/Completion.js' ),
};
const Words = require( '../../src/CommandLine/Words.js' );


const DESCRIBE_ROWS = 20;

// The names the requests go by, in the order they are looked for on a message.
const REQUESTS = [ 'Line', 'Entry', 'Complete', 'Actions', 'Inventory' ];


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function answered( Result )
{
	return { Ok: true, ExitCode: 0, Result: Result, Findings: [], Log: [] };
}

function refusal( Message )
{
	return { Ok: false, ExitCode: 2, Findings: [], Log: [ Message ] };
}


//---------------------------------------------------------------------
// A schema's property names, dotted, as fields a completion offers.

function field_names( Schema )
{
	let found = [];
	let walk = function ( Node, Prefix )
	{
		if ( !is_object( Node ) || !is_object( Node.properties ) ) { return; }
		Object.keys( Node.properties ).forEach( function ( Key )
		{
			found.push( Prefix + Key );
			walk( Node.properties[ Key ], Prefix + Key + '.' );
		} );
	};
	walk( Schema, '' );
	return found;
}


//---------------------------------------------------------------------
// Answers { Handles( Message ), Answer( Message ), Forget() } for a held session. Answer resolves with an
// envelope; it never throws.

function NewFrontRequests( Held )
{
	let operators = null;
	let fields = {};

	Held.OnEvent( function ( Event )
	{
		if ( Event.Event === 'document' ) { fields = {}; }
		return;
	} );


	//---------------------------------------------------------------------
	async function known_operators()
	{
		if ( operators !== null ) { return operators; }
		let answer = await Held.Invoke( { Command: 'engine operators' } );
		let list = [];
		if ( answer.Ok && is_object( answer.Result ) )
		{
			Object.keys( answer.Result ).forEach( function ( Group ) { if ( Array.isArray( answer.Result[ Group ] ) ) { list = list.concat( answer.Result[ Group ] ); } } );
		}
		operators = list;
		return operators;
	}

	function fields_of( DataSource )
	{
		if ( Array.isArray( fields[ DataSource ] ) ) { return fields[ DataSource ]; }
		if ( fields[ DataSource ] === 'asking' ) { return []; }
		fields[ DataSource ] = 'asking';
		let asked_of = fields;
		Held.Invoke( { Command: 'datasource describe', name: DataSource, rows: DESCRIBE_ROWS } ).then( function ( Answer )
		{
			// The document changed while describe ran: what it found belongs to the forgotten set.
			if ( asked_of !== fields ) { return; }
			fields[ DataSource ] = ( Answer.Ok && is_object( Answer.Result ) ) ? field_names( Answer.Result.Schema ) : [];
			return;
		}, function () { if ( asked_of === fields ) { delete fields[ DataSource ]; } } );
		return [];
	}

	async function inventory()
	{
		let validated = await Held.Invoke( { Command: 'validate' } );
		let findings = Array.isArray( validated.Findings ) ? validated.Findings : [];
		return { Items: Front.Inventory.InventoryOf( Held.Session.Document, findings ), Findings: findings };
	}


	//---------------------------------------------------------------------
	let requests = {};

	requests.Handles = function ( Message )
	{
		return REQUESTS.some( function ( Name ) { return typeof Message[ Name ] !== 'undefined'; } );
	};

	requests.Forget = function ()
	{
		fields = {};
		return;
	};

	requests.Answer = async function ( Message )
	{
		try
		{
			if ( typeof Message.Line !== 'undefined' )
			{
				if ( typeof Message.Line !== 'string' ) { return refusal( 'Line takes the command line as a string.' ); }
				return answered( Front.Line.ReadLine( Held.Tree, Message.Line, Front.Line.ServedIo(), { Front: 'the Web UI' } ) );
			}
			if ( typeof Message.Entry !== 'undefined' )
			{
				if ( typeof Message.Entry !== 'string' ) { return refusal( 'Entry takes the typed JSON as a string.' ); }
				let read = Front.Entry.ReadEntry( Message.Entry, Held.Session.Document );
				if ( read.Target !== null )
				{
					read.Save = Front.Entry.EditInvocation( read.Target, false );
					read.Check = Front.Entry.EditInvocation( read.Target, true );
				}
				return answered( read );
			}
			if ( typeof Message.Complete !== 'undefined' )
			{
				if ( typeof Message.Complete !== 'string' ) { return refusal( 'Complete takes Input\'s text as a string.' ); }
				let options = { Document: Held.Session.Document, Operators: await known_operators(), Fields: fields_of };
				return answered( Front.Completion.CompleteText( Held.Tree, Message.Complete, Front.Line.ServedIo(), options ) );
			}
			if ( typeof Message.Actions !== 'undefined' )
			{
				if ( typeof Message.Actions !== 'string' ) { return refusal( 'Actions takes an entry\'s name as a string.' ); }
				let item = Front.Inventory.InventoryOf( Held.Session.Document, [] ).find( function ( Each ) { return Each.Name === Message.Actions; } );
				if ( !item ) { return refusal( 'No entry is named [' + Message.Actions + '].' ); }
				// Each with the line it stands for, quoted as the parser reads it back, so a page never quotes.
				return answered( Front.Inventory.ActionsFor( Held.Tree, item ).map( function ( Action )
				{
					return Object.assign( {}, Action, { Line: Action.Path.concat( [ Words.QuoteWord( item.Name ) ] ).join( ' ' ) } );
				} ) );
			}
			if ( typeof Message.Inventory !== 'undefined' )
			{
				return answered( await inventory() );
			}
			return refusal( 'Not a front request: ' + REQUESTS.join( ', ' ) + '.' );
		}
		catch ( error )
		{
			return { Ok: false, ExitCode: 1, Findings: [], Log: [ 'The request failed unexpectedly: ' + error.message ] };
		}
	};

	return requests;
}


//---------------------------------------------------------------------
module.exports = {
	REQUESTS: REQUESTS,
	DESCRIBE_ROWS: DESCRIBE_ROWS,
	NewFrontRequests: NewFrontRequests,
};
