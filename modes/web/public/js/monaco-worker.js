'use strict';

/*
	The start of Monaco's web worker, served from the page's own origin.

	***Not a data: URL*** (Studio's way): a worker started from one has no origin of its own, so its request
	for workerMain.js is cross-site, and a browser which sends an Origin without the port on it - the user's
	Chrome did on the page's own requests (2026-09-15) - is refused by the loopback guard, which leaves
	Monaco's JSON diagnostics silently dead. A worker file on the page's origin makes its requests same-origin.
	(Found by the port-less-Origin browser test failing one run in six, as the worker started before or after
	its last assertion.)
*/

self.MonacoEnvironment = { baseUrl: self.location.origin + '/ui/vendor/monaco/min/' };
importScripts( self.location.origin + '/ui/vendor/monaco/min/vs/base/worker/workerMain.js' );
