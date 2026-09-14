'use strict';

/*
	A jsonx file in canonical order (plan F3.4, `jsonx format`).

	***The order is Appendix A's***, read from Schema.json, so the specification and the formatter
	cannot disagree: the file's own fields in the order the schema lists them, each data source's
	and trigger's in theirs, and each object's `Kind` and `Name` first (spec 5.5), then the fields its
	kind lists. ***Fields the schema does not name are kept***, after the named ones, in the order
	they were read (spec 15.3).

	***Array order is kept.*** The spec gives it no meaning, and reordering entries would change
	every line of a diff for nothing. Values inside an entry - a criteria, a setting, the steps - are
	the writer's and are not touched.
*/

const Schema = require( './Schema.js' );


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// The property order of a schema definition.

function order_of( Definition )
{
	return ( is_object( Definition ) && is_object( Definition.properties ) ) ? Object.keys( Definition.properties ) : [];
}

const DEFINITIONS = Schema.SCHEMA.$defs || {};
const FILE_ORDER = order_of( Schema.SCHEMA );
const DATA_SOURCE_ORDER = order_of( DEFINITIONS.DataSource );
const TRIGGER_ORDER = order_of( DEFINITIONS.Trigger );


//---------------------------------------------------------------------
// A copy of an object with the named keys first, in order, then the rest as read.

function ordered( Value, Order )
{
	if ( !is_object( Value ) ) { return Value; }

	let result = {};
	for ( let index = 0; index < Order.length; index++ )
	{
		let key = Order[ index ];
		if ( Object.prototype.hasOwnProperty.call( Value, key ) ) { result[ key ] = Value[ key ]; }
	}
	let keys = Object.keys( Value );
	for ( let index = 0; index < keys.length; index++ )
	{
		if ( !Object.prototype.hasOwnProperty.call( result, keys[ index ] ) ) { result[ keys[ index ] ] = Value[ keys[ index ] ]; }
	}
	return result;
}


// An object's order: Kind and Name, then its kind's fields.
function object_order( Entry )
{
	let order = [ 'Kind', 'Name' ];
	let kind = is_object( Entry ) ? Entry.Kind : null;
	if ( typeof kind === 'string' && is_object( DEFINITIONS[ kind ] ) )
	{
		order = order.concat( order_of( DEFINITIONS[ kind ] ).filter( function ( Key ) { return Key !== 'Kind' && Key !== 'Name'; } ) );
	}
	return order;
}


function each( List, Order )
{
	if ( !Array.isArray( List ) ) { return List; }
	return List.map( function ( Entry ) { return ordered( Entry, ( typeof Order === 'function' ) ? Order( Entry ) : Order ); } );
}


//---------------------------------------------------------------------
// The file in canonical order. A copy; the document handed in is not changed.

function FormatDocument( Document )
{
	let file = ordered( Document, FILE_ORDER );
	if ( !is_object( file ) ) { return file; }

	if ( Object.prototype.hasOwnProperty.call( file, 'DataSources' ) ) { file.DataSources = each( file.DataSources, DATA_SOURCE_ORDER ); }
	if ( Object.prototype.hasOwnProperty.call( file, 'Objects' ) ) { file.Objects = each( file.Objects, object_order ); }
	if ( Object.prototype.hasOwnProperty.call( file, 'Triggers' ) ) { file.Triggers = each( file.Triggers, TRIGGER_ORDER ); }
	return JSON.parse( JSON.stringify( file ) );
}


//---------------------------------------------------------------------
// Whether a file's text is already what writing its canonical form would produce. A difference of
// line endings alone is not one: a checkout on Windows turns LF into CRLF, and a file under source
// control would otherwise never read as formatted.

function IsFormatted( Text, Canonical )
{
	let text = String( Text );
	if ( text.charCodeAt( 0 ) === 0xFEFF ) { text = text.slice( 1 ); }
	return text.replace( /\r\n/g, '\n' ) === String( Canonical ).replace( /\r\n/g, '\n' );
}


//---------------------------------------------------------------------
module.exports = {
	FormatDocument: FormatDocument,
	IsFormatted: IsFormatted,
};
