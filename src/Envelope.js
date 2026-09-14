'use strict';

/*
	The one result envelope every mode answers (plan F6.1): { Ok, ExitCode, Result, Findings, Log }.

	***A command writes through `Context.Out`, never through `Io`***, so the same handler serves the
	command line, the Web API and MCP. Out records everything written, and the mode decides where it
	goes: the command line writes each piece as it arrives - the result on standard output, findings
	and report lines on standard error - and a served mode sends the envelope.

	***Out does not read --quiet.*** A handler keeps its own quiet checks, exactly as it wrote before,
	so the command line's output is unchanged byte for byte; a served mode refuses --quiet, so its
	envelope always carries the whole report.

		Result( Value )     the command's result, formatted with --output on the command line
		Finding( Finding )  a { Severity, Path, Message }, written as its report block
		Log( Text )         report text; the envelope holds it as lines
		Text( Text )        text for a shell (completion), written as it is
		Line( Value )       one JSON Lines record (debug); the envelope's Result is the array of them
		Stream( Text )      standard output which is a protocol, not a result (jsonx mcp over stdio):
		                    written as it is and never recorded, since it runs for as long as the mode does
*/

const Report = require( './Report.js' );


//---------------------------------------------------------------------
// Options:
//		Stdout, Stderr   where the command line writes; absent, nothing is written and Out only records
//		Output           the --output format a result is written in
//		OnLog            function ( Line ): each report line as it is written, for a served mode which
//		                 pushes the report while the command runs (the WebSocket, cut 4)
//		OnFinding        function ( Finding ): each finding as it is written, likewise
//		OnLine           function ( Value ): each JSON Lines record as it is written (a served debug's
//		                 snapshots)
//
// ***A sink is told, never asked***: what it throws is ignored, so a client which went away cannot
// fail the command it asked for, and the envelope is recorded whatever the sinks do.

function NewOut( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let stdout = ( typeof options.Stdout === 'function' ) ? options.Stdout : null;
	let stderr = ( typeof options.Stderr === 'function' ) ? options.Stderr : null;
	let output = options.Output || 'json';
	let on_log = ( typeof options.OnLog === 'function' ) ? options.OnLog : null;
	let on_finding = ( typeof options.OnFinding === 'function' ) ? options.OnFinding : null;
	let on_line = ( typeof options.OnLine === 'function' ) ? options.OnLine : null;

	function tell( Sink, Value )
	{
		try { Sink( Value ); }
		catch ( error ) { /* a sink is told, never asked */ }
		return;
	}

	let recorded = { Result: undefined, Findings: [], Log: [], Lines: null };

	let out = {};


	//---------------------------------------------------------------------
	out.Result = function ( Value )
	{
		recorded.Result = Value;
		if ( stdout ) { stdout( Report.FormatResult( output, Value ) ); }
		return;
	};


	//---------------------------------------------------------------------
	out.Finding = function ( Finding )
	{
		recorded.Findings.push( Finding );
		if ( stderr ) { stderr( Report.FormatFinding( Finding ) ); }
		if ( on_finding ) { tell( on_finding, Finding ); }
		return;
	};


	//---------------------------------------------------------------------
	out.Log = function ( Text )
	{
		let text = String( Text );
		let lines = text.split( /\r?\n/ );
		if ( lines.length > 0 && lines[ lines.length - 1 ] === '' ) { lines.pop(); }
		recorded.Log = recorded.Log.concat( lines );
		if ( stderr ) { stderr( text ); }
		if ( on_log ) { for ( let index = 0; index < lines.length; index++ ) { tell( on_log, lines[ index ] ); } }
		return;
	};


	//---------------------------------------------------------------------
	out.Text = function ( Text )
	{
		recorded.Result = ( typeof recorded.Result === 'string' ? recorded.Result : '' ) + Text;
		if ( stdout ) { stdout( Text ); }
		return;
	};


	//---------------------------------------------------------------------
	out.Line = function ( Value )
	{
		if ( recorded.Lines === null ) { recorded.Lines = []; }
		recorded.Lines.push( Value );
		recorded.Result = recorded.Lines;
		if ( stdout ) { stdout( JSON.stringify( Value ) + '\n' ); }
		if ( on_line ) { tell( on_line, Value ); }
		return;
	};


	//---------------------------------------------------------------------
	out.Stream = function ( Text )
	{
		if ( stdout ) { stdout( Text ); }
		return;
	};


	//---------------------------------------------------------------------
	// The envelope for the exit code the handler returned. Result is absent when none was written.

	out.Envelope = function ( ExitCode )
	{
		let envelope = { Ok: ( ExitCode === 0 ), ExitCode: ExitCode };
		if ( typeof recorded.Result !== 'undefined' ) { envelope.Result = recorded.Result; }
		envelope.Findings = recorded.Findings.slice();
		envelope.Log = recorded.Log.slice();
		return envelope;
	};


	return out;
}


//---------------------------------------------------------------------
module.exports = {
	NewOut: NewOut,
};
