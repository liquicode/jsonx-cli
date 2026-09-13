'use strict';

/*
	@liquicode/jsonx-cli - the library the jsonx command line, and every later mode, is built on.

	***This file exports and contains no logic.*** Each component lives in its own file under
	src/ and is added to the export list below as it is built, so that `require` reaches the
	same components the bin uses. types/jsonx-cli.d.ts and src/jsonx-cli.mjs describe this
	list, and build/types-check.js fails when the three disagree.
*/

const PACKAGE = require( '../package.json' );


//---------------------------------------------------------------------
module.exports = {

	// The version of this package.
	Version: PACKAGE.version,

	// The components, by name. Filled in as cut 1 builds them.
	Library: {
		CommandLine: {
			Parser: require( './CommandLine/Parser.js' ),
			Help: require( './CommandLine/Help.js' ),
			InputJson: require( './CommandLine/InputJson.js' ),
		},
		File: {
			Reader: require( './File/Reader.js' ),
			Writer: require( './File/Writer.js' ),
			Names: require( './File/Names.js' ),
			Schema: require( './File/Schema.js' ),
		},
		Validate: require( './Validate/Validate.js' ),
		Session: {
			Environment: require( './Session/Environment.js' ),
		},
		Report: require( './Report.js' ),
	},

};
