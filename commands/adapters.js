'use strict';

/*
	jsonx adapters list | info <name> | settings <name> [--name <data source>]

	The adapters a data source can name (plan F3.9), from src/Adapters/Adapters.js. Reads no jsonx
	file and opens no data source.

	`settings` writes a DataSources entry, so it pipes into `jsonx datasource add --json -`.

	Exit codes: 0 answered; 2 no adapter answers to the name, or --file was given.
*/

const Adapters = require( '../src/Adapters/Adapters.js' );
const FileCommand = require( './file.js' );


const NAME = { Name: 'name', Type: 'string', Required: true, Complete: 'adapters', Describe:'An adapter name: a package\'s own, a prime, or an alias.' };


//---------------------------------------------------------------------
function handler_for( Which )
{
	return async function ( Parsed, Context )
	{
		let out = Context.Out;
		let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

		let refused = FileCommand.RefuseFile( Parsed, Context, 'an adapters command' );
		if ( refused !== null ) { return refused; }

		let adapters = Adapters.NewAdapters();
		let result = null;
		try
		{
			if ( Which === 'list' ) { result = adapters.List(); }
			if ( Which === 'info' ) { result = adapters.Info( value( 'name' ) ); }
			if ( Which === 'settings' ) { result = adapters.Settings( value( 'name' ), value( 'data-source' ) ); }
		}
		catch ( error )
		{
			if ( !( error instanceof Adapters.AdaptersError ) ) { throw error; }
			out.Log( error.message + '\n' );
			return 2;
		}

		out.Result( result );
		if ( Which === 'info' && result.Installed === false && !value( 'quiet' ) )
		{
			out.Log( result.Package + ' is not installed here, so the names it answers to cannot be listed.\n' );
		}
		return 0;
	};
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'adapters',
	Describe: 'List the adapters a data source can name, and show what one needs.',
	Commands: [
		{
			Command: 'list',
			Describe: 'Every adapter package, and whether it is installed here. Loads none of them.',
			Handler: handler_for( 'list' ),
		},
		{
			Command: 'info',
			Describe: 'An adapter\'s package, driver, settings, and every name it answers to.',
			Positionals: [ NAME ],
			Handler: handler_for( 'info' ),
		},
		{
			Command: 'settings',
			Describe: 'A data source entry for an adapter, with its required and default settings, ready for datasource add.',
			Positionals: [ NAME ],
			Options: {
				'data-source': { Type: 'string', Describe: 'The Name the entry carries; absent means "New data source".' },
			},
			Handler: handler_for( 'settings' ),
		},
	],
};
