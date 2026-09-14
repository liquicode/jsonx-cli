'use strict';

/*
	The jsonx command tree: the root, its global options, and the command groups.

	***Every mode reads this tree.*** The command line parses it, and the Web API, MCP, the TUI and
	the Web UI will route, list and complete from it, which is what makes each of them mirror the
	command line by construction. A command exists because it is declared here, one file per
	group, joined below.

	`--bind` and `--set` join when the session that reads them is built; `--input-json` is declared
	so that help lists it, and is handled by src/CommandLine/InputJson.js before any other parsing.
*/


//---------------------------------------------------------------------
const GLOBAL_OPTIONS = {
	'help': { Type: 'boolean', Alias: 'h', Describe: 'Show help for the command.' },
	'file': { Type: 'string', Alias: 'f', Describe: 'The jsonx file. Absent: JSONX_FILE, then the one .jsonx file in the current directory.' },
	'output': { Type: 'string', Alias: 'o', Choices: [ 'json', 'jsonl' ], Default: 'json', Describe: 'How the result is written to standard output.' },
	'quiet': { Type: 'boolean', Alias: 'q', Describe: 'Write no report to standard error.' },
	'input-json': { Type: 'string', Describe: 'Read the whole invocation from a JSON file, or - for standard input. Must be the only argument.' },
};


//---------------------------------------------------------------------
const TREE = {
	Command: 'jsonx',
	Describe: 'Read, validate, run and edit jsonx files.',
	GlobalOptions: GLOBAL_OPTIONS,
	Options: {
		'version': { Type: 'boolean', Inherit: false, Describe: 'Show the version.' },
	},
	Commands: [
		require( './validate.js' ),
		require( './plan.js' ),
		require( './run.js' ),
		require( './explain.js' ),
		require( './debug.js' ),
		require( './new.js' ),
		require( './format.js' ),
	].concat( require( './manage.js' ).Groups, [
		require( './engine.js' ),
		require( './adapters.js' ),
	] ),
};


//---------------------------------------------------------------------
module.exports = {
	GLOBAL_OPTIONS: GLOBAL_OPTIONS,
	TREE: TREE,
};
