'use strict';

/*
	What a command writes: its result on standard output, its report on standard error.

	***Standard output carries the result and nothing else***, so a command pipes and redirects.
	Everything a person reads - progress, findings, a summary - goes to standard error, and
	`--quiet` removes it.

	Cut 1 step 3 holds what `jsonx validate` needs: the result formats and the finding lines. The
	per-object run lines join when the runner does.
*/


//---------------------------------------------------------------------
// The result, as --output asks: `json` pretty with tabs, or `jsonl` one line per element of an
// array (one line for anything else, nothing for an empty array).

function FormatResult( Output, Value )
{
	if ( Output === 'jsonl' )
	{
		if ( Array.isArray( Value ) )
		{
			return Value.map( function ( Item ) { return JSON.stringify( Item ) + '\n'; } ).join( '' );
		}
		return JSON.stringify( Value ) + '\n';
	}
	return JSON.stringify( Value, null, '\t' ) + '\n';
}


//---------------------------------------------------------------------
function WriteResult( Io, Output, Value )
{
	Io.Stdout( FormatResult( Output, Value ) );
	return;
}


//---------------------------------------------------------------------
// One finding as a report line: severity, path, message.

function FormatFinding( Finding )
{
	let path = ( Finding.Path === '' ) ? '(file)' : Finding.Path;
	return Finding.Severity.padEnd( 8 ) + path + '\n' + '        ' + Finding.Message + '\n';
}


//---------------------------------------------------------------------
function plural( Count, Word )
{
	return Count + ' ' + Word + ( Count === 1 ? '' : 's' );
}


//---------------------------------------------------------------------
// `observatory.jsonx: 1 error, 0 warnings, 2 notes`

function FormatSummary( Label, Summary )
{
	return Label + ': ' + plural( Summary.Errors, 'error' ) + ', ' + plural( Summary.Warnings, 'warning' ) + ', ' + plural( Summary.Notes, 'note' ) + '\n';
}


//---------------------------------------------------------------------
// A run report as lines: one per object run, indented under the object which called it, with the
// Processes its storage calls triggered beneath it, and a failure expanded.
//
//		Prepare the season  Process  ran once  12 ms
//		  Three bookings  Insert  inserted 3  2 ms
//		    trigger [Note every long booking as it arrives] Note a long booking  Process  ran once ...

function FormatRunReport( RunReport, Depth, Options )
{
	let depth = ( typeof Depth === 'number' ) ? Depth : 0;
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let indent = '  '.repeat( depth );
	let lines = '';

	let head = ( typeof RunReport.Trigger === 'string' && depth > 0 ) ? 'trigger [' + RunReport.Trigger + '] ' : '';
	let kind = RunReport.Kind || '(no such object)';
	let outcome = RunReport.Ok ? RunReport.Summary : 'FAILED';
	lines += indent + head + RunReport.Name + '  ' + kind + '  ' + outcome + '  ' + RunReport.Ms + ' ms\n';

	// ***What each storage call measured***, with --verbose: the rows the backend returned for the
	// part of the criteria it was asked, and the rows jsongin kept of those.
	if ( options.Statistics === true && Array.isArray( RunReport.Statistics ) )
	{
		for ( let index = 0; index < RunReport.Statistics.length; index++ )
		{
			let measured = RunReport.Statistics[ index ];
			// An insert carries no criteria, so there is nothing to measure and no line to show.
			if ( measured.Function === 'InsertOne' || measured.Function === 'InsertMany' ) { continue; }
			let detail = measured.Measured
				? 'backend ' + measured.PushdownRows + ' rows, kept ' + measured.ResidualRows + ( measured.Translator ? ' (' + measured.Translator + ')' : '' )
				: 'not measured';
			lines += indent + '  | ' + measured.Function + ' on ' + measured.DataSource + ': ' + detail + '\n';
		}
	}

	for ( let index = 0; index < RunReport.Calls.length; index++ ) { lines += FormatRunReport( RunReport.Calls[ index ], depth + 1, options ); }
	for ( let index = 0; index < RunReport.Fired.length; index++ ) { lines += FormatRunReport( RunReport.Fired[ index ], depth + 1, options ); }

	if ( !RunReport.Ok && RunReport.Error )
	{
		lines += indent + '  ' + RunReport.Error.Message + '\n';
	}
	return lines;
}


//---------------------------------------------------------------------
// A plan as lines: the call tree, the data sources it would open, the triggers it could fire, and
// the entry's findings.

function FormatPlan( Plan )
{
	let lines = '';

	function node_lines( Node, Depth )
	{
		let indent = '  '.repeat( Depth );
		let note = Node.Missing ? '  (no such object)' : ( Node.Repeats ? '  (calls itself; stopped here)' : '' );
		lines += indent + Node.Name + '  ' + ( Node.Kind || '' ) + note + '\n';
		for ( let index = 0; index < Node.Does.length; index++ )
		{
			let item = Node.Does[ index ];
			if ( item.Object ) { node_lines( item.Object, Depth + 1 ); continue; }
			let where = ( item.DataSource === null ) ? ( item.Computed ? 'a data source computed from ' + item.Computed : '(no data source)' ) : item.DataSource;
			lines += indent + '  ' + item.Function + ' on ' + where + ( item.Into ? '  (Into)' : '' ) + '\n';
		}
		return;
	}
	node_lines( Plan.Tree, 0 );

	if ( Plan.DataSources.length > 0 )
	{
		lines += '\nData sources:\n';
		for ( let index = 0; index < Plan.DataSources.length; index++ )
		{
			let source = Plan.DataSources[ index ];
			if ( !source.Defined ) { lines += '  ' + source.Name + '  (not defined)\n'; continue; }
			let installed = ( source.Installed === false ) ? '  NOT INSTALLED' : '';
			lines += '  ' + source.Name + '  ' + source.AdapterName + installed + '\n';
			for ( let variable = 0; variable < source.Environment.length; variable++ )
			{
				let item = source.Environment[ variable ];
				lines += '    ${env:' + item.Name + '}  ' + ( item.Set ? 'set' : 'NOT SET' ) + '\n';
			}
		}
	}

	if ( Plan.Triggers.length > 0 )
	{
		lines += '\nTriggers it could fire:\n';
		for ( let index = 0; index < Plan.Triggers.length; index++ )
		{
			let trigger = Plan.Triggers[ index ];
			lines += '  ' + trigger.Name + '  -> ' + trigger.Process + '  on ' + trigger.On.join( ', ' ) + ' of ' + trigger.DataSource + '\n';
		}
	}

	if ( Plan.Findings.length > 0 )
	{
		lines += '\nFindings:\n';
		for ( let index = 0; index < Plan.Findings.length; index++ ) { lines += FormatFinding( Plan.Findings[ index ] ); }
	}
	lines += '\nNothing was opened.\n';
	return lines;
}


//---------------------------------------------------------------------
module.exports = {
	FormatResult: FormatResult,
	WriteResult: WriteResult,
	FormatFinding: FormatFinding,
	FormatSummary: FormatSummary,
	FormatRunReport: FormatRunReport,
	FormatPlan: FormatPlan,
};
