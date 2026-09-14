'use strict';

/*
	jsonx engine <verb> [options]            jsonx engine schema <verb> [options]

	jsongin with no file and no storage (plan F3.8), one command per row of src/Engine/Engine.js.

	Exit codes: 0 answered; 2 a usage mistake, including --file, which an engine command does not
	read; 3 jsongin refused the input, or validate-query and schema validate found something.
*/

const Engine = require( '../src/Engine/Engine.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
function handler_for( Verb )
{
	let verb = Engine.ENGINE_VERBS[ Verb ];
	let names = Object.keys( verb.Inputs ).concat( ( verb.Positionals || [] ).map( function ( Positional ) { return Positional.Name; } ) );

	return async function ( Parsed, Context )
	{
		let io = Context.Io;
		let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

		// ***--file is global, and an engine command reads no file***; accepting it would be the
		// ignored option this parser refuses everywhere else.
		if ( Parsed.Given.file === true )
		{
			io.Stderr( 'Option [--file] has no effect on an engine command, which reads no jsonx file.\n' );
			return 2;
		}

		let values = {};
		for ( let index = 0; index < names.length; index++ ) { values[ names[ index ] ] = value( names[ index ] ); }

		let answer = null;
		try
		{
			answer = Engine.Run( Verb, values );
		}
		catch ( error )
		{
			if ( !( error instanceof Engine.EngineError ) ) { throw error; }
			io.Stderr( error.message + '\n' );
			return 2;
		}

		if ( typeof answer.Result !== 'undefined' ) { Report.WriteResult( io, value( 'output' ), answer.Result ); }
		if ( !value( 'quiet' ) )
		{
			for ( let index = 0; index < answer.Findings.length; index++ ) { io.Stderr( Report.FormatFinding( answer.Findings[ index ] ) ); }
		}
		return ( answer.Findings.length > 0 ) ? 3 : 0;
	};
}


//---------------------------------------------------------------------
function command_for( Verb )
{
	let verb = Engine.ENGINE_VERBS[ Verb ];
	let node = {
		Command: verb.Group ? Verb.slice( verb.Group.length + 1 ) : Verb,
		Describe: verb.Describe,
		Library: verb.Library.map( function ( Name ) { return 'jsongin.' + Name; } ),
		Options: Object.assign( {}, verb.Inputs ),
		Handler: handler_for( Verb ),
	};
	if ( Array.isArray( verb.Positionals ) ) { node.Positionals = verb.Positionals; }
	return node;
}


//---------------------------------------------------------------------
function build_group()
{
	let group = { Command: 'engine', Describe: 'Query, sort, project, update and validate documents with jsongin, with no file and no storage.', Commands: [] };
	let groups = {};

	let verbs = Object.keys( Engine.ENGINE_VERBS );
	for ( let index = 0; index < verbs.length; index++ )
	{
		let verb = Engine.ENGINE_VERBS[ verbs[ index ] ];
		if ( !verb.Group )
		{
			group.Commands.push( command_for( verbs[ index ] ) );
			continue;
		}
		if ( !groups[ verb.Group ] )
		{
			groups[ verb.Group ] = { Command: verb.Group, Describe: 'Infer, validate, fill in and project with JSON Schema.', Commands: [] };
			group.Commands.push( groups[ verb.Group ] );
		}
		groups[ verb.Group ].Commands.push( command_for( verbs[ index ] ) );
	}
	return group;
}


//---------------------------------------------------------------------
module.exports = build_group();
