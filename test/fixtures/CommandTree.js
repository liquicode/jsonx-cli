'use strict';

// A command tree exercising every part of the grammar, independent of the real jsonx commands.

function Tree( Calls )
{
	let calls = Array.isArray( Calls ) ? Calls : [];

	function handler( Name )
	{
		return async function ( Parsed ) { calls.push( { Name: Name, Parsed: Parsed } ); return 0; };
	}

	return {
		Command: 'jsonx',
		Describe: 'A test tree.',
		GlobalOptions: {
			'help': { Type: 'boolean', Alias: 'h', Describe: 'Show help.' },
			'output': { Type: 'string', Alias: 'o', Choices: [ 'json', 'jsonl' ], Default: 'json', Describe: 'Output format.' },
			'quiet': { Type: 'boolean', Alias: 'q', Describe: 'No report.' },
			'bind': { Type: 'string', Repeat: true, Describe: 'A binding.' },
		},
		Options: {
			'version': { Type: 'boolean', Inherit: false, Describe: 'Show the version.' },
		},
		Commands: [
			{
				Command: 'run',
				Describe: 'Run an object.',
				Positionals: [ { Name: 'name', Type: 'string', Required: true, Describe: 'The object.' } ],
				Options: {
					'input': { Type: 'json', Describe: 'The starting document.' },
					'max-steps': { Type: 'integer', Default: 1000, Describe: 'Step limit.' },
					'ratio': { Type: 'number', Describe: 'A number.' },
					'dry': { Type: 'boolean', Describe: 'Plan only.' },
				},
				Handler: handler( 'run' ),
			},
			{
				Command: 'datasource',
				Aliases: [ 'data' ],
				Describe: 'Data sources.',
				Options: {
					'strict': { Type: 'boolean', Describe: 'Inherited by the group\'s commands.' },
				},
				Commands: [
					{
						Command: 'describe',
						Describe: 'Describe one.',
						Positionals: [ { Name: 'name', Type: 'string', Required: true, Describe: 'The data source.' } ],
						Options: { 'rows': { Type: 'integer', Default: 10, Describe: 'Sample rows.' } },
						Handler: handler( 'datasource describe' ),
					},
					{
						Command: 'rename',
						Describe: 'Rename one.',
						Positionals: [
							{ Name: 'name', Type: 'string', Required: true },
							{ Name: 'new-name', Type: 'string', Required: true },
						],
						Handler: handler( 'datasource rename' ),
					},
				],
			},
			{
				Command: 'touch',
				Describe: 'Takes any number of names.',
				Positionals: [ { Name: 'names', Type: 'string', Repeat: true } ],
				Options: { 'mode': { Type: 'string', Required: true, Describe: 'Required option.' } },
				Handler: handler( 'touch' ),
			},
			{
				Command: '__hidden',
				Hidden: true,
				Describe: 'Parses, and is never offered.',
				Handler: handler( '__hidden' ),
			},
		],
	};
}


//---------------------------------------------------------------------
// An Io whose files and standard input are in memory.

function MemoryIo( Files, Stdin )
{
	let io = {
		Out: '',
		Err: '',
		StdinReads: 0,
		Stdout: function ( Text ) { io.Out += Text; },
		Stderr: function ( Text ) { io.Err += Text; },
		ReadFile: function ( Path )
		{
			if ( !Files || typeof Files[ Path ] !== 'string' ) { throw new Error( 'ENOENT: no such file ' + Path ); }
			return Files[ Path ];
		},
		ReadStdin: function () { io.StdinReads++; return ( typeof Stdin === 'string' ) ? Stdin : ''; },
	};
	return io;
}


module.exports = {
	Tree: Tree,
	MemoryIo: MemoryIo,
};
