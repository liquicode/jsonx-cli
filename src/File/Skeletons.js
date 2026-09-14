'use strict';

/*
	Skeletons: a conforming entry of each kind, and a whole file, to start from (plan F3.4).

	***The skeletons carry no domain.*** A document a person or a model starts from is the kind of
	document which ends up in a prompt, and one written in a real domain would teach that domain's
	field names (memory: never write the answers). So the store is `Store`, the field is `Field`,
	and every name says what it is: `New query`.

	***Each noun's skeleton fits the others***: a trigger names `New process`, which is a Process with
	a DataSource, over `Store`, so adding them to a file which has a `Store` data source adds no
	error. `new file` is a whole file which validates with no errors.
*/

const Schema = require( './Schema.js' );

const KINDS = [ 'file', 'datasource', 'query', 'insert', 'update', 'delete', 'process', 'trigger' ];


//---------------------------------------------------------------------
function store()
{
	return { Name: 'Store', AdapterName: 'jsonstor-memory' };
}


//---------------------------------------------------------------------
// One skeleton. Name replaces the entry's Name (or the file's); absent keeps the default.

function Skeleton( Kind, Name )
{
	let name = ( typeof Name === 'string' && Name !== '' ) ? Name : null;
	let entry = null;

	if ( Kind === 'datasource' ) { entry = { Name: 'New data source', AdapterName: 'jsonstor-memory', Settings: {} }; }
	if ( Kind === 'query' ) { entry = { Kind: 'Query', Name: 'New query', DataSource: 'Store', Criteria: { Field: { $exists: true } }, Sort: { Field: 1 }, MaxCount: 10 }; }
	if ( Kind === 'insert' ) { entry = { Kind: 'Insert', Name: 'New insert', DataSource: 'Store', Documents: [ { Field: 'value' } ] }; }
	if ( Kind === 'update' ) { entry = { Kind: 'Update', Name: 'New update', DataSource: 'Store', Criteria: { Field: 'value' }, Update: { $set: { Field: 'new value' } } }; }
	if ( Kind === 'delete' ) { entry = { Kind: 'Delete', Name: 'New delete', DataSource: 'Store', Criteria: { Field: 'value' } }; }
	if ( Kind === 'process' ) { entry = { Kind: 'Process', Name: 'New process', DataSource: 'Store', Criteria: {}, Steps: [ { $return: { Field: '$Document.Field' } } ] }; }
	if ( Kind === 'trigger' ) { entry = { Name: 'New trigger', Process: 'New process' }; }

	if ( entry !== null )
	{
		if ( name !== null ) { entry.Name = name; }
		return entry;
	}

	if ( Kind === 'file' )
	{
		return {
			Jsonx: Schema.SPEC_VERSION,
			Name: ( name !== null ) ? name : 'New file',
			Description: 'What this file is for.',
			DataSources: [ store(), { Name: 'Copies', AdapterName: 'jsonstor-memory' } ],
			Objects: [
				{ Kind: 'Insert', Name: 'Seed the store', DataSource: 'Store', Documents: [ { Field: 'first' }, { Field: 'second' } ] },
				{ Kind: 'Query', Name: 'Read the store', DataSource: 'Store', Criteria: {}, Sort: { Field: 1 } },
				{ Kind: 'Process', Name: 'Copy each document', DataSource: 'Store', Criteria: {}, Steps: [ { $return: { Field: '$Document.Field' } } ], Into: 'Copies' },
				{ Kind: 'Process', Name: 'Run everything', Steps: [
					{ $call: { Name: 'Seed the store' } },
					{ $call: { Name: 'Copy each document' } },
					{ $call: { Name: 'Read the store', Into: 'Rows' } },
					{ $return: '$Rows' },
				] },
			],
			Triggers: [
				{ Name: 'Copy by hand', Process: 'Copy each document' },
			],
		};
	}

	throw new Error( 'There is no skeleton for [' + Kind + ']; the kinds are ' + KINDS.join( ', ' ) + '.' );
}


//---------------------------------------------------------------------
module.exports = {
	KINDS: KINDS,
	Skeleton: Skeleton,
};
