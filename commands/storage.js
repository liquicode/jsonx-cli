'use strict';

/*
	jsonx datasource <verb> <name> [options]      (and jsonx data <verb> ...)

	The ad hoc storage verbs (plan F3.7), one command per row of src/Storage/Verbs.js, joined to the
	`datasource` group by manage.js.

	Exit codes:
		0  the verb ran, or --save stored the object
		1  the storage call or the object failed
		2  a usage mistake: no such data source, the guard without --yes, an option which has no
		   effect with or without --save
		3  the file has errors, the built object has errors, or --save would add one

	***An option a command accepts and then ignores is refused***, as everywhere in this parser:
	--save runs nothing, so --bind, --set, --verbose, --trace and --yes beside it are exit 2, and
	--force without --save is too.
*/

const Verbs = require( '../src/Storage/Verbs.js' );
const Edit = require( '../src/File/Edit.js' );
const Writer = require( '../src/File/Writer.js' );
const DataSources = require( '../src/Session/DataSources.js' );
const FileCommand = require( './file.js' );
const SessionCommand = require( './session.js' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );


//---------------------------------------------------------------------
const CRITERIA_OPTIONAL = { 'criteria': { Type: 'json', JsonType: 'object', Default: {}, Describe: 'The criteria; absent selects every document.' } };
const CRITERIA_REQUIRED = { 'criteria': { Type: 'json', JsonType: 'object', Required: true, Describe: 'The criteria. One which selects every document must be confirmed with yes.' } };
const PROJECTION = { 'projection': { Type: 'json', JsonType: 'object', Describe: 'Which fields to keep or drop.' } };
const FIRST_ONLY = { 'first-only': { Type: 'boolean', Describe: 'Only the first document the criteria selects.' } };
const YES = { 'yes': { Type: 'boolean', Describe: 'Confirm a call which touches every document, or removes the store.' } };
// The second data source a join or a union reads, and which of its documents.
const WITH_SOURCE = {
	'with': { Type: 'string', Required: true, Describe: 'The second data source, by the name the file gives it.' },
	'with-criteria': { Type: 'json', JsonType: 'object', Describe: 'Which of its documents to read; absent reads every one.' },
};
const SAVE = {
	'save': { Type: 'string', Describe: 'Store the command in the file as an object of this name, and run nothing.' },
	'force': { Type: 'boolean', Describe: 'With --save: store it even when it adds an error.' },
};

// The options of each verb, beside RUN_OPTIONS.
const VERB_OPTIONS = {
	'find': Object.assign( {}, CRITERIA_OPTIONAL, PROJECTION, {
		'sort': { Type: 'json', JsonType: 'object', Describe: 'The order, as { Field: 1 or -1 }.' },
		'skip': { Type: 'integer', Describe: 'How many documents to pass over first (SkipCount).' },
		'max': { Type: 'integer', Describe: 'The most documents to read. Set to 0 for all documents.' },
		'into': { Type: 'string', Describe: 'A data source the rows are inserted into.' },
	}, SAVE ),
	'find-one': Object.assign( {}, CRITERIA_OPTIONAL, PROJECTION ),
	'count': Object.assign( {}, CRITERIA_OPTIONAL ),
	'join': Object.assign( {}, CRITERIA_OPTIONAL, WITH_SOURCE, {
		'on': { Type: 'json', JsonType: 'object', Required: true, Describe: 'How a pair matches, reading the document as $$Left and the one it is tested against as $$Right.' },
		'type': { Type: 'string', Choices: [ 'Left', 'Inner', 'Right', 'Outer' ], Describe: 'Which join; absent means Left.' },
		'as': { Type: 'string', Describe: 'The field the matches are written to, as an array; absent merges them into the document.' },
	} ),
	'union': Object.assign( {}, CRITERIA_OPTIONAL, WITH_SOURCE ),
	'insert': Object.assign( { 'documents': { Type: 'json', JsonType: [ 'object', 'array' ], Required: true, Describe: 'One document, or an array of them.' } }, SAVE ),
	'update': Object.assign( {}, CRITERIA_REQUIRED, { 'update': { Type: 'json', JsonType: 'object', Required: true, Describe: 'The update document, such as { "$set": { ... } }.' } }, FIRST_ONLY, YES, SessionCommand.CHANGES_OPTION, SAVE ),
	'replace': Object.assign( { 'criteria': { Type: 'json', JsonType: 'object', Required: true, Describe: 'The criteria.' }, 'document': { Type: 'json', JsonType: 'object', Required: true, Describe: 'The document which replaces the first one selected.' } } ),
	'delete': Object.assign( {}, CRITERIA_REQUIRED, FIRST_ONLY, YES, SAVE ),
	'flush': {},
	'drop': Object.assign( {}, YES ),
	'refresh-index': {},
	'ping': {},
};

// What --save makes pointless.
const NOT_WITH_SAVE = [ 'bind', 'set', 'verbose', 'trace', 'yes', 'changes' ];


