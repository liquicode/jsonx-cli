'use strict';

/*
	A held session: one jsonx file, one session, held for as long as a served mode runs (plan F2.4,
	cut 3). The Web API and MCP answer every request through it, so an outside client's write goes
	through the same data sources, and fires the same triggers, as a run typed at the command line.

	***A request is an invocation document*** - the `--input-json` shape, `{ Command, name, ... }` -
	parsed with the command line's own ParseDocument, handed to the command's own handler, and
	answered as the envelope (src/Envelope.js). No handler knows it is being served.

	***One thing at a time touches the session.*** The runner keeps one report stack and one list of
	running Processes, which the trigger guard reads, so two overlapping runs would nest each other's
	reports and block triggers they should fire. Every command waits its turn in one queue, except a
	command which declares `Concurrent: true` on its node or a group above it: one which opens no data
	source and writes no file.

	***What every client shares cannot be changed by one of them.*** `--file`, `--bind` and `--set`
	are given when the session is held, and a request naming them is refused; so are `--quiet` and
	an `--output` other than json, because the envelope is the output. `--verbose` and `--trace` are
	per request: the session is built Traceable and switched for each run.

	A command whose node, or a group above it, declares `Served: false` is refused, with its
	`ServedReason`.
*/

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Reader = require( '../File/Reader.js' );
const Validate = require( '../Validate/Validate.js' );
const Overrides = require( './Overrides.js' );
const Session = require( './Session.js' );
const Parser = require( '../CommandLine/Parser.js' );
const InputJson = require( '../CommandLine/InputJson.js' );
const Help = require( '../CommandLine/Help.js' );
const Envelope = require( '../Envelope.js' );


// Options a request cannot give: they are the held session's, or the envelope's.
const REFUSED_OPTIONS = {
	'file': 'the file is chosen when the session is held',
	'bind': 'data source overrides are given when the session is held',
	'set': 'data source overrides are given when the session is held',
	'quiet': 'a served answer always carries its whole report',
};


//---------------------------------------------------------------------
class HeldError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'HeldError';
	}
}


//---------------------------------------------------------------------
// Options:
//		Tree           the command tree (commands/jsonx.js)
//		File           the jsonx file, as --file would name it; absent, JSONX_FILE then the lone .jsonx
//		Binds, Sets    override tokens, as --bind and --set
//		Io             the process's Io: Env, Cwd, ReadFile, and WriteFile when files are written elsewhere
//		jsonstor, Require, MaxSteps, MaxCalls   passed to the session
//
// Throws HeldError when there is nothing to hold: no file, an unreadable one, one which is not a
// JSON object, or an override which does not parse. A file with validation errors is held, and its
// findings are in StartFindings: every run answers exit 3 until it is repaired.

