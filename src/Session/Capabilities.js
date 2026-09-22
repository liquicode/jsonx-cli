'use strict';

/*
	What a session does, said in one sentence generated from the commands it serves.

	***Each command carries `Does`***, one word from DOES below, on its node in the command table
	(`commands/*.js`); a group's word is its commands' unless one says otherwise. `ServedCommands`
	(`Held.js`) carries it on every served command, and a test holds that none is without one.

	***The sentence is opt-in*** *(user, 2026-09-21)*: `jsonx mcp --capabilities` says it in place of the
	profile's hand-written `Describe`. Without the option the instructions are as they were, because
	jsonx-llm's model was trained on them, and serving it other words than it learned would be measured
	before it is chosen. ***To be reconsidered*** once jsonx-llm's eval has compared the two on the
	trained model (its story, step 5): either the sentence becomes the default and the training text is
	generated with it, or it goes.

		This session reads data, lists the file's entries and checks drafts. It does not run objects,
		write data or change the file.

	It says what the served commands do, and what the session cannot do of the three things a person
	would most want to know it cannot: run objects, write data, change the file. So a profile with a
	command taken away, or one added, is described truly without anyone writing a word.
*/

// In the order a sentence says them.
const DOES = {
	read: 'reads data',
	adapters: 'reads the adapters',
	list: 'lists the file\'s entries',
	check: 'checks drafts',
	compute: 'computes on documents',
	run: 'runs objects',
	write: 'writes data',
	file: 'changes the file',
};

// What the sentence says the session does not do, when it does not.
const DOES_NOT = {
	run: 'run objects',
	write: 'write data',
	file: 'change the file',
};


function listed( Words, Joiner )
{
	if ( Words.length <= 1 ) { return Words.join( '' ); }
	return Words.slice( 0, -1 ).join( ', ' ) + ' ' + ( Joiner || 'and' ) + ' ' + Words[ Words.length - 1 ];
}


// The sentence for a list of served commands, each { Command, Does }.
function Sentence( Commands )
{
	let done = {};
	( Commands || [] ).forEach( function ( Command ) { if ( typeof Command.Does === 'string' ) { done[ Command.Does ] = true; } } );
	let does = Object.keys( DOES ).filter( function ( Key ) { return done[ Key ]; } ).map( function ( Key ) { return DOES[ Key ]; } );
	let not = Object.keys( DOES_NOT ).filter( function ( Key ) { return !done[ Key ]; } ).map( function ( Key ) { return DOES_NOT[ Key ]; } );
	let sentence = ( does.length > 0 ) ? 'This session ' + listed( does ) + '.' : 'This session serves no command.';
	if ( not.length > 0 ) { sentence += ' It does not ' + listed( not, 'or' ) + '.'; }
	return sentence;
}


module.exports = {
	DOES: DOES,
	DOES_NOT: DOES_NOT,
	Sentence: Sentence,
};
