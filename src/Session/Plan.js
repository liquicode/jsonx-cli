'use strict';

/*
	The dry run: what running an object would do, with nothing opened (spec 6.1; plan F3.3).

	***A plan opens nothing.*** It reads the file, the overrides and the adapter inventory, and
	never builds a storage. Asking whether an adapter is installed may load its package, which
	connects to nothing.

	***The call tree is static.*** It is what the file says, read the way validation reads it: an
	object, the storage functions it calls on which data source, and the objects its `$call`s name,
	in step order. A branch which a `$when` would not take at run time is still listed, and a host
	function whose data source is an expression is listed as computed. A Process calling itself is
	a validation error, and the tree stops at the repeat rather than looping.
*/

const Names = require( '../File/Names.js' );
const Validate = require( '../Validate/Validate.js' );
const Environment = require( './Environment.js' );
const Overrides = require( './Overrides.js' );


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// The storage functions an object's own kind makes (spec 8.3, 9.5, 10.4, 11.3, 12.4, 6.5).

function kind_functions( Entry )
{
	let does = [];
	let on = function ( Function_, DataSource ) { does.push( { Function: Function_, DataSource: DataSource } ); };

	if ( Entry.Kind === 'Insert' ) { on( 'InsertMany', Entry.DataSource ); }
	if ( Entry.Kind === 'Query' ) { on( 'FindMany2', Entry.DataSource ); }
	if ( Entry.Kind === 'Update' )
	{
		on( 'FindMany', Entry.DataSource );
		on( Entry.FirstOnly === true ? 'UpdateOne' : 'UpdateMany', Entry.DataSource );
	}
	if ( Entry.Kind === 'Delete' ) { on( Entry.FirstOnly === true ? 'DeleteOne' : 'DeleteMany', Entry.DataSource ); }
	if ( Entry.Kind === 'Process' && typeof Entry.DataSource === 'string' ) { on( 'FindMany2', Entry.DataSource ); }
	return does;
}


//---------------------------------------------------------------------
// Options:
//		Catalog        an AdapterCatalog
//		Env, Cwd       the environment and working directory
//		Binds, Sets    override tokens
//		FilePath       where the file is
//		jsongin, jsonproc   for the entry's findings

