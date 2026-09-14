'use strict';

/*
	A Process debugged a step at a time (plan F3.5): one session held open while a person, or a
	script, types commands.

	***One session for the whole debug*** (user, 2026-09-13). Studio's lesson is the reason: a
	debugger which reopens its data sources between steps debugs a jsonstor-memory source against
	empty data. So the command line reads the commands from standard input in one invocation, and
	this component holds the runs between them.

	***A frame is one Process being debugged***: its jsonproc run, and for a Process with a
	DataSource, the documents it runs over and which one it is on. `into` a call naming a Process
	pushes a frame; when a frame finishes, its result answers the call its parent is waiting on.

	***Reports nest exactly as a run's do.*** A frame opens a report on the runner's stack, so the
	objects it calls, the storage calls it makes and the triggers they fire are recorded under it,
	and the report at the end reads as `jsonx run`'s would. The trigger guard holds too: a frame's
	Process is active while its frame is open (spec 13.7).

	The commands, each answering a snapshot:

		step       one step; at a waiting call, service the call - a host function makes its storage
		           call, an object runs whole - and resume
		into       at a call naming a Process, debug that Process in a frame of its own; else step
		continue   run until the next waiting call, the end of this frame, or a limit
		decline    fail the waiting call with StepFailed, and say what it would have done
		answer J   resume the waiting call with the JSON value J
		state      the snapshot again
		skip       leave this document's run, for the next document
		quit       stop

	***jsonproc cannot rewind***, so there is no step back (Studio declined it for the same reason).
*/

const jsonproc = require( '@liquicode/jsonproc' );

const Names = require( '../File/Names.js' );
const Explain = require( '../Explain/Explain.js' );
const Plan = require( './Plan.js' );
const Runner = require( './Runner.js' );


const COMMANDS = [ 'step', 'into', 'continue', 'decline', 'answer', 'state', 'skip', 'quit' ];


//---------------------------------------------------------------------
class DebugError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'DebugError';
	}
}


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
// The step a cursor points at, or null: `[ 1, 'Then', 0 ]`, with a loop's branch as a pair
// `[ 2, [ 'Do', 1 ], 0 ]` (measured 2026-09-13).

function StepAt( Process, Cursor )
{
	if ( !is_object( Process ) || !Array.isArray( Cursor ) || Cursor.length === 0 ) { return null; }

	let steps = Process.Steps;
	let step = null;
	for ( let index = 0; index < Cursor.length; index++ )
	{
		let part = Cursor[ index ];
		if ( typeof part === 'number' )
		{
			if ( !Array.isArray( steps ) || part >= steps.length ) { return null; }
			step = steps[ part ];
			continue;
		}
		if ( !is_object( step ) ) { return null; }
		let operator = Object.keys( step )[ 0 ];
		let field = Array.isArray( part ) ? part[ 0 ] : part;
		steps = is_object( step[ operator ] ) ? step[ operator ][ field ] : null;
	}
	return is_object( step ) ? step : null;
}


//---------------------------------------------------------------------
// Session is an open session; Name names a Process of its file; Input is the starting document of
// a Process with no DataSource.

