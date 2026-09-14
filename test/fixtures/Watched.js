'use strict';

/*
	A file with a watched store: a trigger on `Watched` runs `Note each arrival`, which reads `Notes`
	twice and then writes a note, so the Process is still running across several awaits when another
	request arrives. Used to assert that a served session fires triggers for outside clients (F2.4).
*/

function Document()
{
	return {
		DataSources: [
			{ Name: 'Watched', AdapterName: 'jsonstor-memory' },
			{ Name: 'Notes', AdapterName: 'jsonstor-memory' },
		],
		Objects: [
			{ Kind: 'Query', Name: 'Read notes', DataSource: 'Notes', Criteria: {} },
			{
				Kind: 'Process', Name: 'Note each arrival', DataSource: 'Watched', Criteria: {},
				Steps: [
					{ $call: { Name: 'Read notes', Into: 'Before' } },
					{ $call: { Name: 'Read notes', Into: 'Again' } },
					{ $call: { Name: 'InsertOne', With: { DataSource: 'Notes', Document: { Seen: '$Document.Name' } } } },
				],
			},
		],
		Triggers: [
			{ Name: 'On arrival', On: [ 'InsertOne', 'InsertMany' ], Process: 'Note each arrival' },
		],
	};
}

// The report line a firing of the trigger writes.
const FIRED = 'trigger [On arrival] Note each arrival';


module.exports = {
	Document: Document,
	FIRED: FIRED,
};
