'use strict';

/*
	Profiles: what a held session serves, as data (cut 7, decision 14, amended by the user 2026-09-17).

	A profile is one JSON object:

		{
			"Name": "translate",
			"Describe": "Build objects from what the data says; run nothing.",
			"Commands": [ "datasource describe", "datasource find", ... ],     or "*" for every served command
			"Without": { "datasource find": [ "into", "save", "force" ] },     options a command is served without
			"Defaults": { "datasource find": { "max": 5 } },                   values a request gets when it gives none
			"Confirm": [ "run" ],                                              what a relay puts a person in front of
			"Instructions": "..."                                              what a prompt says about the profile
		}

	***The built-ins are files beside this one*** (`profiles/*.json`): `full`, `translate`, `run` and
	`design`, each a superset of the last but `full`, which is everything. ***A custom profile is a
	`.json` file***, and one `--profile` argument takes a built-in name or a file name (user). A file may
	carry a built-in's name and stands in for it for that session.

	***A profile is checked against the served commands*** before it is used: every command it names
	must be served, every option it withholds or defaults must be an option of that command, and every
	command it confirms must be one it serves. A profile which fails is refused where it was named,
	with the reason, as a bad override is.

	***The profile is global***: the held session enforces it once, in its request path, so the Web API,
	the WebSocket and MCP obey it alike; each surface only lists what `Apply` answers. The server does
	not enforce `Confirm`; it serves it, so the front end and the server read one file.
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );

const Reader = require( '../File/Reader.js' );


const PROFILES_FOLDER = LIB_PATH.join( __dirname, 'profiles' );

const NAMES = [ 'full', 'translate', 'run', 'design' ];

// What `serve` and `mcp` run under when no --profile is given (decision 2 of the cut 7 plan).
const DEFAULT_SERVE = 'full';
const DEFAULT_MCP = 'run';

const EVERYTHING = '*';


//---------------------------------------------------------------------
class ProfileError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'ProfileError';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return JSON.parse( JSON.stringify( Value ) );
}

function is_string_list( Value )
{
	return Array.isArray( Value ) && Value.every( function ( Each ) { return ( typeof Each === 'string' ) && ( Each !== '' ); } );
}


//---------------------------------------------------------------------
// The built-ins, read once.

let built_in = null;

function built_ins()
{
	if ( built_in !== null ) { return built_in; }
	built_in = {};
	for ( let index = 0; index < NAMES.length; index++ )
	{
		let text = LIB_FS.readFileSync( LIB_PATH.join( PROFILES_FOLDER, NAMES[ index ] + '.json' ), 'utf8' );
		built_in[ NAMES[ index ] ] = JSON.parse( text );
	}
	return built_in;
}


//---------------------------------------------------------------------
// A profile by a built-in name, else by a file name read through Io (relative to Io.Cwd). Answers the
// object as written, unchecked; Check does the rest. Throws ProfileError.

function Load( NameOrPath, Io )
{
	if ( typeof NameOrPath !== 'string' || NameOrPath === '' )
	{
		throw new ProfileError( 'A profile is a built-in name (' + NAMES.join( ', ' ) + ') or the name of a .json file.' );
	}
	if ( Object.prototype.hasOwnProperty.call( built_ins(), NameOrPath ) )
	{
		return clone( built_ins()[ NameOrPath ] );
	}

	let io = is_object( Io ) ? Io : {};
	let path = LIB_PATH.resolve( io.Cwd || process.cwd(), NameOrPath );
	let text = null;
	try
	{
		text = Reader.ReadText( path, io );
	}
	catch ( error )
	{
		if ( !( error instanceof Reader.FileError ) ) { throw error; }
		throw new ProfileError( 'No profile is named [' + NameOrPath + ']: it is not a built-in (' + NAMES.join( ', ' ) + '), and ' + error.message );
	}

	let profile = null;
	try
	{
		profile = JSON.parse( text );
	}
	catch ( error )
	{
		throw new ProfileError( 'The profile ' + path + ' is not JSON: ' + error.message );
	}
	if ( !is_object( profile ) ) { throw new ProfileError( 'The profile ' + path + ' must be a JSON object.' ); }
	return profile;
}


//---------------------------------------------------------------------
// The profile checked against the served commands (Held.ServedCommands' answer) and filled in: every
// field present, Commands as a list of served command names. Throws ProfileError naming the first
// thing wrong.

function Check( Profile, Commands )
{
	if ( !is_object( Profile ) ) { throw new ProfileError( 'A profile must be a JSON object.' ); }
	let served = {};
	for ( let index = 0; index < Commands.length; index++ ) { served[ Commands[ index ].Command ] = Commands[ index ]; }

	let name = Profile.Name;
	if ( typeof name !== 'string' || name === '' ) { throw new ProfileError( 'A profile must carry a Name.' ); }
	let label = 'The profile [' + name + ']';

	let commands = null;
	if ( Profile.Commands === EVERYTHING )
	{
		commands = Object.keys( served );
	}
	else if ( is_string_list( Profile.Commands ) )
	{
		commands = [];
		for ( let index = 0; index < Profile.Commands.length; index++ )
		{
			let command = Profile.Commands[ index ].split( /\s+/ ).filter( function ( Word ) { return Word !== ''; } ).join( ' ' );
			if ( !Object.prototype.hasOwnProperty.call( served, command ) )
			{
				throw new ProfileError( label + ' names a command which is not served: [' + Profile.Commands[ index ] + '].' );
			}
			if ( !commands.includes( command ) ) { commands.push( command ); }
		}
	}
	else
	{
		throw new ProfileError( label + ' must list its Commands, as an array of command names or "*" for every served command.' );
	}

	function options_of( Command, Field )
	{
		if ( !commands.includes( Command ) ) { throw new ProfileError( label + ' ' + Field + ' a command it does not serve: [' + Command + '].' ); }
		return served[ Command ].Options;
	}

	let without = {};
	if ( typeof Profile.Without !== 'undefined' )
	{
		if ( !is_object( Profile.Without ) ) { throw new ProfileError( label + ' Without must be an object: a command name to the options it is served without.' ); }
		let names = Object.keys( Profile.Without );
		for ( let index = 0; index < names.length; index++ )
		{
			let options = options_of( names[ index ], 'withholds options of' );
			let list = Profile.Without[ names[ index ] ];
			if ( !is_string_list( list ) ) { throw new ProfileError( label + ' Without [' + names[ index ] + '] must be an array of option names.' ); }
			for ( let each = 0; each < list.length; each++ )
			{
				if ( !Object.prototype.hasOwnProperty.call( options, list[ each ] ) ) { throw new ProfileError( label + ' withholds an option [' + names[ index ] + '] does not have: [' + list[ each ] + '].' ); }
			}
			without[ names[ index ] ] = list.slice();
		}
	}

	let defaults = {};
	if ( typeof Profile.Defaults !== 'undefined' )
	{
		if ( !is_object( Profile.Defaults ) ) { throw new ProfileError( label + ' Defaults must be an object: a command name to the values it gets when a request gives none.' ); }
		let names = Object.keys( Profile.Defaults );
		for ( let index = 0; index < names.length; index++ )
		{
			let options = options_of( names[ index ], 'defaults options of' );
			let values = Profile.Defaults[ names[ index ] ];
			if ( !is_object( values ) ) { throw new ProfileError( label + ' Defaults [' + names[ index ] + '] must be an object of option values.' ); }
			let keys = Object.keys( values );
			for ( let each = 0; each < keys.length; each++ )
			{
				if ( !Object.prototype.hasOwnProperty.call( options, keys[ each ] ) ) { throw new ProfileError( label + ' defaults an option [' + names[ index ] + '] does not have: [' + keys[ each ] + '].' ); }
				if ( ( without[ names[ index ] ] || [] ).includes( keys[ each ] ) ) { throw new ProfileError( label + ' defaults an option it withholds: [' + names[ index ] + '] --' + keys[ each ] + '.' ); }
			}
			defaults[ names[ index ] ] = clone( values );
		}
	}

	let confirm = [];
	if ( typeof Profile.Confirm !== 'undefined' )
	{
		if ( !is_string_list( Profile.Confirm ) ) { throw new ProfileError( label + ' Confirm must be an array of command names.' ); }
		for ( let index = 0; index < Profile.Confirm.length; index++ )
		{
			if ( !commands.includes( Profile.Confirm[ index ] ) ) { throw new ProfileError( label + ' confirms a command it does not serve: [' + Profile.Confirm[ index ] + '].' ); }
			if ( !confirm.includes( Profile.Confirm[ index ] ) ) { confirm.push( Profile.Confirm[ index ] ); }
		}
	}

	if ( typeof Profile.Describe !== 'undefined' && typeof Profile.Describe !== 'string' ) { throw new ProfileError( label + ' Describe must be a string.' ); }
	if ( typeof Profile.Instructions !== 'undefined' && typeof Profile.Instructions !== 'string' ) { throw new ProfileError( label + ' Instructions must be a string.' ); }

	return {
		Name: name,
		Describe: ( typeof Profile.Describe === 'string' ) ? Profile.Describe : '',
		Commands: commands,
		Everything: ( Profile.Commands === EVERYTHING ),
		Without: without,
		Defaults: defaults,
		Confirm: confirm,
		Instructions: ( typeof Profile.Instructions === 'string' ) ? Profile.Instructions : '',
	};
}


//---------------------------------------------------------------------
// The served commands under a checked profile: those it names, each with the withheld options removed
// and `Defaults` (its default values, {} when none) and `Confirm` (true when a relay must ask) added.
// Order is the tree's.

function Apply( Commands, Profile )
{
	let applied = [];
	for ( let index = 0; index < Commands.length; index++ )
	{
		let command = Commands[ index ];
		if ( !Profile.Commands.includes( command.Command ) ) { continue; }

		let without = Profile.Without[ command.Command ] || [];
		let options = {};
		let names = Object.keys( command.Options );
		for ( let each = 0; each < names.length; each++ )
		{
			if ( without.includes( names[ each ] ) ) { continue; }
			options[ names[ each ] ] = command.Options[ names[ each ] ];
		}

		applied.push( Object.assign( {}, command, {
			Options: options,
			Defaults: clone( Profile.Defaults[ command.Command ] || {} ),
			Confirm: Profile.Confirm.includes( command.Command ),
		} ) );
	}
	return applied;
}


//---------------------------------------------------------------------
// What a surface tells a client about the profile in force.

function Summary( Profile, Applied )
{
	return {
		Name: Profile.Name,
		Describe: Profile.Describe,
		Commands: Applied.map( function ( Command ) { return Command.Command; } ),
		Confirm: Profile.Confirm.slice(),
		Instructions: Profile.Instructions,
	};
}


//---------------------------------------------------------------------
module.exports = {
	NAMES: NAMES,
	DEFAULT_SERVE: DEFAULT_SERVE,
	DEFAULT_MCP: DEFAULT_MCP,
	EVERYTHING: EVERYTHING,
	PROFILES_FOLDER: PROFILES_FOLDER,
	ProfileError: ProfileError,
	Load: Load,
	Check: Check,
	Apply: Apply,
	Summary: Summary,
};
