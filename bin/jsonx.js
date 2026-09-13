#!/usr/bin/env node
'use strict';

// ***The bin is a caller of the library, never the library.*** Requiring @liquicode/jsonx-cli
// must not run a command line, so everything that runs one lives in modes/cli/Main.js.

const Main = require( '../modes/cli/Main.js' );

Main.Main( process.argv.slice( 2 ), Main.ProcessIo() ).then( function ( ExitCode ) { process.exitCode = ExitCode; } );
