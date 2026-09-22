'use strict';

/*
	The noun groups: `jsonx <noun> list | show | add | set | remove | rename` for the seven nouns
	(plan F3.1), built from one table so the seven cannot drift apart.

	`datasource` adds `info` and `describe`, which open the data source through a session;
	`trigger` adds `run`.

	An edit validates the file before and after, and is refused with exit 3 when it would add an
	error the file did not have, unless --force. The file is written only when an edit succeeds, and
	comes back tab indented.
*/

const Edit = require( '../src/File/Edit.js' );
const Writer = require( '../src/File/Writer.js' );
const Inspect = require( '../src/Session/Inspect.js' );
const DataSources = require( '../src/Session/DataSources.js' );
const FileCommand = require( './file.js' );
const SessionCommand = require( './session.js' );
const TriggerCommand = require( './trigger.js' );


const FORCE = { 'force': { Type: 'boolean', Describe: 'Make the change even when it adds an error.' } };
// ***Decided (user, 2026-09-14)***, following `format --check`: validate the edit, write nothing.
const CHECK = { 'check': { Type: 'boolean', Describe: 'Validate the change exactly as it would be made, and write nothing: exit 3 when it would add an error.' } };


//---------------------------------------------------------------------
function values( Parsed, Context )
{
	return function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };
}


//---------------------------------------------------------------------
// Runs one edit: load, change, report, write. Mistakes in the request are exit 2.

function edit_handler( Noun, Verb )
{
	return async function ( Parsed, Context )
	{
		let io = Context.Io;
		let out = Context.Out;
		let value = values( Parsed, Context );

		let checking = ( Verb === 'add' || Verb === 'set' ) && value( 'check' ) === true;
		if ( checking && Parsed.Given.force === true )
		{
			out.Log( 'Option [--force] has no effect with --check, which writes nothing.\n' );
			return 2;
		}

		let loaded = FileCommand.LoadFile( Parsed, Context );
		if ( typeof loaded.ExitCode === 'number' ) { return loaded.ExitCode; }

		// ***A check edits a copy***: an edit changes the document in place, and a served command's
		// document is the one the session holds (commands/file.js).
		let document = checking ? JSON.parse( JSON.stringify( loaded.Document ) ) : loaded.Document;

		let options = { Force: ( Verb === 'list' || Verb === 'show' || checking ) ? false : value( 'force' ), Validate: loaded.ValidateOptions };
		let outcome = null;
		try
		{
			if ( Verb === 'list' ) { outcome = { Ok: true, Result: Edit.List( document, Noun ), Findings: [], Read: true }; }
			if ( Verb === 'show' ) { outcome = { Ok: true, Result: Edit.Show( document, Noun, value( 'name' ) ), Findings: [], Read: true }; }
			if ( Verb === 'add' ) { outcome = Edit.Add( document, Noun, value( 'json' ), options ); }
			if ( Verb === 'set' ) { outcome = Edit.Set( document, Noun, value( 'name' ), value( 'json' ), options ); }
			if ( Verb === 'remove' ) { outcome = Edit.Remove( document, Noun, value( 'name' ), options ); }
			if ( Verb === 'rename' ) { outcome = Edit.Rename( document, Noun, value( 'name' ), value( 'new-name' ), options ); }
		}
		catch ( error )
		{
			if ( !( error instanceof Edit.EditError ) ) { throw error; }
			out.Log( error.message + '\n' );
			return 2;
		}

		let quiet = value( 'quiet' );
		if ( !quiet )
		{
			for ( let index = 0; index < outcome.Findings.length; index++ ) { out.Finding( outcome.Findings[ index ] ); }
		}

		let errors = outcome.Findings.length + ' error' + ( outcome.Findings.length === 1 ? '' : 's' );
		if ( checking )
		{
			if ( !quiet ) { out.Log( outcome.Ok ? 'Checked: this ' + Verb + ' adds no error. Nothing was written.\n' : 'Checked: this ' + Verb + ' would add ' + errors + '. Nothing was written.\n' ); }
			if ( outcome.Ok ) { out.Result( outcome.Result ); }
			return outcome.Ok ? 0 : 3;
		}

		if ( !outcome.Ok )
		{
			if ( !quiet ) { out.Log( 'Refused: this ' + Verb + ' would add ' + errors + '. The file is unchanged; pass --force to make it anyway.\n' ); }
			return 3;
		}

		if ( outcome.Read !== true )
		{
			Writer.WriteFile( loaded.Path, loaded.Document, io.WriteFile ? io : null );
			if ( !quiet ) { out.Log( Verb + ' ' + Noun + ': ' + loaded.Label + ' written.\n' ); }
		}
		out.Result( outcome.Result );
		return 0;
	};
}


