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

	***When the file changes, the session follows it*** (plan F2.5, O6):
	-	A request which edits the file edits the held document, and when it finishes the session
		reconciles: every data source whose definition, or whose watching triggers, changed is closed
		and opens again from the new definition on its next use. The others stay open.
	-	A change on disk (Watch) is read and reconciled the same way, ***in the queue***, so a run in
		flight finishes on the copy it started with.
	-	***Text the session wrote itself is not a change***: an edit's own write arrives at the watcher
		too, and is recognised by being exactly the last text written.
	-	A file which no longer parses, or which an override no longer fits, keeps the old copy, and the
		reason is logged.

	***What a served mode pushes*** (cut 4, the WebSocket):
	-	A request's own progress, while it runs, to the Listen function given with it: each report line,
		each finding, and each run report as it opens and closes. ***A queued request listens only once
		its turn starts***, so it never hears the reports of the request before it.
	-	What belongs to the file, to every OnEvent listener: `reload` when the file on disk was read
		(followed or kept), `document` when the held document changed - by a reload, or by a request
		which wrote the file - and `queue` when a conversation (a served debug) starts holding the
		queue, `HeldBy` its command, and when it stops, `HeldBy` null.

	***What the session serves is its profile*** (cut 7, decision 14): a built-in name or a `.json` file
	(src/Session/Profiles.js), given when the session is held and switched by SetProfile. ***It is
	enforced here, once, for every surface***: a request for a command the profile does not serve, or
	giving an option it withholds, is refused with exit 2; a value it defaults is put into the request
	when none was given. A switch tells every OnEvent listener `profile`, with the summary a surface
	shows, and the next request is judged under the new profile; one already running finishes under
	the profile it started in.
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Reader = require( '../File/Reader.js' );
const Validate = require( '../Validate/Validate.js' );
const Overrides = require( './Overrides.js' );
const Session = require( './Session.js' );
const Profiles = require( './Profiles.js' );
const Parser = require( '../CommandLine/Parser.js' );
const InputJson = require( '../CommandLine/InputJson.js' );
const Help = require( '../CommandLine/Help.js' );
const Envelope = require( '../Envelope.js' );
const Report = require( '../Report.js' );


// How long the watcher waits for a burst of file events to end before reading the file.
const RELOAD_DEBOUNCE_MS = 200;

// The held document's addresses, as MCP's resources and the WebSocket's Read name them.
const FILE_URI = 'jsonx://file';
const ENTRY_URI = 'jsonx://entry/';

// Options a request cannot give: they are the held session's, or the envelope's.
const REFUSED_OPTIONS = {
	'file': 'the file is chosen when the session is held',
	'bind': 'data source overrides are given when the session is held',
	'set': 'data source overrides are given when the session is held',
	'quiet': 'a served answer always carries its whole report',
};


//---------------------------------------------------------------------
// ExitCode is what the command line answers for it: 2 no file chosen or an override which does not
// parse, 1 an unreadable file, 3 a file which is not a jsonx file.
class HeldError extends Error
{
	constructor( Message, ExitCode )
	{
		super( Message );
		this.name = 'HeldError';
		this.ExitCode = ( typeof ExitCode === 'number' ) ? ExitCode : 1;
	}
}


//---------------------------------------------------------------------
// The commands a held session answers, as data, for the modes to route and list: every command
// with a handler which neither it nor a group above it marks `Served: false`.
//
//		{ Path: [ 'datasource', 'find' ], Command: 'datasource find', Describe, Concurrent,
//		  Positionals: [ ... ], Options: { name: declaration } }
//
// Options are those in force at the command, less what a request cannot give (REFUSED_OPTIONS),
// --output (a served answer is always the JSON envelope), --input-json (the request is the
// document) and --help. Hidden commands are served when they are not marked otherwise.

const NOT_REQUEST_OPTIONS = [ 'output', 'input-json', 'help' ];

