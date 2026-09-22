'use strict';

/*
	MCP, the protocol without a transport (plan F4.3): JSON-RPC messages in, replies out, answered by a
	held session. modes/mcp/Stdio.js and Http.js carry the messages.

	***Written by hand, with no runtime dependency*** (user, 2026-09-13), and ***speaking revision
	2025-11-25*** (user, 2026-09-14): the `initialize` handshake of the legacy era, which the official
	SDK's clients speak. Revision 2026-07-28 drops the handshake; supporting it waits until a published
	client speaks it (jsonx/.plans/jsonx-cli-cut-3.md, decision 3).

	***One tool per served command***, from the same table the Web API routes (Held.ServedCommands):
	-	the name is the command's words joined by `_` (`datasource_find`, `engine_schema_infer`)
	-	the input schema is its positionals and options, and a call's arguments are its --input-json
		document
	-	a call answers the envelope, as JSON text and as structuredContent, with isError when it is
		not Ok. A usage mistake is a tool result, not a protocol error, so the model reads why.

	***The --yes rule is a required argument*** (F4.3, F6.3): a tool whose command declares --yes
	requires `yes`, and a call without it is refused before anything runs. The command's own guard
	still decides what `yes: false` allows.

	***Resources are the file as written***: `jsonx://file`, and `jsonx://entry/<name>` for each data
	source, object and trigger, read from the held document at the time of the request, so a reload
	shows. An environment reference is never resolved (F6.4).

	***The tools are the held session's profile*** (cut 7, decision 14): the commands it serves, each
	without the options it withholds and with its defaults shown. `initialize` declares
	`tools.listChanged` and carries the profile's instructions; ***`jsonx/profile`***, a request of this
	server's own, answers the profile in force with no params and switches it with `{ profile }`. A
	switch, made here or by any other surface, rebuilds the tools and sends
	`notifications/tools/list_changed` through the transport's way out (OnNotify) - stdio has one, HTTP
	does not, so an HTTP client lists again after its own switch.
*/

const Held = require( '../../src/Session/Held.js' );
const Profiles = require( '../../src/Session/Profiles.js' );


const PROTOCOL_VERSION = '2025-11-25';

// The revisions a client may ask for and be answered in. The differences between them add fields a
// client of an earlier revision ignores.
const SUPPORTED_VERSIONS = [ '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05' ];

const SERVER_NAME = 'jsonx';

// The resources' addresses, which the WebSocket's Read shares (src/Session/Held.js).
const FILE_URI = Held.FILE_URI;
const ENTRY_URI = Held.ENTRY_URI;

// JSON-RPC and MCP error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const RESOURCE_NOT_FOUND = -32002;

// Commands which may change or remove what is there, as a front end's action menu judges them too.
// Every other command which is not read-only is additive: it inserts, adds or saves.
const Capabilities = require( '../../src/Session/Capabilities.js' );
const DESTRUCTIVE_WORDS = require( '../../src/Front/Inventory.js' ).DESTRUCTIVE_WORDS;

// Commands which open a data source only to read it. A Concurrent command reads by declaration.
const READ_ONLY_COMMANDS = [ 'datasource count', 'datasource find-one', 'datasource info', 'datasource describe', 'datasource ping' ];


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
function ToolName( Path )
{
	return Path.join( '_' );
}


//---------------------------------------------------------------------
// A declaration (a positional or an option) as JSON Schema.

