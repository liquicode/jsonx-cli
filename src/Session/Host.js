'use strict';

/*
	The process host: drives a jsonproc run and services the calls it makes.

	Lifted from jsonx-studio's src/Studio/ProcessHost.js, which carries the reasoning:

	-	***`$call` does not call.*** A step which wants work done suspends the run at
		`Status: 'waiting'`, the host does the work, and `Resume()` hands the answer back.
	-	***A failed call is reported into the run, never thrown past it***, so a `$try` in the
		process can catch it (measured 2026-09-13: the error arrives at `As` as
		`{ Code, Message, Cursor }`).
	-	***Two limits***: MaxSteps bounds one Execute, MaxCalls bounds how many calls one run may
		make, because a process looping around a call makes progress on every Execute and would
		never trip the step limit.

	Debug mode (declining a call) and held runs are Studio's too, and arrive with `jsonx debug` in
	cut 2.
*/

const jsonproc = require( '@liquicode/jsonproc' );


const DEFAULT_MAX_STEPS = 10000;
const DEFAULT_MAX_CALLS = 10000;


//---------------------------------------------------------------------
function NewHost( Settings )
{
	let settings = ( Settings && typeof Settings === 'object' ) ? Settings : {};

	let host = {
		MaxSteps: ( typeof settings.MaxSteps === 'number' ) ? settings.MaxSteps : DEFAULT_MAX_STEPS,
		MaxCalls: ( typeof settings.MaxCalls === 'number' ) ? settings.MaxCalls : DEFAULT_MAX_CALLS,
	};


	//---------------------------------------------------------------------
	// Runs a process to the end.
	//
	// Handler( Name, With ) is awaited for every call and answers with what the process receives;
	// throwing fails that step. Returns the finished run: `done` with Result, or `failed` with
	// Error. A process jsonproc refuses to start throws.

	host.Run = async function ( Process, Input, Handler )
	{
		let run = jsonproc.Start( Process, Input );
		let calls = 0;

		while ( true )
		{
			run = jsonproc.Execute( Process, run, host.MaxSteps );
			if ( run.Status !== 'waiting' ) { break; }

			calls++;
			if ( calls > host.MaxCalls )
			{
				run = jsonproc.Resume( Process, run, undefined, {
					Code: 'StepLimitExceeded',
					Message: 'The process [' + Process.Name + '] made more than ' + host.MaxCalls + ' calls.',
				} );
				continue;
			}

			let waiting = run.Waiting;
			try
			{
				let result = await Handler( waiting.Name, waiting.With );
				run = jsonproc.Resume( Process, run, result );
			}
			catch ( error )
			{
				run = jsonproc.Resume( Process, run, undefined, { Code: 'StepFailed', Message: error.message } );
			}
		}

		return run;
	};


	return host;
}


//---------------------------------------------------------------------
module.exports = {
	DEFAULT_MAX_STEPS: DEFAULT_MAX_STEPS,
	DEFAULT_MAX_CALLS: DEFAULT_MAX_CALLS,
	NewHost: NewHost,
};