function NewDebugger( Session, Name, Input )
{
	let item = Names.FindEntry( Session.Document, Name );
	if ( item === null || item.Section !== 'Objects' || item.Entry.Kind !== 'Process' )
	{
		throw new DebugError( ( item === null ? 'No object is named [' + Name + ']' : '[' + Name + '] is not a Process' ) + '; jsonx debug steps a Process.' );
	}

	let runner = Session.Runner;
	let host = Session.Host;

	let debug = {
		Frames: [],
		Finished: false,
		// 'done', 'failed' or 'quit', once Finished.
		Outcome: null,
		// The report of the Process being debugged, which the command line prints at the end.
		Report: null,
	};


	//---------------------------------------------------------------------
	function top()
	{
		return debug.Frames[ debug.Frames.length - 1 ] || null;
	}

	function process_named( ProcessName )
	{
		let found = Names.FindEntry( Session.Document, ProcessName );
		if ( found === null || found.Section !== 'Objects' || found.Entry.Kind !== 'Process' ) { return null; }
		return found.Entry;
	}


	//---------------------------------------------------------------------
	// Opening and closing a frame.

	async function open_frame( Process, Start )
	{
		let frame = {
			Process: Process,
			Report: runner.OpenReport( Process.Name, 'Process' ),
			Run: null,
			Documents: null,
			Index: 0,
			Results: [],
			Inserted: 0,
			Skipped: 0,
			Steps: 0,
			Calls: 0,
		};
		if ( debug.Report === null ) { debug.Report = frame.Report; }
		runner.ActiveProcesses.push( Process.Name );
		debug.Frames.push( frame );

		if ( typeof Process.DataSource !== 'string' )
		{
			frame.Run = jsonproc.Start( Process, is_object( Start ) ? clone( Start ) : {} );
			return await settle( frame );
		}

		let documents = null;
		try
		{
			documents = await runner.CallStorage( Process.DataSource, 'FindMany2', [ is_object( Process.Criteria ) ? Process.Criteria : {}, null, null, null ] );
		}
		catch ( error )
		{
			return await fail_frame( frame, { Code: error.Code || 'RunFailed', Message: error.message } );
		}
		frame.Documents = Array.isArray( documents ) ? documents : [];
		return await start_document( frame );
	}


	async function start_document( Frame )
	{
		if ( Frame.Index >= Frame.Documents.length ) { return await finish_frame( Frame ); }
		Frame.Run = jsonproc.Start( Frame.Process, { Document: Frame.Documents[ Frame.Index ] } );
		Frame.Steps = 0;
		Frame.Calls = 0;
		return await settle( Frame );
	}


	function close_frame( Frame )
	{
		let active = runner.ActiveProcesses.lastIndexOf( Frame.Process.Name );
		if ( active >= 0 ) { runner.ActiveProcesses.splice( active, 1 ); }
		runner.CloseReport( Frame.Report );
		debug.Frames.pop();
		return;
	}


	async function finish_frame( Frame )
	{
		let report = Frame.Report;
		let into = ( typeof Frame.Process.Into === 'string' ) ? Frame.Process.Into : null;

		if ( Frame.Documents === null )
		{
			report.Result = Frame.Results;
			report.Summary = 'ran once' + ( into ? ', into ' + into : '' );
		}
		else
		{
			report.Result = Frame.Results;
			report.Summary = 'ran ' + Frame.Results.length + ( Frame.Skipped > 0 ? ', skipped ' + Frame.Skipped : '' ) + ( into ? ', into ' + into + ' ' + Frame.Inserted : '' );
		}
		close_frame( Frame );
		return await deliver( true, report.Result, Frame.Process.Name );
	}


	async function fail_frame( Frame, Error )
	{
		Frame.Report.Ok = false;
		Frame.Report.Result = undefined;
		Frame.Report.Error = Error;
		close_frame( Frame );
		return await deliver( false, Error, Frame.Process.Name );
	}


	// A finished frame answers the call its parent is waiting on, as a serviced call would (Host.js).
	async function deliver( Ok, Value, ProcessName )
	{
		let parent = top();
		if ( parent === null )
		{
			debug.Finished = true;
			debug.Outcome = Ok ? 'done' : 'failed';
			return;
		}
		if ( Ok ) { parent.Run = jsonproc.Resume( parent.Process, parent.Run, Value ); }
		else { parent.Run = jsonproc.Resume( parent.Process, parent.Run, undefined, { Code: 'StepFailed', Message: 'The object [' + ProcessName + '] failed: ' + Value.Message } ); }
		return await settle( parent );
	}


	//---------------------------------------------------------------------
	// After a frame's run changes: a finished run moves the frame on; a failed one fails it.

	async function settle( Frame )
	{
		let run = Frame.Run;
		if ( run.Status === 'ready' || run.Status === 'waiting' ) { return; }

		if ( run.Status === 'failed' )
		{
			let error = is_object( run.Error ) ? run.Error : {};
			return await fail_frame( Frame, { Code: error.Code || 'ProcessFailed', Message: 'The Process [' + Frame.Process.Name + '] failed: ' + ( error.Message || run.Status ) } );
		}

		let result = run.Result;
		if ( typeof Frame.Process.Into === 'string' && is_object( result ) )
		{
			try
			{
				Frame.Inserted += await runner.InsertInto( Frame.Process.Into, [ result ] );
			}
			catch ( error )
			{
				return await fail_frame( Frame, { Code: error.Code || 'RunFailed', Message: error.message } );
			}
		}

		if ( Frame.Documents === null )
		{
			Frame.Results = result;
			return await finish_frame( Frame );
		}
		Frame.Results.push( result );
		Frame.Index++;
		return await start_document( Frame );
	}


	//---------------------------------------------------------------------
	// Moving a run.

	async function advance( Frame )
	{
		Frame.Steps++;
		if ( Frame.Steps > host.MaxSteps )
		{
			let failed = Object.assign( {}, Frame.Run, { Status: 'failed', Error: { Code: 'StepLimitExceeded', Message: 'The process [' + Frame.Process.Name + '] took more than ' + host.MaxSteps + ' steps.', Cursor: Frame.Run.Cursor } } );
			delete failed.Waiting;
			Frame.Run = failed;
			return await settle( Frame );
		}
		Frame.Run = jsonproc.Step( Frame.Process, Frame.Run );
		return await settle( Frame );
	}


	function over_call_limit( Frame )
	{
		Frame.Calls++;
		if ( Frame.Calls <= host.MaxCalls ) { return false; }
		Frame.Run = jsonproc.Resume( Frame.Process, Frame.Run, undefined, { Code: 'StepLimitExceeded', Message: 'The process [' + Frame.Process.Name + '] made more than ' + host.MaxCalls + ' calls.' } );
		return true;
	}


	async function service( Frame )
	{
		if ( over_call_limit( Frame ) ) { return await settle( Frame ); }

		let waiting = Frame.Run.Waiting;
		try
		{
			let result = await runner.ServiceCall( waiting.Name, waiting.With );
			Frame.Run = jsonproc.Resume( Frame.Process, Frame.Run, result );
		}
		catch ( error )
		{
			Frame.Run = jsonproc.Resume( Frame.Process, Frame.Run, undefined, { Code: 'StepFailed', Message: error.message } );
		}
		return await settle( Frame );
	}


	// What a waiting call would have done, for `decline`.
	function describe_call( Waiting )
	{
		let with_document = is_object( Waiting.With ) ? Waiting.With : {};
		if ( Object.prototype.hasOwnProperty.call( Runner.HOST_PARAMETERS, Waiting.Name ) )
		{
			let parameters = {};
			Runner.HOST_PARAMETERS[ Waiting.Name ].forEach( function ( Parameter )
			{
				parameters[ Parameter ] = ( typeof with_document[ Parameter ] === 'undefined' ) ? null : with_document[ Parameter ];
			} );
			return { Function: Waiting.Name, DataSource: ( typeof with_document.DataSource === 'undefined' ) ? null : with_document.DataSource, Parameters: parameters };
		}

		let plan = Plan.PlanObject( Session.Document, Waiting.Name, { Catalog: Session.Catalog } );
		if ( plan === null ) { return { Name: Waiting.Name }; }
		return { Object: Waiting.Name, Kind: plan.Kind, Would: plan.Tree };
	}


	//---------------------------------------------------------------------
	// The snapshot: where the debug is, and what it would do next.

	debug.Snapshot = function ()
	{
		if ( debug.Finished )
		{
			let finished = { Finished: true, Outcome: debug.Outcome };
			if ( debug.Report && debug.Report.Ok ) { finished.Result = debug.Report.Result; }
			if ( debug.Report && debug.Report.Error ) { finished.Error = debug.Report.Error; }
			return finished;
		}

		let frame = top();
		let run = frame.Run;
		let snapshot = { Depth: debug.Frames.length - 1, Process: frame.Process.Name };
		if ( frame.Documents !== null ) { snapshot.Document = { Index: frame.Index, Of: frame.Documents.length }; }
		snapshot.Status = run.Status;
		snapshot.Cursor = run.Cursor;

		let step = StepAt( frame.Process, run.Cursor );
		if ( step !== null ) { snapshot.Step = Explain.ExplainStep( step, Session.Document ); }
		snapshot.State = run.State;
		if ( is_object( run.Waiting ) ) { snapshot.Waiting = run.Waiting; }
		return snapshot;
	};


	//---------------------------------------------------------------------
	// Starts the debug: opens the Process's frame. Answers the first snapshot.

	debug.Start = async function ()
	{
		await open_frame( item.Entry, Input );
		return debug.Snapshot();
	};


	//---------------------------------------------------------------------
	// One command line. Answers the snapshot after it, with Command, and Declined or Error when
	// there is one to say.

	debug.Command = async function ( Line )
	{
		let text = String( Line ).trim();
		let space = text.search( /\s/ );
		let verb = ( space < 0 ) ? text : text.slice( 0, space );
		let rest = ( space < 0 ) ? '' : text.slice( space ).trim();
		let extra = { Command: verb };

		function answer( More )
		{
			return Object.assign( extra, More || {}, debug.Snapshot() );
		}

		if ( debug.Finished ) { return answer( { Error: 'The debug is over.' } ); }
		if ( !COMMANDS.includes( verb ) ) { return answer( { Error: 'Unknown command [' + verb + ']. The commands are ' + COMMANDS.join( ', ' ) + '.' } ); }

		let frame = top();
		let waiting = ( frame.Run.Status === 'waiting' );

		if ( verb === 'state' ) { return answer(); }

		if ( verb === 'quit' )
		{
			while ( debug.Frames.length > 0 )
			{
				let open = top();
				open.Report.Ok = false;
				open.Report.Result = undefined;
				open.Report.Error = { Code: 'Quit', Message: 'Stopped by the debugger before the Process [' + open.Process.Name + '] finished.' };
				close_frame( open );
			}
			debug.Finished = true;
			debug.Outcome = 'quit';
			return answer();
		}

		if ( verb === 'step' )
		{
			if ( waiting ) { await service( frame ); }
			else { await advance( frame ); }
			return answer();
		}

		if ( verb === 'into' )
		{
			let callee = waiting ? process_named( frame.Run.Waiting.Name ) : null;
			let has_with = waiting && is_object( frame.Run.Waiting.With ) && Object.keys( frame.Run.Waiting.With ).length > 0;
			if ( callee === null || has_with )
			{
				// Nothing to step into: a host function, a non-Process object, or a call the runner refuses.
				if ( waiting ) { await service( frame ); }
				else { await advance( frame ); }
				return answer();
			}
			if ( over_call_limit( frame ) )
			{
				await settle( frame );
				return answer();
			}
			// A called Process starts from {} (spec 12.5).
			await open_frame( callee, {} );
			return answer();
		}

		if ( verb === 'continue' )
		{
			let depth = debug.Frames.length;
			let first = true;
			while ( !debug.Finished && debug.Frames.length >= depth )
			{
				let current = top();
				if ( debug.Frames.length > depth ) { break; }
				if ( current.Run.Status === 'waiting' )
				{
					if ( !first ) { break; }
					await service( current );
				}
				else
				{
					await advance( current );
				}
				first = false;
			}
			return answer();
		}

		if ( verb === 'decline' )
		{
			if ( !waiting ) { return answer( { Error: 'Nothing is waiting: decline answers a waiting call.' } ); }
			let declined = describe_call( frame.Run.Waiting );
			if ( !over_call_limit( frame ) )
			{
				frame.Run = jsonproc.Resume( frame.Process, frame.Run, undefined, { Code: 'StepFailed', Message: 'Declined by the debugger: [' + frame.Run.Waiting.Name + '] was not run.' } );
			}
			await settle( frame );
			return answer( { Declined: declined } );
		}

		if ( verb === 'answer' )
		{
			if ( !waiting ) { return answer( { Error: 'Nothing is waiting: answer resumes a waiting call.' } ); }
			if ( rest === '' ) { return answer( { Error: 'answer takes a JSON value: answer {"Count":3}.' } ); }
			let value = null;
			try { value = JSON.parse( rest ); }
			catch ( error ) { return answer( { Error: 'answer takes a JSON value, and this is not one: ' + error.message } ); }
			if ( !over_call_limit( frame ) ) { frame.Run = jsonproc.Resume( frame.Process, frame.Run, value ); }
			await settle( frame );
			return answer();
		}

		if ( verb === 'skip' )
		{
			if ( frame.Documents === null ) { return answer( { Error: 'skip moves to the next document, and the Process [' + frame.Process.Name + '] has no DataSource.' } ); }
			frame.Skipped++;
			frame.Index++;
			await start_document( frame );
			return answer();
		}

		return answer();
	};


	return debug;
}


//---------------------------------------------------------------------
module.exports = {
	COMMANDS: COMMANDS,
	DebugError: DebugError,
	StepAt: StepAt,
	NewDebugger: NewDebugger,
};