function NewHeld( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	if ( !options.Tree ) { throw new HeldError( 'A held session needs the command tree.' ); }
	let io = options.Io || Parser.DefaultIo();

	let resolved = null;
	let text = null;
	try
	{
		resolved = Reader.ResolvePath( options.File, io.Env, io.Cwd, io );
		text = Reader.ReadText( resolved.Path, io );
	}
	catch ( error )
	{
		if ( !( error instanceof Reader.FileError ) ) { throw error; }
		throw new HeldError( error.message );
	}

	let read = Reader.ParseText( text );
	if ( read.Document === null || typeof read.Document !== 'object' || Array.isArray( read.Document ) )
	{
		let messages = read.Findings.map( function ( Finding ) { return Finding.Message; } );
		throw new HeldError( resolved.Path + ' cannot be held: it is not a jsonx file. ' + messages.join( ' ' ) );
	}

	let session = null;
	try
	{
		session = Session.NewSession( {
			Document: read.Document,
			Path: resolved.Path,
			Binds: options.Binds,
			Sets: options.Sets,
			Env: io.Env,
			Cwd: io.Cwd,
			Traceable: true,
			jsonstor: options.jsonstor,
			Require: options.Require,
			MaxSteps: options.MaxSteps,
			MaxCalls: options.MaxCalls,
		} );
	}
	catch ( error )
	{
		if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
		throw new HeldError( error.message );
	}

	let held = {
		Tree: options.Tree,
		Io: io,
		Path: resolved.Path,
		Session: session,
		Binds: options.Binds,
		Sets: options.Sets,
		StartFindings: [],
	};

	held.StartFindings = Validate.ValidateFile( session.Document, {
		jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: session.Catalog.ValidateSettings,
	} );


	//---------------------------------------------------------------------
	// The queue. Work runs after everything queued before it, whether that succeeded or not.

	let tail = Promise.resolve();

	held.Exclusive = function ( Work )
	{
		let run = tail.then( function () { return Work(); } );
		tail = run.then( function () { return; }, function () { return; } );
		return run;
	};


	//---------------------------------------------------------------------
	// The session as a handler borrows it: the same session, whose Release flushes what the request
	// wrote and keeps every data source open, so an in-memory store keeps its rows.

	held.Lease = function ()
	{
		let lease = Object.create( session );
		lease.Release = async function () { return await session.DataSources.Flush(); };
		return lease;
	};


	//---------------------------------------------------------------------
	// One request. Returns the envelope; never throws.

	held.Invoke = async function ( Invocation )
	{
		let out = Envelope.NewOut();

		let parsed = null;
		let nodes = null;
		try
		{
			parsed = InputJson.ParseDocument( held.Tree, Invocation );
			nodes = Parser.NodesOnPath( held.Tree, parsed.Path );
		}
		catch ( error )
		{
			if ( !( error instanceof Parser.UsageError ) ) { throw error; }
			out.Log( error.message + '\n' );
			return out.Envelope( 2 );
		}

		if ( parsed.Help )
		{
			out.Text( Help.HelpText( held.Tree, parsed.Path ) );
			return out.Envelope( 0 );
		}

		let command = parsed.Path.join( ' ' );
		let node = nodes[ nodes.length - 1 ];
		if ( typeof node.Handler !== 'function' )
		{
			out.Log( '[' + ( command || held.Tree.Command ) + '] is a group of commands; name one of them.\n' );
			return out.Envelope( 2 );
		}

		let unserved = nodes.filter( function ( Node ) { return Node.Served === false; } );
		if ( unserved.length > 0 )
		{
			let reason = unserved[ 0 ].ServedReason ? ': ' + unserved[ 0 ].ServedReason : '';
			out.Log( '[' + command + '] is not served' + reason + '.\n' );
			return out.Envelope( 2 );
		}

		let refused = Object.keys( REFUSED_OPTIONS ).filter( function ( Name ) { return parsed.Given[ Name ] === true; } );
		if ( refused.length > 0 )
		{
			out.Log( 'Option [--' + refused[ 0 ] + '] cannot be given to a served command: ' + REFUSED_OPTIONS[ refused[ 0 ] ] + '.\n' );
			return out.Envelope( 2 );
		}
		if ( parsed.Given.output === true && parsed.Options.output !== 'json' )
		{
			out.Log( 'Option [--output] cannot be [' + parsed.Options.output + '] for a served command: the answer is the envelope, in JSON.\n' );
			return out.Envelope( 2 );
		}

		let context = { Tree: held.Tree, Io: io, Parser: Parser, Out: out, Held: held };
		let handle = async function ()
		{
			try
			{
				return await node.Handler( parsed, context );
			}
			catch ( error )
			{
				out.Log( 'The command failed unexpectedly: ' + ( error && error.message ? error.message : String( error ) ) + '\n' );
				return 1;
			}
		};

		let concurrent = nodes.some( function ( Node ) { return Node.Concurrent === true; } );
		let code = concurrent ? await handle() : await held.Exclusive( handle );
		return out.Envelope( code );
	};


	//---------------------------------------------------------------------
	// The end of serving: waits for the queue, then flushes and releases every data source.

	held.Release = async function ()
	{
		return await held.Exclusive( function () { return session.Release(); } );
	};


	return held;
}


//---------------------------------------------------------------------
module.exports = {
	REFUSED_OPTIONS: REFUSED_OPTIONS,
	HeldError: HeldError,
	NewHeld: NewHeld,
};
