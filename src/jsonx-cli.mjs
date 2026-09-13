// @liquicode/jsonx-cli - ESM entry point.
//
// ***This is a wrapper and never a second build.*** It imports the CommonJS module and
// re-exports what is already there, so `require()` and `import` reach one library.
//
// build/types-check.js fails on any difference between this file, types/jsonx-cli.d.ts, and the
// running library.

import LIBRARY from './jsonx-cli.js';


//---------------------------------------------------------------------
// The library itself.
// Same object as `require( '@liquicode/jsonx-cli' )` returns.

export default LIBRARY;


//---------------------------------------------------------------------
// The package.

export const Version = LIBRARY.Version;
export const Library = LIBRARY.Library;
