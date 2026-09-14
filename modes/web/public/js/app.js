'use strict';

/*
	The Web UI (plan F4.5): one AngularJS module over the file's own jsonx process.

	***The page decides nothing a test needs a window to reach.*** What it shows comes from the process:
	Hello, answers, events, and the front requests (Line, Entry, Complete, Actions, Inventory). The page
	wires them to the panes.
*/

angular.module( 'JsonxWeb', [] );