//---------------------------------------------------------------------
function inspect_handler( Which )
{
	return async function ( Parsed, Context )
	{
		let value = values( Parsed, Context );
		let opened = await SessionCommand.OpenSession( Parsed, Context );
		if ( typeof opened.ExitCode === 'number' ) { return opened.ExitCode; }

		let name = value( 'name' );
		try
		{
			let result = ( Which === 'info' )
				? await Inspect.Info( opened.Session, name )
				: await Inspect.Describe( opened.Session, name, value( 'rows' ) );
			Context.Out.Result( result );
			return 0;
		}
		catch ( error )
		{
			if ( !( error instanceof DataSources.DataSourceError ) ) { throw error; }
			Context.Out.Log( error.message + '\n' );
			return /No data source is named/.test( error.message ) ? 2 : 1;
		}
		finally
		{
			await opened.Session.Release();
		}
	};
}


//---------------------------------------------------------------------
function noun_group( Noun )
{
	let label = Edit.NOUNS[ Noun ].Label;
	// Completes the noun's own entries: `query show` offers the Queries, `datasource show` the data sources.
	let completes = ( Edit.NOUNS[ Noun ].Kind !== null ) ? 'objects:' + Edit.NOUNS[ Noun ].Kind : Edit.NOUNS[ Noun ].Section.toLowerCase();
	let name_positional = { Name: 'name', Type: 'string', Required: true, Complete: completes, Describe: 'The ' + label + '.' };
	let body = { 'json': { Type: 'json', JsonType: 'object', Required: true, Describe: 'The ' + label + ' as JSON.' } };

	let group = {
		Command: Noun,
		// Its list and show only read; add, set, remove and rename change the file.
		Does: 'file',
		Describe: 'List, show, add, change, remove and rename the file\'s ' + Edit.NOUNS[ Noun ].Plural + '.',
		Commands: [
			{ Command: 'list', Does: 'list', Describe: 'List every ' + label + '.', Concurrent: true, Handler: edit_handler( Noun, 'list' ) },
			{ Command: 'show', Does: 'list', Describe: 'Show one ' + label + '.', Concurrent: true, Positionals: [ name_positional ], Handler: edit_handler( Noun, 'show' ) },
			{ Command: 'add', Describe: 'Add a ' + label + '.', Options: Object.assign( {}, body, FORCE, CHECK ), Handler: edit_handler( Noun, 'add' ) },
			{
				Command: 'set', Describe: 'Change fields of a ' + label + '; a field set to null is removed.',
				Positionals: [ name_positional ], Options: Object.assign( {}, body, FORCE, CHECK ), Handler: edit_handler( Noun, 'set' ),
			},
			{
				Command: 'remove', Describe: 'Remove a ' + label + '; refused while anything refers to it.',
				Positionals: [ name_positional ], Options: Object.assign( {}, FORCE ), Handler: edit_handler( Noun, 'remove' ),
			},
			{
				Command: 'rename', Describe: 'Rename a ' + label + ' and every reference to it.',
				Positionals: [ name_positional, { Name: 'new-name', Type: 'string', Required: true, Describe: 'The new name.' } ],
				Options: Object.assign( {}, FORCE ), Handler: edit_handler( Noun, 'rename' ),
			},
		],
	};

	if ( Noun === 'datasource' )
	{
		// ***`data` reaches the same group*** (user, 2026-09-13), for the storage verbs of cut 2.
		group.Aliases = [ 'data' ];
		group.Commands.push( {
			Command: 'info', Does: 'read', Describe: 'What the data source says about itself: StorageInfo and the dialect boundary check.',
			Library: [ 'jsonstor.StorageInfo' ],
			Positionals: [ name_positional ], Options: Object.assign( {}, SessionCommand.SESSION_OPTIONS ), Handler: inspect_handler( 'info' ),
		} );
		group.Commands.push( {
			Command: 'describe', Does: 'read', Describe: 'A JSON Schema inferred from the data source\'s first rows, and those rows.',
			Positionals: [ name_positional ],
			Options: Object.assign( { 'rows': { Type: 'integer', Default: Inspect.DEFAULT_ROWS, Describe: 'How many rows to read.' } }, SessionCommand.SESSION_OPTIONS ),
			Handler: inspect_handler( 'describe' ),
		} );

		// The storage verbs (plan F3.7), and ping.
		group.Commands = group.Commands.concat( require( './storage.js' ).Commands );
		group.Describe = 'Manage the file\'s data sources, and read and write the documents in them.';
	}

	if ( Noun === 'trigger' ) { group.Commands.push( TriggerCommand.RunCommand ); }

	return group;
}


//---------------------------------------------------------------------
module.exports = {
	Groups: Object.keys( Edit.NOUNS ).map( noun_group ),
};
