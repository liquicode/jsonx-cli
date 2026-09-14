'use strict';

/*
	A session: one jsonx file, held open with everything needed to run it.

	***One session is what every mode holds.*** The command line makes one per invocation and
	releases it; the served modes of later cuts will hold one for as long as they run, which is
	what lets a write made through them fire the file's triggers.

	A session puts the parts together - one jsonstor instance with the trigger filter loaded, an
	adapter catalog over it, the data sources (with the trigger filter innermost on every data
	source a programmatic trigger watches), the process host, and the runner - and it answers the
	three questions the trigger filter asks of it.
*/

const Names = require( '../File/Names.js' );
const AdapterCatalog = require( './AdapterCatalog.js' );
const DataSources = require( './DataSources.js' );
const Host = require( './Host.js' );
const Runner = require( './Runner.js' );
const Triggers = require( './Triggers.js' );


// The built-in jsonstor filter --trace stacks.
const TRACE_FILTER = 'jsonstor-oplog';


//---------------------------------------------------------------------
class SessionError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'SessionError';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// JSON with every object's keys sorted, so two values equal in content compare equal as text.

function stable_json( Value )
{
	if ( Array.isArray( Value ) ) { return '[' + Value.map( stable_json ).join( ',' ) + ']'; }
	if ( is_object( Value ) )
	{
		return '{' + Object.keys( Value ).sort().map( function ( Key ) { return JSON.stringify( Key ) + ':' + stable_json( Value[ Key ] ); } ).join( ',' ) + '}';
	}
	return ( typeof Value === 'undefined' ) ? 'null' : JSON.stringify( Value );
}


//---------------------------------------------------------------------
// Options:
//		Document       the jsonx file, read
//		Path           where it is
//		Binds, Sets    override tokens
//		Env, Cwd       the environment and working directory
//		jsonstor       an instance to use; a new one when absent
//		Require        how the catalog loads adapter packages; `require` when absent
//		MaxSteps, MaxCalls   process host limits
//		Statistics     true to measure every storage call (--verbose)
//		Changes        true for an Update to keep the documents it changed on its report (--changes)
//		Trace          true to stack jsonstor-oplog over every data source and record its lines
//		               on the report of the object making each call (--trace, plan F6.2)
//		Traceable      true to stack jsonstor-oplog on every data source whether or not this run
//		               traces, so a held session can trace one run and not the next
//		               (SetRunOptions); the filter is stacked when a source opens, which is once