function PlanObject( Document, Name, Options )
{
	let options = is_object( Options ) ? Options : {};
	let catalog = options.Catalog;

	let item = Names.FindEntry( Document, Name );
	if ( item === null || item.Section !== 'Objects' ) { return null; }

	let definitions = Overrides.Apply( Document, options.Binds, options.Sets, options.Cwd, catalog ? catalog.PathSettings : null );

	let plan = {
		Name: Name,
		Kind: item.Entry.Kind,
		Findings: [],
		Tree: null,
		DataSources: [],
		Triggers: [],
	};

	let touched = [];
	let writes = [];
	let objects_reached = [];

	function touch( DataSource, Function_ )
	{
		if ( typeof DataSource !== 'string' ) { return; }
		if ( !touched.includes( DataSource ) ) { touched.push( DataSource ); }
		writes.push( { DataSource: DataSource, Function: Function_ } );
	}


	//---------------------------------------------------------------------
	function node_for( Entry, Stack )
	{
		let node = { Name: Entry.Name, Kind: Entry.Kind, Does: [] };
		if ( !objects_reached.includes( Entry.Name ) ) { objects_reached.push( Entry.Name ); }
		if ( Stack.includes( Entry.Name ) )
		{
			node.Repeats = true;
			return node;
		}
		let stack = Stack.concat( [ Entry.Name ] );

		let own = kind_functions( Entry );
		for ( let index = 0; index < own.length; index++ )
		{
			node.Does.push( own[ index ] );
			touch( own[ index ].DataSource, own[ index ].Function );
		}

		if ( Entry.Kind === 'Process' )
		{
			Names.WalkSteps( Entry.Steps, 'Steps', function ( Step, Operator )
			{
				if ( Operator !== '$call' || !is_object( Step.$call ) || typeof Step.$call.Name !== 'string' ) { return; }
				let call = Step.$call;

				if ( Names.HOST_FUNCTIONS.includes( call.Name ) )
				{
					let data_source = ( is_object( call.With ) && typeof call.With.DataSource === 'string' ) ? call.With.DataSource : null;
					if ( data_source !== null && data_source.startsWith( '$' ) )
					{
						node.Does.push( { Function: call.Name, DataSource: null, Computed: data_source } );
						return;
					}
					node.Does.push( { Function: call.Name, DataSource: data_source } );
					touch( data_source, call.Name );
					return;
				}

				let callee = Names.FindEntry( Document, call.Name );
				if ( callee === null || callee.Section !== 'Objects' )
				{
					node.Does.push( { Object: { Name: call.Name, Kind: null, Missing: true, Does: [] } } );
					return;
				}
				node.Does.push( { Object: node_for( callee.Entry, stack ) } );
			} );
		}

		if ( ( Entry.Kind === 'Query' || Entry.Kind === 'Process' ) && typeof Entry.Into === 'string' )
		{
			node.Does.push( { Function: 'InsertMany', DataSource: Entry.Into, Into: true } );
			touch( Entry.Into, 'InsertMany' );
		}
		return node;
	}

	plan.Tree = node_for( item.Entry, [] );


	// ***The findings are the file's findings about everything this run reaches***: the object,
	// every object it calls, and every data source it opens - an unset variable is on the data
	// source, and a dry run which hid it would not be much of a dry run.
	let scopes = [];
	objects_reached.concat( touched ).forEach( function ( Reached )
	{
		let found = Names.FindEntry( Document, Reached );
		if ( found !== null && !scopes.includes( found.Path ) ) { scopes.push( found.Path ); }
	} );
	plan.Findings = Validate.ValidateFile( Document, {
		jsongin: options.jsongin, jsonproc: options.jsonproc, Env: options.Env,
		CheckSettings: catalog ? catalog.ValidateSettings : undefined,
	} ).filter( function ( Finding )
	{
		return scopes.some( function ( Scope ) { return Finding.Path === Scope || Finding.Path.startsWith( Scope + '.' ); } );
	} );


	// The data sources, as this run would see them, with nothing opened.
	for ( let index = 0; index < touched.length; index++ )
	{
		let name = touched[ index ];
		let definition = definitions[ name ];
		if ( !definition )
		{
			plan.DataSources.push( { Name: name, Defined: false } );
			continue;
		}

		let variables = [];
		let references = Environment.References( definition );
		for ( let reference_index = 0; reference_index < references.length; reference_index++ )
		{
			let variable = references[ reference_index ].Name;
			if ( variables.some( function ( Item ) { return Item.Name === variable; } ) ) { continue; }
			variables.push( { Name: variable, Set: Environment.IsSet( options.Env, variable ) } );
		}

		plan.DataSources.push( {
			Name: name,
			Defined: true,
			AdapterName: definition.AdapterName,
			Installed: catalog ? catalog.Ensure( definition.AdapterName ) : null,
			Settings: Environment.Mask( is_object( definition.Settings ) ? definition.Settings : {} ),
			Environment: variables,
		} );
	}


	// The programmatic triggers which a write of this run would fire (13.3, 13.4).
	let triggers = Array.isArray( Document.Triggers ) ? Document.Triggers : [];
	for ( let index = 0; index < triggers.length; index++ )
	{
		let trigger = triggers[ index ];
		if ( !is_object( trigger ) || !Array.isArray( trigger.On ) ) { continue; }
		let process = Names.FindEntry( Document, trigger.Process );
		if ( process === null || process.Entry.Kind !== 'Process' ) { continue; }

		let watched = process.Entry.DataSource;
		let firing = writes.filter( function ( Write ) { return Write.DataSource === watched && trigger.On.includes( Names.OperationOf( Write.Function ) ); } );
		if ( firing.length === 0 ) { continue; }

		// On says which of the trigger's operations this run makes, in the file's own words.
		let operations = [];
		firing.forEach( function ( Write )
		{
			let operation = Names.OperationOf( Write.Function );
			if ( !operations.includes( operation ) ) { operations.push( operation ); }
		} );
		plan.Triggers.push( { Name: trigger.Name, Process: trigger.Process, DataSource: watched, On: operations } );
	}

	return plan;
}


//---------------------------------------------------------------------
module.exports = {
	PlanObject: PlanObject,
};
