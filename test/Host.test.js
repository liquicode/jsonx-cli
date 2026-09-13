'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Host = require( '../src/Session/Host.js' );


//---------------------------------------------------------------------
describe( 'Host', function ()
{

	it( 'services each call and resumes the run with the answer at Into', async function ()
	{
		let calls = [];
		let process_object = {
			Kind: 'Process', Name: 'P', DataSource: 'ignored',
			Steps: [
				{ $call: { Name: 'Double', With: { Value: '$Document.n' }, Into: 'Doubled' } },
				{ $return: '$Doubled' },
			],
		};
		let run = await Host.NewHost().Run( process_object, { Document: { n: 21 } }, async function ( Name, With )
		{
			calls.push( Name );
			return With.Value * 2;
		} );
		LIB_ASSERT.strictEqual( run.Status, 'done' );
		LIB_ASSERT.strictEqual( run.Result, 42 );
		LIB_ASSERT.deepStrictEqual( calls, [ 'Double' ] );
	} );

	it( 'reports a failed call into the run, where $try catches it', async function ()
	{
		let process_object = {
			Name: 'P',
			Steps: [
				{ $try: { Do: [ { $call: { Name: 'Boom' } } ], Catch: [ { $do: { Caught: true } } ], As: 'Problem' } },
				{ $return: { Caught: '$Caught', Message: '$Problem.Message' } },
			],
		};
		let run = await Host.NewHost().Run( process_object, {}, async function () { throw new Error( 'it broke' ); } );
		LIB_ASSERT.deepStrictEqual( run.Result, { Caught: true, Message: 'it broke' } );
	} );

	it( 'fails the run when nothing catches a failed call', async function ()
	{
		let run = await Host.NewHost().Run( { Name: 'P', Steps: [ { $call: { Name: 'Boom' } } ] }, {}, async function () { throw new Error( 'uncaught' ); } );
		LIB_ASSERT.strictEqual( run.Status, 'failed' );
		LIB_ASSERT.strictEqual( run.Error.Message, 'uncaught' );
	} );

	it( 'fails a run which makes more calls than MaxCalls', async function ()
	{
		let looping = { Name: 'Loop', Steps: [ { $while: { Check: {}, Do: [ { $call: { Name: 'Tick' } } ] } } ] };
		let run = await Host.NewHost( { MaxCalls: 5 } ).Run( looping, {}, async function () { return 1; } );
		LIB_ASSERT.strictEqual( run.Status, 'failed' );
		LIB_ASSERT.ok( /more than 5 calls/.test( run.Error.Message ) );
	} );

	it( 'answers a process jsonproc refuses with a failed run, not an exception', async function ()
	{
		let run = await Host.NewHost().Run( { Name: 'Bad', Steps: 5 }, {}, async function () { return null; } );
		LIB_ASSERT.strictEqual( run.Status, 'failed' );
		LIB_ASSERT.strictEqual( run.Error.Code, 'BadProcess' );
	} );

} );
