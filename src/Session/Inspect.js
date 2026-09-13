'use strict';

/*
	What a data source says about itself (plan F3.6).

	Info is the storage's own account, StorageInfo(), with the dialect boundary check the family
	built for it: which dialect is in force, what server version answered, and any warning that the
	server is outside what the dialect was measured against.

	Describe is what a person or a model needs to write a criteria against the data: a JSON Schema
	inferred by jsongin over the first rows, and those rows. jsongin's inference nests an array's
	`items`, so an array path is marked by construction.
*/

const jsongin = require( '@liquicode/jsongin' );


const DEFAULT_ROWS = 10;


//---------------------------------------------------------------------
async function Info( Session, Name )
{
	let definition = Session.DataSources.Definition( Name );
	let storage = Session.DataSources.Open( Name );
	let info = await storage.StorageInfo();
	let boundary = Session.jsonstor.CheckDialectBoundary( info );

	return {
		Name: Name,
		AdapterName: definition.AdapterName,
		Info: info,
		Boundary: Array.isArray( boundary ) ? boundary : [],
	};
}


//---------------------------------------------------------------------
async function Describe( Session, Name, Rows )
{
	let rows = ( typeof Rows === 'number' && Rows > 0 ) ? Rows : DEFAULT_ROWS;
	let storage = Session.DataSources.Open( Name );
	let samples = await storage.FindMany2( {}, null, null, { MaxCount: rows } );
	samples = Array.isArray( samples ) ? samples : [];

	return {
		Name: Name,
		Schema: jsongin.InferSchema( samples ),
		Samples: samples,
	};
}


//---------------------------------------------------------------------
module.exports = {
	DEFAULT_ROWS: DEFAULT_ROWS,
	Info: Info,
	Describe: Describe,
};