//---------------------------------------------------------------------
function handler_for( Verb )
{
	let declared = Object.keys( VERB_OPTIONS[ Verb ] );
	let verb = Verbs.VERBS[ Verb ];

	return async function ( Parsed, Context )
	{
		let io = Context.Io;
		let out = Context.Out;
		let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

		let values = {};
		for ( let index = 0; index < declared.length; index++ ) { values[ declared[ index ] ] = value( declared[ index ] ); }
		let data_source = value( 'name' );

		if ( typeof values.save === 'string' ) { return save( Verb, data_source, values, Parsed, Context ); }

		if ( Parsed.Given.force === true && declared.includes( 'force' ) )
		{
			out.Log( 'Option [--force] has an effect only with --save.\n' );
			return 2;
		}

		let refusal = Verbs.Guard( Verb, values );
		if ( refusal !== null )
		{
			out.Log( refusal + '\n' );
			return 2;
		}

		let opened = await SessionCommand.OpenSession( Parsed, Context, SessionCommand.RunExtras( Parsed, Context ) );
		if ( typeof opened.ExitCode === 'number' ) { return opened.ExitCode; }
		let session = opened.Session;

		let report = null;
		try
		{
			try
			{
				session.DataSources.Definition( data_source );
				// join and union name a second one, and it is checked here so an unknown name is
				// a usage mistake rather than a failed run.
				if ( typeof values[ 'with' ] === 'string' ) { session.DataSources.Definition( values[ 'with' ] ); }
			}
			catch ( error )
			{
				if ( !( error instanceof DataSources.DataSourceError ) ) { throw error; }
				out.Log( error.message + '\n' );
				await session.Release();
				return 2;
			}

			if ( verb.Kind !== null )
			{
				let entry = Verbs.BuildObject( Verb, data_source, values );
				let errors = Verbs.ValidateObject( session.Document, entry, {
					jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: session.Catalog.ValidateSettings,
				} );
				if ( errors.length > 0 )
				{
					for ( let index = 0; index < errors.length; index++ ) { out.Finding( errors[ index ] ); }
					out.Log( 'Nothing ran: the ' + verb.Kind + ' this command builds has errors.\n' );
					await session.Release();
					return 3;
				}
			}

			report = await Verbs.Run( session, Verb, data_source, values );
		}
		catch ( error )
		{
			await session.Release();
			throw error;
		}
		return await SessionCommand.FinishRun( report, session, Parsed, Context );
	};
}


//---------------------------------------------------------------------
// --save: the object goes into the file through the manage verbs' checked add. Nothing opens.

function save( Verb, DataSource, Values, Parsed, Context )
{
	let io = Context.Io;
	let out = Context.Out;

	let pointless = NOT_WITH_SAVE.filter( function ( Name ) { return Parsed.Given[ Name ] === true; } );
	if ( pointless.length > 0 )
	{
		out.Log( 'Option [--' + pointless[ 0 ] + '] has no effect with --save, which runs nothing.\n' );
		return 2;
	}

	let loaded = FileCommand.LoadFile( Parsed, Context );
	if ( typeof loaded.ExitCode === 'number' ) { return loaded.ExitCode; }

	let entry = Verbs.BuildObject( Verb, DataSource, Values, Values.save );
	let outcome = null;
	try
	{
		outcome = Edit.Add( loaded.Document, Verbs.VERBS[ Verb ].Kind.toLowerCase(), entry, { Force: Values.force, Validate: loaded.ValidateOptions } );
	}
	catch ( error )
	{
		if ( !( error instanceof Edit.EditError ) ) { throw error; }
		out.Log( error.message + '\n' );
		return 2;
	}

	let quiet = Context.Parser.Value( Context.Tree, Parsed, 'quiet' );
	if ( !quiet )
	{
		for ( let index = 0; index < outcome.Findings.length; index++ ) { out.Finding( outcome.Findings[ index ] ); }
	}
	if ( !outcome.Ok )
	{
		if ( !quiet ) { out.Log( 'Refused: saving [' + Values.save + '] would add ' + outcome.Findings.length + ' error' + ( outcome.Findings.length === 1 ? '' : 's' ) + '. The file is unchanged; pass --force to save it anyway.\n' ); }
		return 3;
	}

	Writer.WriteFile( loaded.Path, loaded.Document, io.WriteFile ? io : null );
	if ( !quiet ) { out.Log( 'saved ' + entry.Kind + ' [' + Values.save + ']: ' + loaded.Path + ' written. Nothing ran.\n' ); }
	out.Result( outcome.Result );
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	VERB_OPTIONS: VERB_OPTIONS,
	Commands: Object.keys( Verbs.VERBS ).map( function ( Verb )
	{
		return {
			Command: Verb,
			Describe: Verbs.VERBS[ Verb ].Describe,
			Library: Verbs.VERBS[ Verb ].Functions.map( function ( Name ) { return 'jsonstor.' + Name; } ),
			Positionals: [ { Name: 'name', Type: 'string', Required: true, Complete: 'datasources', Describe: 'The data source.' } ],
			Options: Object.assign( {}, VERB_OPTIONS[ Verb ], SessionCommand.RUN_OPTIONS ),
			Handler: handler_for( Verb ),
		};
	} ),
};
