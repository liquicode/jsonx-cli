// Type declarations for @liquicode/jsonx-cli
//
// ***Hand written, and hand written on purpose.*** The library is Javascript and stays
// Javascript: TypeScript is ***supported and never required***.
//
// `build/types-check.js` loads the running library and asserts that every member here exists
// there, that every member there is declared here, and that `src/jsonx-cli.mjs` re-exports the
// same set.

declare module '@liquicode/jsonx-cli'
{

	//---------------------------------------------------------------------
	// Documents.

	/** A document is an object. A jsonx file, a data source, an object and a trigger are all documents. */
	export type JsonDocument = { [ Key: string ]: any };


	//---------------------------------------------------------------------
	// The library.

	export interface JsonxCliLibrary
	{
		/** The version of this package. */
		Version: string;
		/** The components, by name. */
		Library: { [ ComponentName: string ]: any };
	}


	//---------------------------------------------------------------------
	// Named exports.

	export const Version: JsonxCliLibrary[ 'Version' ];
	export const Library: JsonxCliLibrary[ 'Library' ];

	const LIBRARY: JsonxCliLibrary;
	export default LIBRARY;
}
