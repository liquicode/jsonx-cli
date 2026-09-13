'use strict';

/*
	The jsonx file schema: Appendix A of docs/Jsonx-Specification.md.

	***Schema.json is a copy of the page's block, never an edit of it.*** It was generated from the
	fenced block, and test/Schema.test.js reads the page and fails when the two differ, so a change
	to the schema is made in the specification and copied here.
*/

const SCHEMA = require( './Schema.json' );

// The version of the specification this package was written to (spec 15.1).
const SPEC_VERSION = '0.2';


//---------------------------------------------------------------------
module.exports = {
	SCHEMA: SCHEMA,
	SPEC_VERSION: SPEC_VERSION,
};