function declaration_schema( Declaration )
{
	let type = Declaration.Type || 'string';
	let schema = {};
	if ( type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' ) { schema.type = type; }
	if ( type === 'jsonl' ) { schema.type = 'array'; }
	// A `json` value is any JSON value, unless its declaration says what it holds. ***Saying so is what
	// stops a model sending a criteria as a string of JSON***: shown no type, qwen3.5:4b wrote
	// "{\"Grade\": \"foreman\"}" every time, and read the refusal six times without changing it.
	if ( type === 'json' && typeof Declaration.JsonType !== 'undefined' ) { schema.type = Declaration.JsonType; }

	if ( Array.isArray( Declaration.Choices ) ) { schema.enum = Declaration.Choices.slice(); }
	if ( Declaration.Repeat === true && type !== 'json' && type !== 'jsonl' ) { schema = { type: 'array', items: schema }; }
	if ( typeof Declaration.Default !== 'undefined' ) { schema.default = Declaration.Default; }
	if ( typeof Declaration.Describe === 'string' ) { schema.description = Declaration.Describe; }
	return schema;
}


//---------------------------------------------------------------------
// The tool for one served command.

function tool_for( Command )
{
	let properties = {};
	let required = [];

	for ( let index = 0; index < Command.Positionals.length; index++ )
	{
		let positional = Command.Positionals[ index ];
		properties[ positional.Name ] = declaration_schema( positional );
		if ( positional.Required === true ) { required.push( positional.Name ); }
	}
	let names = Object.keys( Command.Options );
	for ( let index = 0; index < names.length; index++ )
	{
		let option = Command.Options[ names[ index ] ];
		properties[ names[ index ] ] = declaration_schema( option );
		if ( option.Required === true ) { required.push( names[ index ] ); }
	}

	// A value the profile defaults is shown as the option's default, ***and said in its description***
	// (user, 2026-09-18): Ollama re-serializes a tool into its own struct and drops `default`, so a model
	// behind it would never see the number; the description is kept by every client.
	let defaults = ( Command.Defaults && typeof Command.Defaults === 'object' ) ? Command.Defaults : {};
	let defaulted = Object.keys( defaults );
	for ( let index = 0; index < defaulted.length; index++ )
	{
		let property = properties[ defaulted[ index ] ];
		if ( !property ) { continue; }
		property.default = defaults[ defaulted[ index ] ];
		property.description = ( property.description ? property.description + ' ' : '' ) + 'Defaults to ' + JSON.stringify( defaults[ defaulted[ index ] ] ) + '.';
	}

	let guarded = Object.prototype.hasOwnProperty.call( Command.Options, 'yes' );
	if ( guarded && !required.includes( 'yes' ) )
	{
		required.push( 'yes' );
		properties.yes.description = 'Required, except beside save. true confirms a call which touches every document, or removes the store; false refuses one.';
	}

	let read_only = Command.Concurrent || READ_ONLY_COMMANDS.includes( Command.Command );
	let annotations = { title: 'jsonx ' + Command.Command, readOnlyHint: read_only };
	if ( !read_only ) { annotations.destructiveHint = DESTRUCTIVE_WORDS.includes( Command.Path[ Command.Path.length - 1 ] ) || DESTRUCTIVE_WORDS.includes( Command.Path[ 0 ] ); }

	let schema = { type: 'object', properties: properties, additionalProperties: false };
	if ( required.length > 0 ) { schema.required = required; }

	return {
		Tool: {
			name: ToolName( Command.Path ),
			title: 'jsonx ' + Command.Command,
			description: Command.Describe,
			inputSchema: schema,
			annotations: annotations,
		},
		Command: Command,
		Guarded: guarded,
	};
}


//---------------------------------------------------------------------
function success( Id, Result )
{
	return { jsonrpc: '2.0', id: Id, result: Result };
}

function failure( Id, Code, Message, Data )
{
	let error = { code: Code, message: Message };
	if ( typeof Data !== 'undefined' ) { error.data = Data; }
	return { jsonrpc: '2.0', id: ( typeof Id === 'undefined' ) ? null : Id, error: error };
}

function ParseError( Message )
{
	return failure( null, PARSE_ERROR, 'Parse error: ' + Message );
}


//---------------------------------------------------------------------
// The tool result for an envelope.

function tool_result( Envelope )
{
	return {
		content: [ { type: 'text', text: JSON.stringify( Envelope ) } ],
		structuredContent: Envelope,
		isError: !Envelope.Ok,
	};
}

function tool_refusal( Message )
{
	return tool_result( { Ok: false, ExitCode: 2, Findings: [], Log: [ Message ] } );
}


//---------------------------------------------------------------------
// One connection: a stdio process, or one HTTP session. The held session is shared.
//
// Options:
//		Version   this package's version, for serverInfo

function NewMcp( HeldSession, Options )
{
	let options = is_object( Options ) ? Options : {};

	let tools = [];
	let by_name = {};

	let mcp = {
		Tools: [],
		// The profile the tools were built from, as the surfaces summarise it.
		Profile: null,
		// The revision agreed at initialize, or null before it.
		ProtocolVersion: null,
		Initialized: false,
	};

	// The tools are the profile's served commands, rebuilt whole when it switches.
	function build_tools()
	{
		tools = HeldSession.Served().map( tool_for );
		by_name = {};
		for ( let index = 0; index < tools.length; index++ ) { by_name[ tools[ index ].Tool.name ] = tools[ index ]; }
		mcp.Tools = tools.map( function ( Entry ) { return Entry.Tool; } );
		mcp.Profile = HeldSession.ProfileSummary();
		return;
	}
	build_tools();

	// A message the server starts goes out through the transport's Write, once it has given one.
	let notify = null;
	mcp.OnNotify = function ( Write )
	{
		notify = ( typeof Write === 'function' ) ? Write : null;
		return;
	};

	let stop_events = HeldSession.OnEvent( function ( Event )
	{
		if ( Event.Event !== 'profile' ) { return; }
		build_tools();
		// The event fires inside the switch, before the reply to a jsonx/profile which caused it is
		// written; the notification waits a turn, so the reply always goes out first.
		if ( notify )
		{
			setImmediate( function ()
			{
				if ( notify ) { notify( { jsonrpc: '2.0', method: 'notifications/tools/list_changed' } ); }
			} );
		}
		return;
	} );

	// The end of this connection: it stops listening to the session.
	mcp.Close = function ()
	{
		if ( stop_events ) { stop_events(); stop_events = null; }
		notify = null;
		return;
	};


	//---------------------------------------------------------------------
	function resource_list()
	{
		let document = HeldSession.Session.Document;
		let resources = [ {
			uri: FILE_URI,
			name: require( 'path' ).basename( HeldSession.Path ),
			title: 'The jsonx file',
			description: 'The whole file being served, as written.',
			mimeType: 'application/json',
		} ];
		let sections = [ 'DataSources', 'Objects', 'Triggers' ];
		for ( let section = 0; section < sections.length; section++ )
		{
			let entries = Array.isArray( document[ sections[ section ] ] ) ? document[ sections[ section ] ] : [];
			for ( let index = 0; index < entries.length; index++ )
			{
				let entry = entries[ index ];
				if ( !is_object( entry ) || typeof entry.Name !== 'string' ) { continue; }
				let what = ( sections[ section ] === 'Objects' ) ? ( entry.Kind || 'object' ) : ( sections[ section ] === 'DataSources' ? 'data source' : 'trigger' );
				resources.push( {
					uri: ENTRY_URI + encodeURIComponent( entry.Name ),
					name: entry.Name,
					description: 'The ' + what + ' [' + entry.Name + '], as written.',
					mimeType: 'application/json',
				} );
			}
		}
		return resources;
	}


	//---------------------------------------------------------------------
	function resource_read( Id, Uri )
	{
		let read = HeldSession.ReadResource( Uri );
		if ( read.Found )
		{
			return success( Id, { contents: [ { uri: Uri, mimeType: 'application/json', text: JSON.stringify( read.Value, null, '\t' ) } ] } );
		}
		return failure( Id, RESOURCE_NOT_FOUND, 'Resource not found', { uri: Uri } );
	}


	//---------------------------------------------------------------------
	async function call_tool( Id, Params )
	{
		let name = Params.name;
		if ( typeof name !== 'string' || !Object.prototype.hasOwnProperty.call( by_name, name ) )
		{
			return failure( Id, INVALID_PARAMS, 'Unknown tool: ' + name );
		}
		let args = ( typeof Params.arguments === 'undefined' ) ? {} : Params.arguments;
		if ( !is_object( args ) ) { return failure( Id, INVALID_PARAMS, 'The arguments of [' + name + '] must be an object.' ); }

		let entry = by_name[ name ];
		if ( Object.prototype.hasOwnProperty.call( args, 'Command' ) )
		{
			return success( Id, tool_refusal( 'The arguments cannot name a Command: the tool [' + name + '] is the command.' ) );
		}
		let invocation = Object.assign( {}, args, { Command: entry.Command.Path } );
		if ( entry.Guarded )
		{
			if ( typeof args.save === 'string' )
			{
				// ***save runs nothing***, so there is nothing to confirm, and the command refuses --yes
				// beside --save: the required `yes` is set aside rather than passed on.
				delete invocation.yes;
			}
			else if ( typeof args.yes !== 'boolean' )
			{
				return success( Id, tool_refusal( '[' + name + '] requires yes: true to confirm a call which touches every document or removes the store, or yes: false.' ) );
			}
		}

		let envelope = await HeldSession.Invoke( invocation );
		return success( Id, tool_result( envelope ) );
	}


	//---------------------------------------------------------------------
	// One message. Answers the reply, or null for a notification or a response.

	mcp.Handle = async function ( Message )
	{
		if ( Array.isArray( Message ) )
		{
			return failure( null, INVALID_REQUEST, 'Invalid Request: a batch of messages is not accepted; send one message at a time.' );
		}
		if ( !is_object( Message ) || Message.jsonrpc !== '2.0' )
		{
			return failure( is_object( Message ) ? Message.id : null, INVALID_REQUEST, 'Invalid Request: not a JSON-RPC 2.0 message.' );
		}

		let has_id = Object.prototype.hasOwnProperty.call( Message, 'id' ) && Message.id !== null;
		if ( typeof Message.method !== 'string' )
		{
			// A response to a request of ours: this server sends none, so there is nothing to match.
			if ( has_id && ( 'result' in Message || 'error' in Message ) ) { return null; }
			return failure( has_id ? Message.id : null, INVALID_REQUEST, 'Invalid Request: no method.' );
		}

		// A notification is never answered.
		if ( !has_id )
		{
			if ( Message.method === 'notifications/initialized' ) { mcp.Initialized = true; }
			return null;
		}

		let id = Message.id;
		let params = ( typeof Message.params === 'undefined' ) ? {} : Message.params;
		if ( !is_object( params ) ) { return failure( id, INVALID_PARAMS, 'The params of [' + Message.method + '] must be an object.' ); }

		try
		{
			switch ( Message.method )
			{
				case 'initialize':
				{
					let asked = params.protocolVersion;
					mcp.ProtocolVersion = SUPPORTED_VERSIONS.includes( asked ) ? asked : PROTOCOL_VERSION;
					let profile = HeldSession.ProfileSummary();
					// ***What the session does, never what the profile is called***, and the file by its own
					// name rather than where it lies: `instructions` is read by a model, and a model which
					// has read a profile's name or one machine's path in every session leans on it. The
					// name is a front end's to know, and `jsonx/profile` answers it.
					// With --capabilities, the sentence made from the served tools stands in the Describe's place.
					let describe = HeldSession.Capabilities ? Capabilities.Sentence( HeldSession.Served() ) : profile.Describe;
					let about_profile = ( describe ? ' ' + describe : '' ) + ( profile.Instructions ? ' ' + profile.Instructions : '' );
					return success( id, {
						protocolVersion: mcp.ProtocolVersion,
						capabilities: { tools: { listChanged: true }, resources: {} },
						serverInfo: { name: SERVER_NAME, title: 'jsonx', version: options.Version || '0.0.0' },
						instructions: 'Each tool is a jsonx command run against the file ' + require( 'path' ).basename( HeldSession.Path ) + '. A tool answers the envelope { Ok, ExitCode, Result, Findings, Log }: Result is the answer, Log the report. The resources are the file and each of its entries, as written.' + about_profile,
					} );
				}
				case 'ping':
					return success( id, {} );
				case 'jsonx/profile':
				{
					// The profile in force, or a switch: a built-in name or a .json file the serving process reads.
					if ( typeof params.profile === 'undefined' ) { return success( id, HeldSession.ProfileSummary() ); }
					if ( typeof params.profile !== 'string' ) { return failure( id, INVALID_PARAMS, 'jsonx/profile takes { profile: <a built-in name, or the name of a .json file> }, or no params to ask.' ); }
					try
					{
						return success( id, HeldSession.SetProfile( params.profile ) );
					}
					catch ( error )
					{
						if ( !( error instanceof Profiles.ProfileError ) ) { throw error; }
						return failure( id, INVALID_PARAMS, error.message );
					}
				}
				case 'tools/list':
					return success( id, { tools: mcp.Tools } );
				case 'tools/call':
					return await call_tool( id, params );
				case 'resources/list':
					return success( id, { resources: resource_list() } );
				case 'resources/templates/list':
					return success( id, { resourceTemplates: [] } );
				case 'resources/read':
					if ( typeof params.uri !== 'string' ) { return failure( id, INVALID_PARAMS, 'resources/read needs a uri.' ); }
					return resource_read( id, params.uri );
				default:
					return failure( id, METHOD_NOT_FOUND, 'Method not found: ' + Message.method );
			}
		}
		catch ( error )
		{
			return failure( id, INTERNAL_ERROR, 'Internal error: ' + ( error && error.message ? error.message : String( error ) ) );
		}
	};


	//---------------------------------------------------------------------
	// One line of text, for a transport which reads lines: parses it and answers the reply, or null.

	mcp.HandleText = async function ( Text )
	{
		let message = null;
		try { message = JSON.parse( Text ); }
		catch ( error ) { return ParseError( error.message ); }
		return await mcp.Handle( message );
	};


	return mcp;
}


//---------------------------------------------------------------------
module.exports = {
	PROTOCOL_VERSION: PROTOCOL_VERSION,
	SUPPORTED_VERSIONS: SUPPORTED_VERSIONS,
	FILE_URI: FILE_URI,
	ENTRY_URI: ENTRY_URI,
	ERRORS: { PARSE_ERROR: PARSE_ERROR, INVALID_REQUEST: INVALID_REQUEST, METHOD_NOT_FOUND: METHOD_NOT_FOUND, INVALID_PARAMS: INVALID_PARAMS, INTERNAL_ERROR: INTERNAL_ERROR, RESOURCE_NOT_FOUND: RESOURCE_NOT_FOUND },
	DESTRUCTIVE_WORDS: DESTRUCTIVE_WORDS,
	ToolName: ToolName,
	ParseError: ParseError,
	NewMcp: NewMcp,
};