function ServedCommands( Tree )
{
	let commands = [];

	function visit( Node, Path, Unserved, Concurrent )
	{
		let unserved = Unserved || ( Node.Served === false );
		let concurrent = Concurrent || ( Node.Concurrent === true );
		if ( typeof Node.Handler === 'function' && Path.length > 0 && !unserved )
		{
			let options = {};
			let in_force = Parser.OptionsAt( Tree, Path );
			let names = Object.keys( in_force );
			for ( let index = 0; index < names.length; index++ )
			{
				let name = names[ index ];
				if ( Object.prototype.hasOwnProperty.call( REFUSED_OPTIONS, name ) || NOT_REQUEST_OPTIONS.includes( name ) ) { continue; }
				options[ name ] = in_force[ name ];
			}
			commands.push( {
				Path: Path.slice(),
				Command: Path.join( ' ' ),
				Describe: Node.Describe || '',
				Concurrent: concurrent,
				Positionals: Array.isArray( Node.Positionals ) ? Node.Positionals.slice() : [],
				Options: options,
			} );
		}
		let children = Array.isArray( Node.Commands ) ? Node.Commands : [];
		for ( let index = 0; index < children.length; index++ )
		{
			visit( children[ index ], Path.concat( [ children[ index ].Command ] ), unserved, concurrent );
		}
		return;
	}

	visit( Tree, [], false, false );
	return commands;
}