function NewSession( Options )
{
	let options = is_object( Options ) ? Options : {};
	if ( !is_object( options.Document ) ) { throw new SessionError( 'A session needs a jsonx file which is a JSON object.' ); }

	let jsonstor = options.jsonstor || require( '@liquicode/jsonstor' )();
	jsonstor.LoadPlugin( Triggers.NewTriggerFilter() );

	let session = {
		Document: options.Document,
		Path: options.Path || null,
		jsonstor: jsonstor,
		// Whether the run in progress records trace lines.
		Trace: ( options.Trace === true ),
	};

	session.Catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: jsonstor, Require: options.Require } );
	session.Host = Host.NewHost( { MaxSteps: options.MaxSteps, MaxCalls: options.MaxCalls } );


	//---------------------------------------------------------------------
	// The trigger filter's view of the session.

	let trigger_session = {
		ProcessFor: function ( Trigger )
		{
			let item = Names.FindEntry( session.Document, Trigger.Process );
			if ( item === null || item.Section !== 'Objects' || item.Entry.Kind !== 'Process' ) { return null; }
			return item.Entry;
		},
		IsActive: function ( ProcessName )
		{
			return session.Runner.ActiveProcesses.includes( ProcessName );
		},
		RunTriggered: function ( Trigger, Process, Input )
		{
			return session.Runner.RunTriggered( Trigger, Process, Input );
		},
	};


	//---------------------------------------------------------------------
	// The programmatic triggers watching one data source: those whose Process's DataSource it is.

	function triggers_watching( DataSourceName )
	{
		let triggers = Array.isArray( session.Document.Triggers ) ? session.Document.Triggers : [];
		return triggers.filter( function ( Trigger )
		{
			if ( !is_object( Trigger ) || !Array.isArray( Trigger.On ) ) { return false; }
			let process = trigger_session.ProcessFor( Trigger );
			return ( process !== null ) && ( process.DataSource === DataSourceName );
		} );
	}


	session.DataSources = DataSources.NewDataSources( {
		Document: session.Document,
		FilePath: session.Path,
		Binds: options.Binds,
		Sets: options.Sets,
		Cwd: options.Cwd,
		Env: options.Env,
		jsonstor: jsonstor,
		Catalog: session.Catalog,
		InnerFilters: function ( Name )
		{
			let watching = triggers_watching( Name );
			if ( watching.length === 0 ) { return []; }
			return [ {
				FilterName: Triggers.FILTER_NAME,
				Settings: { DataSource: Name, Triggers: watching, Session: trigger_session },
			} ];
		},
		OuterFilters: function ()
		{
			if ( options.Trace !== true && options.Traceable !== true ) { return []; }
			return [ {
				FilterName: TRACE_FILTER,
				Settings: {
					LogTo: record_trace,
					ErrorTo: record_trace,
					// ***No timestamp***: the report already says how long each object took, and a
					// clock in every line makes two runs impossible to compare.
					IncludeTimestamp: false,
					IncludeDuration: true,
					IncludePluginName: true,
					IncludeParameters: true,
				},
			} ];
		},
	} );


	//---------------------------------------------------------------------
	// jsonstor-oplog writes a blank line before each call; the report has its own layout.

	function record_trace( Line )
	{
		if ( !session.Trace ) { return; }
		if ( typeof Line !== 'string' || Line.trim() === '' ) { return; }
		session.Runner.RecordTrace( Line );
		return;
	}

	session.Runner = Runner.NewRunner( {
		Document: session.Document, DataSources: session.DataSources, Host: session.Host, Statistics: ( options.Statistics === true ), Changes: ( options.Changes === true ),
	} );


	//---------------------------------------------------------------------
	// ***What an open data source was opened with***: its definition with the overrides applied, and
	// the programmatic triggers stacked on it. Two equal signatures open the same storage, so a data
	// source whose signature has not changed can stay open - and an in-memory store keep its rows.
	// A Process's own steps are not part of it: the trigger filter reads the Process from the file
	// each time it fires.

	let signatures = {};

	function signature_of( Name )
	{
		return stable_json( { Definition: session.DataSources.Definitions[ Name ] || null, Watching: triggers_watching( Name ) } );
	}

	function all_signatures()
	{
		let next = {};
		let names = Object.keys( session.DataSources.Definitions );
		for ( let index = 0; index < names.length; index++ ) { next[ names[ index ] ] = signature_of( names[ index ] ); }
		return next;
	}

	signatures = all_signatures();


	//---------------------------------------------------------------------
	// Brings the session up to a file which changed: a new document (a reload from disk), or the
	// same one edited in place (an edit a served request made). Every data source whose signature
	// changed, or which the file no longer declares, is flushed and closed, to open again from its
	// new definition on its next use; the others stay open. Answers the names closed or changed.
	//
	// Throws OverrideError, changing nothing, when this session's overrides no longer apply.

	session.Reconcile = async function ( Document )
	{
		let document = is_object( Document ) ? Document : session.Document;
		session.DataSources.Redefine( document );
		session.Document = document;
		session.Runner.Document = document;

		let next = all_signatures();
		let names = Object.keys( signatures ).concat( Object.keys( next ).filter( function ( Name ) { return !Object.prototype.hasOwnProperty.call( signatures, Name ); } ) );
		let changed = names.filter( function ( Name ) { return signatures[ Name ] !== next[ Name ]; } );
		for ( let index = 0; index < changed.length; index++ )
		{
			await session.DataSources.Close( changed[ index ] );
			delete session.Runner.KeyFields[ changed[ index ] ];
		}
		signatures = next;
		return changed;
	};


	//---------------------------------------------------------------------
	// What the next run measures and records: Statistics (--verbose), Trace (--trace) and Changes
	// (--changes). A held session sets them per request; Trace records only on a session built
	// Traceable or with Trace.

	session.SetRunOptions = function ( RunOptions )
	{
		let run_options = is_object( RunOptions ) ? RunOptions : {};
		session.Runner.Statistics = ( run_options.Statistics === true );
		session.Runner.Changes = ( run_options.Changes === true );
		session.Trace = ( run_options.Trace === true );
		return;
	};


	//---------------------------------------------------------------------
	// Runs an object by name. Returns its report.

	session.Run = async function ( Name, Input )
	{
		return await session.Runner.RunObject( Name, Input );
	};


	//---------------------------------------------------------------------
	// Runs a trigger by hand: its Process over its data source (13.3). Returns the report.

	session.RunTrigger = async function ( Name )
	{
		let item = Names.FindEntry( session.Document, Name );
		if ( item === null || item.Section !== 'Triggers' ) { throw new SessionError( 'No trigger is named [' + Name + '].' ); }
		let report = await session.Runner.RunObject( item.Entry.Process );
		report.Trigger = Name;
		return report;
	};


	//---------------------------------------------------------------------
	session.Release = async function ()
	{
		return await session.DataSources.Release();
	};


	return session;
}


//---------------------------------------------------------------------
module.exports = {
	SessionError: SessionError,
	NewSession: NewSession,
};
