'use strict';

/*
	The adapter settings inventory.

	***GENERATED FILE. Do not edit it.*** Written by build/build-adapter-catalog.js from
	jsonstor-docs/docs/data/adapters.js, the one place an adapter is described.

		npm run build-adapter-catalog
*/

module.exports = [
	{
		"AdapterName": "jsonstor-memory",
		"Description": "Documents are stored in memory and are not persisted to disk.",
		"Kind": "built-in",
		"Package": "@liquicode/jsonstor",
		"Settings": [
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "HostIndex",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Keep an index of identifiers, so a search by identifier does not read the whole collection. If something else writes the store, call `RefreshIndex()`."
			}
		],
		"Browser": true,
		"Targets": [
			{
				"Name": "jsonstor-memory",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-jsonfile",
		"Description": "Documents are cached in memory and persisted to a single json file.",
		"Kind": "built-in",
		"Package": "@liquicode/jsonstor",
		"Settings": [
			{
				"Name": "Path",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "Path to the json file storing the documents. Created on the first insert if it does not exist.",
				"Format": "path"
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "HostIndex",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Keep an index of identifiers, so a search by identifier does not read the whole collection. If something else writes the store, call `RefreshIndex()`."
			},
			{
				"Name": "AutoFlush",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "Write the whole file on every insert, update, replace, and delete."
			}
		],
		"Targets": [
			{
				"Name": "jsonstor-jsonfile",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-folder",
		"Description": "Each document is stored in its own file in a single folder.",
		"Kind": "built-in",
		"Package": "@liquicode/jsonstor",
		"Settings": [
			{
				"Name": "Path",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "Path to the folder storing the document files. Created on the first insert if it does not exist.",
				"Format": "path"
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "HostIndex",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Keep an index of identifiers, so a search by identifier does not read the whole collection. If something else writes the store, call `RefreshIndex()`."
			}
		],
		"Targets": [
			{
				"Name": "jsonstor-folder",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-mongodb",
		"Description": "Documents are stored on a MongoDB server.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-mongodb",
		"Settings": [
			{
				"Name": "ConnectionString",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The MongoDB connection string, e.g. `mongodb://localhost`."
			},
			{
				"Name": "DatabaseName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the database to use."
			},
			{
				"Name": "CollectionName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the collection to use."
			}
		],
		"Driver": {
			"Name": "mongodb",
			"Url": "https://github.com/mongodb/node-mongodb-native",
			"Description": "The official MongoDB driver for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-mongodb-v4.4",
				"Version": [
					4,
					4
				]
			},
			{
				"Name": "jsonstor-mongodb-v5.0",
				"Version": [
					5,
					0
				]
			},
			{
				"Name": "jsonstor-mongodb-v6.0",
				"Version": [
					6,
					0
				]
			},
			{
				"Name": "jsonstor-mongodb-v7.0",
				"Version": [
					7,
					0
				]
			},
			{
				"Name": "jsonstor-mongodb-v8.3",
				"Version": [
					8,
					3
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-excel",
		"Description": "Documents are stored in an Excel spreadsheet file.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-excel",
		"Settings": [
			{
				"Name": "Path",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "Path to the Excel or CSV file storing the data.",
				"Format": "path"
			},
			{
				"Name": "SheetName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the worksheet storing the data."
			},
			{
				"Name": "AutoFlush",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "Write the workbook on every insert, update, replace, and delete."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "HostIndex",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Keep an index of identifiers, so a search by identifier does not read the whole collection. If something else writes the store, call `RefreshIndex()`."
			}
		],
		"Driver": {
			"Name": "xlsx",
			"Url": "https://github.com/SheetJS/sheetjs",
			"Description": "The SheetJS spreadsheet reader and writer."
		},
		"Targets": [
			{
				"Name": "jsonstor-excel",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-mysql",
		"Description": "Documents are stored in a MySql database.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-mysql",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": false,
				"Default": "\"localhost\"",
				"Description": "The name or address of the MySql server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "3306",
				"Description": "The service port of the MySql server."
			},
			{
				"Name": "Database",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the database to use."
			},
			{
				"Name": "Table",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the table to use."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column to treat as the document identifier. Empty discovers it from the table: a column named `_id`, then an auto-increment key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The user to connect as."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "That user's password. Pass an empty string for none - the setting itself is required."
			},
			{
				"Name": "ModifySchema",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow the adapter to create the table, the `Columns` and the `PayloadColumn`. It never adds a column for a new document field."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Encrypt the connection with TLS. Off by default so that a local server connects; a hosted MySQL requires it on."
			},
			{
				"Name": "TrustServerCertificate",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "Accept a certificate the machine does not trust, which is what a local server presents. Turn this off wherever `Encrypt` is on and the certificate is a real one."
			},
			{
				"Name": "PayloadColumn",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column which stores the document as JSON text. Empty means none, and every field must have a column. Created if missing when `ModifySchema` is `true`."
			},
			{
				"Name": "PayloadSync",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Store the whole document in the payload, and copy fields into their columns for filtering. When `false`, the payload holds only fields without a column."
			},
			{
				"Name": "Columns",
				"Type": "ColumnDefinition[]",
				"Required": false,
				"Default": "[]",
				"Description": "Columns to create, as `{ Name, Type, Key }`. Used only when this adapter creates the table; afterwards the table itself is the authority."
			}
		],
		"Driver": {
			"Name": "mysql2",
			"Url": "https://github.com/sidorares/node-mysql2",
			"Description": "The MySql driver for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-mysql-v5.7",
				"Version": [
					5,
					7
				]
			},
			{
				"Name": "jsonstor-mysql-v8.0",
				"Version": [
					8,
					0
				]
			},
			{
				"Name": "jsonstor-mysql-v8.4",
				"Version": [
					8,
					4
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-sqlite",
		"Description": "Documents are stored in a Sqlite3 file.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-sqlite",
		"Settings": [
			{
				"Name": "Path",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "Path to the Sqlite database file. Pass `\":memory:\"` for a database which lives only as long as the storage does.",
				"Format": "path"
			},
			{
				"Name": "Table",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the table to use."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column to treat as the document identifier. Empty discovers it from the table: a column named `_id`, then an auto-increment key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "ModifySchema",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow the adapter to create the table, the `Columns` and the `PayloadColumn`. It never adds a column for a new document field."
			},
			{
				"Name": "PayloadColumn",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column which stores the document as JSON text. Empty means none, and every field must have a column. Created if missing when `ModifySchema` is `true`."
			},
			{
				"Name": "PayloadSync",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Store the whole document in the payload, and copy fields into their columns for filtering. When `false`, the payload holds only fields without a column."
			},
			{
				"Name": "Columns",
				"Type": "ColumnDefinition[]",
				"Required": false,
				"Default": "[]",
				"Description": "Columns to create, as `{ Name, Type, Key }`. Used only when this adapter creates the table; afterwards the table itself is the authority."
			}
		],
		"Driver": {
			"Name": "better-sqlite3",
			"Url": "https://github.com/WiseLibs/better-sqlite3",
			"Description": "The fastest and simplest Sqlite3 library for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-sqlite",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-postgres",
		"Description": "Documents are stored in a PostgreSql database.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-postgres",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": false,
				"Default": "\"localhost\"",
				"Description": "The name or address of the PostgreSql server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "5432",
				"Description": "The service port of the PostgreSql server."
			},
			{
				"Name": "Database",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the database to use. It must already exist; this adapter never creates a database."
			},
			{
				"Name": "Schema",
				"Type": "string",
				"Required": false,
				"Default": "\"public\"",
				"Description": "The schema holding the table. Every statement names it, so the connection's search path does not decide which table is used."
			},
			{
				"Name": "Table",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the table to use."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column to treat as the document identifier. Empty discovers it from the table: a column named `_id`, then an auto-increment key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The user to connect as."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "That user's password. Pass an empty string for none - the setting itself is required."
			},
			{
				"Name": "ModifySchema",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow the adapter to create the schema, the table, and the columns it is told to create. It never adds a column because a document had a field."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Encrypt the connection with TLS. Off by default, for a local server; a server which requires TLS needs it on."
			},
			{
				"Name": "TrustServerCertificate",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "Accept a certificate the machine does not trust, which is what a local server presents. Turn this off wherever `Encrypt` is on and the certificate is a real one."
			},
			{
				"Name": "PayloadColumn",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column which stores the document as JSON text. Empty means none, and every field must have a column. Created if missing when `ModifySchema` is `true`."
			},
			{
				"Name": "PayloadSync",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Store the whole document in the payload, and copy fields into their columns for filtering. When `false`, the payload holds only fields without a column."
			},
			{
				"Name": "PayloadPushdown",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Let a criteria on a field with no column of its own be answered from the payload, and create a `GIN` index to answer it with. Requires the payload column to hold JSON. See the notes."
			},
			{
				"Name": "Columns",
				"Type": "ColumnDefinition[]",
				"Required": false,
				"Default": "[]",
				"Description": "Columns to create, as `{ Name, Type, Key }`. Used only when this adapter creates the table; afterwards the table itself is the authority."
			}
		],
		"Driver": {
			"Name": "pg",
			"Url": "https://github.com/brianc/node-postgres",
			"Description": "The PostgreSql driver for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-postgres-v10.21",
				"Version": [
					10,
					21
				]
			},
			{
				"Name": "jsonstor-postgres-v14.24",
				"Version": [
					14,
					24
				]
			},
			{
				"Name": "jsonstor-postgres-v16.15",
				"Version": [
					16,
					15
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-duckdb",
		"Description": "Documents are stored in a DuckDB database.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-duckdb",
		"Settings": [
			{
				"Name": "Database",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The database to open: a file path, or `\":memory:\"` for one which lives only as long as the storage.",
				"Format": "path"
			},
			{
				"Name": "Schema",
				"Type": "string",
				"Required": false,
				"Default": "\"main\"",
				"Description": "The schema holding the table. Every statement names it, so the connection's search path does not decide which table is used."
			},
			{
				"Name": "Table",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the table to use."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column to treat as the document identifier. Empty discovers it from the table: a column named `_id`, then an auto-increment key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "ModifySchema",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow the adapter to create the schema, the sequence, the table, and the columns it is told to create. It never adds a column because a document had a field."
			},
			{
				"Name": "PayloadColumn",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column which stores the document as JSON text. Empty means none, and every field must have a column. Created if missing when `ModifySchema` is `true`."
			},
			{
				"Name": "PayloadSync",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Store the whole document in the payload, and copy fields into their columns for filtering. When `false`, the payload holds only fields without a column."
			},
			{
				"Name": "Columns",
				"Type": "ColumnDefinition[]",
				"Required": false,
				"Default": "[]",
				"Description": "Columns to create, as `{ Name, Type, Key }`. Used only when this adapter creates the table; afterwards the table itself is the authority."
			}
		],
		"Driver": {
			"Name": "@duckdb/node-api",
			"Url": "https://github.com/duckdb/duckdb-node-neo",
			"Description": "The official DuckDB client for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-duckdb",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-oracle",
		"Description": "Documents are stored in an Oracle database.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-oracle",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": false,
				"Default": "\"localhost\"",
				"Description": "The name or address of the Oracle server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "1521",
				"Description": "The listener port of the Oracle server."
			},
			{
				"Name": "Database",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The service name to connect to, which is the last part of the `host:port/service` connect string. It must already exist; this adapter never creates one."
			},
			{
				"Name": "Schema",
				"Type": "string",
				"Required": false,
				"Default": "the `UserName`, upper cased",
				"Description": "The schema holding the table. A schema is a user in Oracle, so this is an account name and it must already exist."
			},
			{
				"Name": "Table",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the table to use."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column to treat as the document identifier. Empty discovers it from the table: a column named `_id`, then an auto-increment key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The user to connect as."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "That user's password. Pass an empty string for none - the setting itself is required."
			},
			{
				"Name": "ModifySchema",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow the adapter to create the table and the columns it is told to create. It never creates a schema, and never adds a column because a document had a field."
			},
			{
				"Name": "PayloadColumn",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column which stores the document as JSON text, as a `CLOB`. Empty means none, and then every field must already be a column. Created when missing if `ModifySchema` is `true`."
			},
			{
				"Name": "PayloadSync",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Store the whole document in the payload, and copy fields into their columns for filtering. When `false`, the payload holds only fields without a column."
			},
			{
				"Name": "Columns",
				"Type": "ColumnDefinition[]",
				"Required": false,
				"Default": "[]",
				"Description": "Columns to create, as `{ Name, Type, Key }`. Used only when this adapter creates the table; afterwards the table itself is the authority."
			}
		],
		"Driver": {
			"Name": "oracledb",
			"Url": "https://github.com/oracle/node-oracledb",
			"Description": "The Oracle Database driver for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-oracle-v18.0",
				"Version": [
					18,
					0
				]
			},
			{
				"Name": "jsonstor-oracle-v21.3",
				"Version": [
					21,
					3
				]
			},
			{
				"Name": "jsonstor-oracle-v23.26",
				"Version": [
					23,
					26
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-mssql",
		"Description": "Documents are stored in a Microsoft SQL Server database.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-mssql",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": false,
				"Default": "\"localhost\"",
				"Description": "The name or address of the SQL Server instance."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "1433",
				"Description": "The service port of the SQL Server instance."
			},
			{
				"Name": "Database",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the database to use. It must already exist; this adapter never creates a database."
			},
			{
				"Name": "Schema",
				"Type": "string",
				"Required": false,
				"Default": "\"dbo\"",
				"Description": "The schema holding the table. Every statement names it, so the connection's default schema does not decide which table is used."
			},
			{
				"Name": "Table",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name of the table to use."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column to treat as the document identifier. Empty discovers it from the table: a column named `_id`, then an auto-increment key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The user to connect as."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "That user's password. Pass an empty string for none - the setting itself is required."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Encrypt the connection. The driver defaults this to `true`, which a server presenting a self-signed certificate refuses; this adapter defaults it to `false` so a local server connects, and a real one should turn it on."
			},
			{
				"Name": "TrustServerCertificate",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "Accept a certificate the machine does not trust. Turn this off wherever `Encrypt` is on and the certificate is a real one."
			},
			{
				"Name": "ModifySchema",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow the adapter to create the schema, the table, and the columns it is told to create. It never adds a column because a document had a field."
			},
			{
				"Name": "PayloadColumn",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The column which stores the document as JSON text, as an `NVARCHAR(MAX)`. Empty means none, and then every field must already be a column. Created when missing if `ModifySchema` is `true`."
			},
			{
				"Name": "PayloadSync",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Store the whole document in the payload, and copy fields into their columns for filtering. When `false`, the payload holds only fields without a column."
			},
			{
				"Name": "Columns",
				"Type": "ColumnDefinition[]",
				"Required": false,
				"Default": "[]",
				"Description": "Columns to create, as `{ Name, Type, Key }`. Used only when this adapter creates the table; afterwards the table itself is the authority."
			}
		],
		"Driver": {
			"Name": "mssql",
			"Url": "https://github.com/tediousjs/node-mssql",
			"Description": "The Microsoft SQL Server client for Node."
		},
		"Targets": [
			{
				"Name": "jsonstor-mssql-v14.0",
				"Version": [
					14,
					0
				]
			},
			{
				"Name": "jsonstor-mssql-v15.0",
				"Version": [
					15,
					0
				]
			},
			{
				"Name": "jsonstor-mssql-v16.0",
				"Version": [
					16,
					0
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-leveldb",
		"Description": "Documents are stored in a LevelDB store.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-leveldb",
		"Settings": [
			{
				"Name": "Path",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "Path to the folder holding the LevelDB store. It is created if it does not exist.",
				"Format": "path"
			},
			{
				"Name": "CollectionName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The collection this storage reads and writes. One store holds as many collections as you name."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			}
		],
		"Driver": {
			"Name": "classic-level",
			"Url": "https://github.com/Level/classic-level",
			"Description": "The LevelDB binding for Node, maintained by the Level community."
		},
		"Targets": [
			{
				"Name": "jsonstor-leveldb",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-redis",
		"Description": "Documents are stored on a Redis or Valkey server.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-redis",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name or address of the Redis or Valkey server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "6379",
				"Description": "The service port of the server."
			},
			{
				"Name": "Database",
				"Type": "number",
				"Required": false,
				"Default": "0",
				"Description": "Which of the server's numbered databases to use. A server offers sixteen by default and `0` is the one a client gets without asking."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The user to connect as. Empty means none, and is what a server with no ACL expects."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "That user's password. Empty means none."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Encrypt the connection with TLS. Off by default so that a local server connects; a hosted Redis or Valkey requires it on."
			},
			{
				"Name": "TrustServerCertificate",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "Accept a certificate the machine does not trust, which is what a local server presents. Turn this off wherever `Encrypt` is on and the certificate is a real one."
			},
			{
				"Name": "CollectionName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The collection this storage reads and writes. It is the name of the single hash which holds the collection's documents."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			}
		],
		"Driver": {
			"Name": "redis",
			"Url": "https://github.com/redis/node-redis",
			"Description": "The Redis driver for Node. It speaks RESP, so it reaches a Valkey server too."
		},
		"Targets": [
			{
				"Name": "jsonstor-redis-v6.2",
				"Version": [
					6,
					2
				]
			},
			{
				"Name": "jsonstor-redis-v7.2",
				"Version": [
					7,
					2
				]
			},
			{
				"Name": "jsonstor-redis-v8.10",
				"Version": [
					8,
					10
				]
			},
			{
				"Name": "jsonstor-valkey-v7.2",
				"Version": [
					7,
					2
				]
			},
			{
				"Name": "jsonstor-valkey-v8.1",
				"Version": [
					8,
					1
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-couchdb",
		"Description": "Documents are stored on a CouchDB server.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-couchdb",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name or address of the CouchDB server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "5984",
				"Description": "The service port of the server."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Reach the server over `https` rather than `http`. There is no `TrustServerCertificate` beside it, because this adapter has no driver except the global `fetch`, which offers no supported way to relax certificate verification. See the notes."
			},
			{
				"Name": "DatabaseName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The CouchDB database this storage reads and writes. It is the collection: one database holds one collection's documents."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The document field which is the identifier. Its value becomes the CouchDB `_id`, so name the field a database you already have is keyed on. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "PayloadField",
				"Type": "string",
				"Required": false,
				"Default": "\"jsonstor_document\"",
				"Description": "The field which stores the document. Empty means none, and then the document *is* the CouchDB document - which is what a database you already have looks like. See the notes."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The user to connect as. Empty means none, which only a CouchDB 2.x server with no administrator will accept."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "That user's password. Empty means none."
			}
		],
		"Targets": [
			{
				"Name": "jsonstor-couchdb-v2.3",
				"Version": [
					2,
					3
				]
			},
			{
				"Name": "jsonstor-couchdb-v3.5",
				"Version": [
					3,
					5
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-elasticsearch",
		"Description": "Documents are stored on an Elasticsearch or OpenSearch server.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-elasticsearch",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name or address of the Elasticsearch or OpenSearch server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "9200",
				"Description": "The service port of the server."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Reach the server over `https` rather than `http`. There is no `TrustServerCertificate` beside it, because this adapter has no driver except the global `fetch`, which offers no supported way to relax certificate verification."
			},
			{
				"Name": "IndexName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The index this storage reads and writes. It is the collection: one index holds one collection's documents."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The document field which is the identifier. Its value becomes the Elasticsearch `_id`. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "PayloadField",
				"Type": "string",
				"Required": false,
				"Default": "\"jsonstor_document\"",
				"Description": "The field which stores the document. It cannot be empty: Elasticsearch reserves `_id` as a metadata field, so a document carrying this family's default identifier field cannot be stored at the top level. See the notes."
			},
			{
				"Name": "Mappings",
				"Type": "array",
				"Required": false,
				"Default": "[]",
				"Description": "The payload fields to give an explicit mapping, as `{ Name, Type }` and optionally `NullValue`. Only a mapped field can be searched on the server; everything else is stored, returned, and filtered by `jsongin`. See the notes."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The user to connect as. Empty means none, which is what a server with security disabled expects."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "That user's password. Empty means none."
			}
		],
		"Targets": [
			{
				"Name": "jsonstor-elasticsearch-v7.17",
				"Version": [
					7,
					17
				]
			},
			{
				"Name": "jsonstor-elasticsearch-v8.19",
				"Version": [
					8,
					19
				]
			},
			{
				"Name": "jsonstor-elasticsearch-v9.5",
				"Version": [
					9,
					5
				]
			},
			{
				"Name": "jsonstor-opensearch-v1.3",
				"Version": [
					1,
					3
				]
			},
			{
				"Name": "jsonstor-opensearch-v2.19",
				"Version": [
					2,
					19
				]
			},
			{
				"Name": "jsonstor-opensearch-v3.8",
				"Version": [
					3,
					8
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-dynamodb",
		"Description": "Documents are stored in an Amazon DynamoDB table.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-dynamodb",
		"Settings": [
			{
				"Name": "TableName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The table this storage reads and writes. It is the collection: one table holds one collection's documents."
			},
			{
				"Name": "Region",
				"Type": "string",
				"Required": false,
				"Default": "\"us-east-1\"",
				"Description": "The AWS region. Used to resolve the service endpoint when `Endpoint` and `Server` are both empty."
			},
			{
				"Name": "Endpoint",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "A full URL to reach instead of the region's service endpoint. Overrides `Server` and `Port`; name it to reach DynamoDB Local or a VPC endpoint."
			},
			{
				"Name": "Server",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The name or address of a local server, as a shorthand for `Endpoint`. Empty means reach AWS itself."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "8000",
				"Description": "That server's port. DynamoDB Local listens on 8000."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Build the `Server` URL with `https` rather than `http`. Ignored when `Endpoint` names a scheme of its own."
			},
			{
				"Name": "AccessKeyId",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The access key to sign with. Empty leaves the SDK to find credentials the way it normally does - the environment, a shared profile, or an instance role."
			},
			{
				"Name": "SecretAccessKey",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "That key's secret."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The document field which is the identifier. `String()` of its value becomes the table's partition key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "PayloadField",
				"Type": "string",
				"Required": false,
				"Default": "\"jsonstor_document\"",
				"Description": "The item attribute which stores the document. It cannot be empty, and it cannot be `jsonstor_key` or `jsonstor_sequence`. See the notes."
			},
			{
				"Name": "Attributes",
				"Type": "array",
				"Required": false,
				"Default": "[]",
				"Description": "The payload fields declared to hold a scalar, as `{ Name, Type }` where `Type` is `string`, `number` or `boolean`. This is a promise that the field never holds an array, and it is what lets `$gt` and its siblings be pushed down. See the notes."
			}
		],
		"Driver": {
			"Name": "@aws-sdk/client-dynamodb",
			"Url": "https://github.com/aws/aws-sdk-js-v3",
			"Description": "The official AWS SDK for JavaScript. `@aws-sdk/util-dynamodb` travels with it and versions separately."
		},
		"Targets": [
			{
				"Name": "jsonstor-dynamodb",
				"Version": null
			}
		]
	},
	{
		"AdapterName": "jsonstor-couchbase",
		"Description": "Documents are stored in a Couchbase bucket.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-couchbase",
		"Settings": [
			{
				"Name": "Server",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The name or address of the Couchbase server."
			},
			{
				"Name": "Port",
				"Type": "number",
				"Required": false,
				"Default": "8093",
				"Description": "The query service port. This adapter speaks to the query service and to nothing else, so no other port is needed."
			},
			{
				"Name": "Encrypt",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Reach the query service over `https` rather than `http`. There is no `TrustServerCertificate` beside it, because this adapter has no driver except the global `fetch`, which offers no supported way to relax certificate verification."
			},
			{
				"Name": "BucketName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The bucket this storage reads and writes. It must already exist; this adapter never creates one. See the notes."
			},
			{
				"Name": "CollectionName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "The key range within the bucket which is this collection. It cannot contain a colon. See the notes."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The document field which is the identifier. `String()` of its value becomes the Couchbase document key. `IdField` is the former spelling and still works."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "UserName",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "The user to connect as. Empty means none."
			},
			{
				"Name": "Password",
				"Type": "string",
				"Required": false,
				"Default": "\"\"",
				"Description": "That user's password. Empty means none."
			}
		],
		"Targets": [
			{
				"Name": "jsonstor-couchbase-v5.0",
				"Version": [
					5,
					0
				]
			},
			{
				"Name": "jsonstor-couchbase-v8.0",
				"Version": [
					8,
					0
				]
			}
		]
	},
	{
		"AdapterName": "jsonstor-browser",
		"Description": "The browser storages: local storage, the Origin Private File System, and IndexedDB.",
		"Kind": "external",
		"Package": "@liquicode/jsonstor-browser",
		"Settings": [
			{
				"Name": "Key",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "***`jsonstor-browser-localstorage` only.*** The `localStorage` key this collection is stored under. One key holds one collection; name a second key for a second collection."
			},
			{
				"Name": "Path",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "***`jsonstor-browser-opfs` only.*** The path within the Origin Private File System holding this collection. Folders along it are created as needed."
			},
			{
				"Name": "DatabaseName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "***`jsonstor-browser-indexeddb` only.*** The IndexedDB database holding this collection. It is created if it does not exist."
			},
			{
				"Name": "CollectionName",
				"Type": "string",
				"Required": true,
				"Default": "-",
				"Description": "***`jsonstor-browser-indexeddb` only.*** The object store this storage reads and writes. One database holds as many collections as you name."
			},
			{
				"Name": "AutoFlush",
				"Type": "boolean",
				"Required": false,
				"Default": "true",
				"Description": "***The two blob storages only.*** Write the collection out after every insert, update, replacement or delete. Turn it off to batch a run of writes and call `FlushStorage()` yourself. `jsonstor-browser-indexeddb` writes a record at a time and has nothing to flush."
			},
			{
				"Name": "PrimaryKey",
				"Type": "string",
				"Required": false,
				"Default": "\"_id\"",
				"Description": "The field which holds the identifier. Set it to the key field of an existing store."
			},
			{
				"Name": "PrimaryKeyMutable",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "Allow an update or replacement to change the identifier. When `false`, such an operation is refused."
			},
			{
				"Name": "HostIndex",
				"Type": "boolean",
				"Required": false,
				"Default": "false",
				"Description": "***The two blob storages only.*** Hold an index over the identifier, so a lookup by it costs one entry rather than the whole collection. Off by default, because an index over a store something else writes goes stale - call `RefreshIndex()` when it might have. `jsonstor-browser-indexeddb` hosts its own index and takes no such setting."
			}
		],
		"Browser": true,
		"Targets": [
			{
				"Name": "jsonstor-browser-localstorage",
				"Version": null
			},
			{
				"Name": "jsonstor-browser-opfs",
				"Version": null
			},
			{
				"Name": "jsonstor-browser-indexeddb",
				"Version": null
			}
		]
	}
];