//---------------------------------------------------------------------
// Options:
//		Tree           the command tree (commands/jsonx.js)
//		File           the jsonx file, as --file would name it; absent, JSONX_FILE then the lone .jsonx
//		Binds, Sets    override tokens, as --bind and --set
//		Io             the process's Io: Env, Cwd, ReadFile, and WriteFile when files are written elsewhere
//		Log            function ( Text ): where a reload, and what it found, is reported
//		OnReload       function ( Outcome ): called with Reload's answer after each watched reload
//		jsonstor, Require, MaxSteps, MaxCalls   passed to the session
//		Profile        a built-in profile name or a .json file (src/Session/Profiles.js); absent means full
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
		throw new HeldError( error.message, error.IsUsage ? 2 : 1 );
	}

	let read = Reader.ParseText( text );
	if ( read.Document === null || typeof read.Document !== 'object' || Array.isArray( read.Document ) )
	{
		let messages = read.Findings.map( function ( Finding ) { return Finding.Message; } );
		throw new HeldError( resolved.Path + ' cannot be held: it is not a jsonx file. ' + messages.join( ' ' ), 3 );
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
		throw new HeldError( error.message, 2 );
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

	held.StartFindings = validate_held();

	let log = ( typeof options.Log === 'function' ) ? options.Log : function () { return; };


	//---------------------------------------------------------------------
	// The profile in force (cut 7): loaded and checked here, so a bad one is refused where it was named,
	// as a bad override is. `served` is the command list the surfaces show, `profile` what request judges
	// by. Both are replaced whole on a switch, so a request in flight keeps the pair it started with.

	let profile = null;
	let served = null;

	function set_profile( NameOrPath )
	{
		let commands = ServedCommands( held.Tree );
		let checked = Profiles.Check( Profiles.Load( NameOrPath, io ), commands );
		profile = checked;
		served = Profiles.Apply( commands, checked );
		held.Profile = checked;
		return;
	}

	try
	{
		set_profile( ( typeof options.Profile === 'string' ) ? options.Profile : Profiles.DEFAULT_SERVE );
	}
	catch ( error )
	{
		if ( !( error instanceof Profiles.ProfileError ) ) { throw error; }
		throw new HeldError( error.message, 2 );
	}

	// The commands served under the profile, as the surfaces list them (Profiles.Apply).
	held.Served = function ()
	{
		return served.slice();
	};

	// What a surface tells a client about the profile in force.
	held.ProfileSummary = function ()
	{
		return Profiles.Summary( profile, served );
	};

	// Switches the profile, tells every listener, and answers the summary. Throws ProfileError, and the
	// profile in force is unchanged then.
	held.SetProfile = function ( NameOrPath )
	{
		set_profile( NameOrPath );
		let summary = held.ProfileSummary();
		tell_event( { Event: 'profile', Profile: summary } );
		return summary;
	};

	// The file's text as the session last read or wrote it.
	let last_text = text;

	function validate_held()
	{
		return Validate.ValidateFile( session.Document, {
			jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: session.Catalog.ValidateSettings,
		} );
	}


	//---------------------------------------------------------------------
	// The Io a served handler writes the file through: the text it writes is remembered, so the
	// watcher knows the session's own write when it arrives. Written as Writer writes, to a temporary
	// file renamed over the old one.

	let handler_io = Object.create( io );
	handler_io.WriteFile = function ( Path, Text )
	{
		if ( LIB_PATH.resolve( Path ) === LIB_PATH.resolve( held.Path ) ) { last_text = Text; }
		if ( typeof io.WriteFile === 'function' ) { return io.WriteFile( Path, Text ); }
		let temporary = Path + '.~writing';
		LIB_FS.writeFileSync( temporary, Text, 'utf8' );
		LIB_FS.renameSync( temporary, Path );
		return;
	};


	//---------------------------------------------------------------------
	// After a request which may have edited the document: closes what changed. Answers a report line,
	// or '' when nothing changed.

	async function reconcile_edit()
	{
		let changed = null;
		try
		{
			changed = await session.Reconcile( session.Document );
		}
		catch ( error )
		{
			if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
			return 'The file changed, but this session\'s overrides no longer fit it: ' + error.message + ' Its data sources keep their earlier definitions.\n';
		}
		if ( changed.length === 0 ) { return ''; }
		return 'Changed data sources, opened again on their next use: ' + changed.join( ', ' ) + '.\n';
	}


	//---------------------------------------------------------------------
	// The held document, or one entry of it, by address: `jsonx://file`, or `jsonx://entry/<name>` with
	// the name URI-encoded. Answers { Found: true, Value } - as written, so an environment reference is
	// never resolved (F6.4) - or { Found: false }. Reads nothing from disk and waits for nothing.

	held.ReadResource = function ( Uri )
	{
		let document = session.Document;
		if ( Uri === FILE_URI ) { return { Found: true, Value: document }; }
		if ( typeof Uri !== 'string' || !Uri.startsWith( ENTRY_URI ) ) { return { Found: false }; }
		let name = null;
		try { name = decodeURIComponent( Uri.slice( ENTRY_URI.length ) ); }
		catch ( error ) { return { Found: false }; }
		let sections = [ 'DataSources', 'Objects', 'Triggers' ];
		for ( let section = 0; section < sections.length; section++ )
		{
			let entries = Array.isArray( document[ sections[ section ] ] ) ? document[ sections[ section ] ] : [];
			let entry = entries.find( function ( Entry ) { return Entry && typeof Entry === 'object' && Entry.Name === name; } );
			if ( entry ) { return { Found: true, Value: entry }; }
		}
		return { Found: false };
	};


	//---------------------------------------------------------------------
	// Listeners for what belongs to the file. Each is told, never asked: what it throws is ignored.

	let event_listeners = [];

	held.OnEvent = function ( Listener )
	{
		event_listeners.push( Listener );
		return function ()
		{
			let index = event_listeners.indexOf( Listener );
			if ( index >= 0 ) { event_listeners.splice( index, 1 ); }
			return;
		};
	};

	function tell_event( Event )
	{
		let listeners = event_listeners.slice();
		for ( let index = 0; index < listeners.length; index++ )
		{
			try { listeners[ index ]( Event ); }
			catch ( error ) { /* a listener is told, never asked */ }
		}
		return;
	}


	//---------------------------------------------------------------------
	// A run report as a served mode pushes it: what a person watching needs, without the result, which
	// the answer carries, or the nested calls, which arrive as reports of their own.

	function report_event( Phase, Report, Depth )
	{
		let event = { Phase: Phase, Name: Report.Name, Kind: Report.Kind, Depth: Depth };
		if ( typeof Report.Trigger === 'string' ) { event.Trigger = Report.Trigger; }
		if ( Phase === 'close' )
		{
			event.Ok = Report.Ok;
			event.Summary = Report.Summary;
			event.Ms = Report.Ms;
			if ( Report.Error ) { event.Error = Report.Error; }
		}
		return event;
	}


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
	//
	// Listen, when given, is told the request's progress as it runs: { Log: line }, { Finding } and
	// { Report: { Phase, Name, Kind, Depth, Trigger?, Ok?, Summary?, Ms?, Error? } }. Everything it
	// is told is in the envelope as well.

	held.Invoke = function ( Invocation, Listen )
	{
		return request( Invocation, Listen, null );
	};


	//---------------------------------------------------------------------
	// A conversation: a command which reads its input a line at a time (cut 4, decision 3 - jsonx
	// debug), served to a client which can keep talking, the WebSocket.
	//
	// ***The command's own handler runs it***, as for any request: its Io.Lines is fed by Send, and
	// each JSON Lines record it writes is told to Listen as { Line }. So validation, refusals, the
	// records, the report and the exit code are the command's own. Only a node which declares
	// `Conversational: true` may be conversed with; Invoke still refuses it when it is Served: false.
	//
	// ***A conversation holds the queue until it ends***, like any queued command: every other queued
	// request waits, and `queue` events tell every listener when one starts and ends.
	//
	// Answers:
	//		Send( Line )   Promise of { Ok: true, Record }: the record the command wrote for that line;
	//		               or { Ok: false, Message } for a blank line, or once the conversation is over
	//		End()          ends its input, which a command reads as the end (debug quits)
	//		Done           Promise of the envelope, when the command has finished
	//		Over           true once it has

	let conversations = new Set();

	held.Converse = function ( Invocation, Listen )
	{
		let listen = ( typeof Listen === 'function' ) ? Listen : function () { return; };

		let inbox = [];
		let input_ended = false;
		let wake = null;
		let pending = [];
		let records = 0;

		let conversation = { Over: false };

		function rouse()
		{
			if ( wake ) { let resolve = wake; wake = null; resolve(); }
			return;
		}

		let lines = {};
		lines[ Symbol.asyncIterator ] = function ()
		{
			return {
				next: async function ()
				{
					while ( inbox.length === 0 && !input_ended ) { await new Promise( function ( Resolve ) { wake = Resolve; } ); }
					if ( inbox.length > 0 ) { return { value: inbox.shift(), done: false }; }
					return { value: undefined, done: true };
				},
				return: async function () { return { value: undefined, done: true }; },
			};
		};

		conversation.Send = function ( Line )
		{
			if ( conversation.Over || input_ended ) { return Promise.resolve( { Ok: false, Message: 'The conversation is over.' } ); }
			if ( String( Line ).trim() === '' ) { return Promise.resolve( { Ok: false, Message: 'A line must say something.' } ); }
			return new Promise( function ( Resolve )
			{
				pending.push( Resolve );
				inbox.push( String( Line ) );
				rouse();
			} );
		};

		conversation.End = function ()
		{
			input_ended = true;
			rouse();
			return;
		};

		conversations.add( conversation );

		conversation.Done = request( Invocation, listen, {
			Lines: function () { return lines; },
			// The first record is the command's start; each after it answers the oldest line sent.
			OnLine: function ( Record )
			{
				records++;
				if ( records === 1 ) { tell_event( { Event: 'queue', HeldBy: parsed_command( Invocation ) } ); }
				else if ( pending.length > 0 ) { pending.shift()( { Ok: true, Record: Record } ); }
				return;
			},
		} ).then( function ( Envelope_ )
		{
			conversation.Over = true;
			conversations.delete( conversation );
			if ( records > 0 ) { tell_event( { Event: 'queue', HeldBy: null } ); }
			while ( pending.length > 0 ) { pending.shift()( { Ok: false, Message: 'The conversation ended before answering.' } ); }
			return Envelope_;
		} );

		return conversation;
	};

	function parsed_command( Invocation )
	{
		let command = ( Invocation && typeof Invocation === 'object' ) ? Invocation.Command : null;
		return Array.isArray( command ) ? command.join( ' ' ) : String( command );
	}


	//---------------------------------------------------------------------
	// A request or a conversation (Conversation is null for a request).

	async function request( Invocation, Listen, Conversation )
	{
		let listen = ( typeof Listen === 'function' ) ? Listen : null;
		let sinks = {};
		if ( listen )
		{
			sinks.OnLog = function ( Line ) { listen( { Log: Line } ); };
			sinks.OnFinding = function ( Finding ) { listen( { Finding: Finding } ); };
		}
		if ( Conversation )
		{
			sinks.OnLine = function ( Record )
			{
				if ( listen ) { listen( { Line: Record } ); }
				Conversation.OnLine( Record );
			};
		}
		let out = Envelope.NewOut( sinks );

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

		if ( Conversation )
		{
			if ( node.Conversational !== true )
			{
				out.Log( '[' + command + '] is not a conversation: send it as a request.\n' );
				return out.Envelope( 2 );
			}
		}
		else
		{
			let unserved = nodes.filter( function ( Node ) { return Node.Served === false; } );
			if ( unserved.length > 0 )
			{
				let reason = unserved[ 0 ].ServedReason ? ': ' + unserved[ 0 ].ServedReason : '';
				out.Log( '[' + command + '] is not served' + reason + '.\n' );
				return out.Envelope( 2 );
			}
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

		// The profile (cut 7): a command it does not serve, or an option it withholds, is refused; a value
		// it defaults is put into the request when none was given, and the request is parsed again with it.
		let in_force = profile;
		let in_profile = served.find( function ( Each ) { return Each.Command === command; } );
		if ( !in_profile )
		{
			// A conversation (debug) is not a served command, so it is not on any profile's list: the full
			// profile lets it through, and a profile which names its commands serves only those.
			if ( !( in_force.Everything && Conversation ) )
			{
				out.Log( '[' + command + '] is not served in profile [' + in_force.Name + '].\n' );
				return out.Envelope( 2 );
			}
			in_profile = { Defaults: {} };
		}
		let withheld = ( in_force.Without[ command ] || [] ).filter( function ( Name ) { return parsed.Given[ Name ] === true; } );
		if ( withheld.length > 0 )
		{
			out.Log( 'Option [--' + withheld[ 0 ] + '] is not served in profile [' + in_force.Name + '].\n' );
			return out.Envelope( 2 );
		}
		let defaulted = Object.keys( in_profile.Defaults ).filter( function ( Name ) { return parsed.Given[ Name ] !== true; } );
		if ( defaulted.length > 0 )
		{
			let filled = Object.assign( {}, Invocation );
			for ( let index = 0; index < defaulted.length; index++ ) { filled[ defaulted[ index ] ] = in_profile.Defaults[ defaulted[ index ] ]; }
			try
			{
				parsed = InputJson.ParseDocument( held.Tree, filled );
			}
			catch ( error )
			{
				if ( !( error instanceof Parser.UsageError ) ) { throw error; }
				out.Log( 'The profile [' + in_force.Name + '] defaults [' + command + '] to a value it refuses: ' + error.message + '\n' );
				return out.Envelope( 2 );
			}
		}

		let io_for_handler = handler_io;
		if ( Conversation )
		{
			io_for_handler = Object.create( handler_io );
			io_for_handler.Lines = Conversation.Lines;
		}
		let context = { Tree: held.Tree, Io: io_for_handler, Parser: Parser, Out: out, Held: held };
		let concurrent = nodes.some( function ( Node ) { return Node.Concurrent === true; } );

		let handle = async function ()
		{
			// Subscribed only now, when this request's turn has come (the header).
			let stop_listening = null;
			if ( listen && !concurrent )
			{
				stop_listening = session.Runner.OnReport( function ( Phase, Report, Depth )
				{
					listen( { Report: report_event( Phase, Report, Depth ) } );
				} );
			}
			let text_before = last_text;

			let code = 1;
			try
			{
				code = await node.Handler( parsed, context );
			}
			catch ( error )
			{
				out.Log( 'The command failed unexpectedly: ' + ( error && error.message ? error.message : String( error ) ) + '\n' );
				code = 1;
			}
			finally
			{
				if ( stop_listening ) { stop_listening(); }
			}
			// A queued command may have edited the file; a concurrent one writes nothing.
			if ( !concurrent )
			{
				let line = await reconcile_edit();
				if ( line !== '' ) { out.Log( line ); }
				if ( last_text !== text_before ) { tell_event( { Event: 'document' } ); }
			}
			return code;
		};

		let code = concurrent ? await handle() : await held.Exclusive( handle );
		return out.Envelope( code );
	}


	//---------------------------------------------------------------------
	// Reads the file from disk and follows it, in the queue. Answers what happened:
	//
	//		{ Reloaded: false, Reason: 'unchanged' }       the text is what the session last read or wrote
	//		{ Reloaded: false, Reason: 'kept', Message, Findings }   it could not be followed; the old copy stays
	//		{ Reloaded: true, Changed: [ names ], Findings }

	// Every listener hears a reload which read something new, followed or kept, and a followed one
	// changes the document too. A read of the session's own text is not a reload and tells nobody.
	held.Reload = async function ()
	{
		let outcome = await reload_in_queue();
		if ( outcome.Reason !== 'unchanged' ) { tell_event( { Event: 'reload', Outcome: outcome } ); }
		if ( outcome.Reloaded === true ) { tell_event( { Event: 'document' } ); }
		return outcome;
	};

	function reload_in_queue()
	{
		return held.Exclusive( async function ()
		{
			let text_now = null;
			try
			{
				text_now = Reader.ReadText( held.Path, io );
			}
			catch ( error )
			{
				if ( !( error instanceof Reader.FileError ) ) { throw error; }
				log( 'Not reloaded: ' + error.message + ' The session keeps the file as it was.\n' );
				return { Reloaded: false, Reason: 'kept', Message: error.message, Findings: [] };
			}
			if ( text_now === last_text ) { return { Reloaded: false, Reason: 'unchanged' }; }

			let read = Reader.ParseText( text_now );
			if ( read.Document === null || typeof read.Document !== 'object' || Array.isArray( read.Document ) )
			{
				let findings = read.Findings.length > 0 ? read.Findings : Validate.ValidateFile( read.Document, {} );
				let message = held.Path + ' changed and cannot be read as a jsonx file; the session keeps the file as it was.';
				for ( let index = 0; index < findings.length; index++ ) { log( Report.FormatFinding( findings[ index ] ) ); }
				log( 'Not reloaded: ' + message + '\n' );
				return { Reloaded: false, Reason: 'kept', Message: message, Findings: findings };
			}

			let changed = null;
			try
			{
				changed = await session.Reconcile( read.Document );
			}
			catch ( error )
			{
				if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
				log( 'Not reloaded: ' + error.message + ' The session keeps the file as it was.\n' );
				return { Reloaded: false, Reason: 'kept', Message: error.message, Findings: [] };
			}
			last_text = text_now;

			let findings = validate_held();
			let summary = Validate.Summarize( findings );
			for ( let index = 0; index < findings.length; index++ )
			{
				if ( findings[ index ].Severity === 'error' ) { log( Report.FormatFinding( findings[ index ] ) ); }
			}
			let reopened = ( changed.length > 0 ) ? '; opened again on next use: ' + changed.join( ', ' ) : '';
			log( 'Reloaded ' + Report.FormatSummary( held.Path, summary ).trim() + reopened + '.\n' );
			return { Reloaded: true, Changed: changed, Findings: findings };
		} );
	}


	//---------------------------------------------------------------------
	// Watches the file, reloading when it changes. The folder is watched rather than the file,
	// because an editor - and Writer - replaces a file instead of writing into it, which a watch on
	// the file itself stops seeing.

	let watcher = null;
	let reload_timer = null;

	held.Watch = function ()
	{
		if ( watcher !== null ) { return; }
		let name = LIB_PATH.basename( held.Path );
		watcher = LIB_FS.watch( LIB_PATH.dirname( held.Path ), function ( Event, Filename )
		{
			if ( Filename && String( Filename ) !== name ) { return; }
			if ( reload_timer !== null ) { clearTimeout( reload_timer ); }
			reload_timer = setTimeout( function ()
			{
				reload_timer = null;
				held.Reload().then( function ( Outcome )
				{
					if ( typeof options.OnReload === 'function' ) { options.OnReload( Outcome ); }
				}, function ( error )
				{
					log( 'Not reloaded: ' + error.message + '\n' );
				} );
			}, RELOAD_DEBOUNCE_MS );
		} );
		watcher.on( 'error', function ( error ) { log( 'The file is no longer watched: ' + error.message + '\n' ); } );
		return;
	};


	//---------------------------------------------------------------------
	// The end of serving: stops watching, waits for the queue, then flushes and releases every data
	// source.

	held.Release = async function ()
	{
		// A conversation holds the queue until its input ends: end each, so the queue can drain.
		Array.from( conversations ).forEach( function ( Each ) { Each.End(); } );
		if ( reload_timer !== null ) { clearTimeout( reload_timer ); reload_timer = null; }
		if ( watcher !== null ) { watcher.close(); watcher = null; }
		return await held.Exclusive( function () { return session.Release(); } );
	};


	return held;
}


//---------------------------------------------------------------------
module.exports = {
	RELOAD_DEBOUNCE_MS: RELOAD_DEBOUNCE_MS,
	FILE_URI: FILE_URI,
	ENTRY_URI: ENTRY_URI,
	REFUSED_OPTIONS: REFUSED_OPTIONS,
	HeldError: HeldError,
	ServedCommands: ServedCommands,
	NewHeld: NewHeld,
};
