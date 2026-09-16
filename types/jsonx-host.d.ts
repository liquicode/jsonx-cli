// The host interface (plan F4.6): what the Web UI asks of the program it runs in.
//
// A browser implements the first three (modes/web/public/js/host.js). The desktop, jsonx-desktop.git
// (cut 6), provides `window.JsonxHost` from its preload with all of them. The page shows a control only for
// a capability its host lists, so a host adds capabilities without the page changing.
//
// Hand-written, and held to host.js's browser implementation by test/Host.test.js.

/** The names a host can list. */
export type JsonxHostCapability =
	| 'Notify'
	| 'CopyText'
	| 'SaveText'
	| 'OpenFile'
	| 'OpenPath'
	| 'RecentFiles'
	| 'OpenTerminal';

/** A file the desktop has opened, or may open again. */
export interface JsonxHostFile
{
	/** The file's path on the machine. */
	Path: string;
	/** The address of the Web UI of the jsonx process holding it. */
	Ui?: string;
}

export interface JsonxHost
{
	/** 'browser', or the desktop's own name for itself. */
	Kind: string;

	/** The capabilities this host provides; every name listed is a function on the host. */
	Capabilities(): JsonxHostCapability[];

	/** Tells the person something outside the page. Resolves false when the host cannot or may not. */
	Notify( Title: string, Text?: string ): Promise<boolean>;

	/** Puts text on the clipboard. Resolves false when it could not. */
	CopyText( Text: string ): Promise<boolean>;

	/** Offers text to be saved as a file, under a suggested name. */
	SaveText( SuggestedName: string, Text: string ): Promise<boolean>;

	/** Desktop only: asks the person for a .jsonx file and opens it in its own jsonx process. */
	OpenFile?(): Promise<JsonxHostFile | null>;

	/** Desktop only: opens a file the host already knows of, such as one from RecentFiles. */
	OpenPath?( Path: string ): Promise<JsonxHostFile | null>;

	/** Desktop only: the files opened lately, newest first. */
	RecentFiles?(): Promise<JsonxHostFile[]>;

	/** Desktop only: a jsonx terminal on this file's process (O7), not an operating system shell. */
	OpenTerminal?(): Promise<boolean>;
}

declare global
{
	interface Window
	{
		/** Provided by the desktop's preload; absent in a browser. */
		JsonxHost?: JsonxHost;
	}
}
