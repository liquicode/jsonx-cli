# jsonx-cli

The jsonx command line: validate, plan, run and edit a `.jsonx` file.

A `.jsonx` file holds the data sources a piece of work uses, the operations on them, and the
triggers that run a process when data changes. The format is defined in
[the jsonx specification](docs/Jsonx-Specification.md). The examples below use its Appendix B, the
observatory file, saved as `observatory.jsonx`.

Requires Node 20 or later. From a checkout, run `npm install`, then `node bin/jsonx.js`.


## Choosing the file

Every command that reads a file finds it the same way:

1. `--file <path>` (or `-f`).
2. The `JSONX_FILE` environment variable.
3. The one `.jsonx` file in the current directory.

With none of these, or with more than one `.jsonx` file in the directory, the command stops and
says what it tried.


## Commands

| Command | What it does |
|---|---|
| `jsonx validate [name]` | Report the findings for the file, or for one entry. `--strict` fails on warnings too. |
| `jsonx plan <name>` | Show what running an object would do. Opens no data source. |
| `jsonx run <name>` | Run an object. `--input <json>` starts a Process that has no `DataSource`. |
| `jsonx trigger run <name>` | Run a trigger by hand: its Process over its data source. |
| `jsonx <noun> list` | List the entries of a kind. |
| `jsonx <noun> show <name>` | Show one entry. |
| `jsonx <noun> add --json <body>` | Add an entry. |
| `jsonx <noun> set <name> --json <body>` | Change fields of an entry. A field set to `null` is removed. |
| `jsonx <noun> remove <name>` | Remove an entry. Refused while anything refers to it. |
| `jsonx <noun> rename <name> <new-name>` | Rename an entry and every reference to it. |
| `jsonx datasource info <name>` | What the data source reports about itself. |
| `jsonx datasource describe <name>` | A JSON Schema inferred from the first rows, and those rows. `--rows` sets how many. |

The nouns are `datasource`, `query`, `insert`, `update`, `delete`, `process` and `trigger`.
`jsonx --help`, and `--help` after any command, lists every option.

```
jsonx validate --file observatory.jsonx
jsonx plan "Prepare the season"
jsonx run "Prepare the season"
```


## Output

***The result goes to standard output, and nothing else does.*** Progress, findings and the run
report go to standard error, so a result can be piped or redirected.

- `--output json` (the default) writes the result as indented JSON.
- `--output jsonl` writes one line per element of an array result.
- `--quiet` writes nothing to standard error.
- `--verbose`, on `run` and `trigger run`, adds what each storage call measured: the rows the
  data source returned and the rows kept.

A run report has one line per object, indented under the Process that called it, and a line for
each Process a trigger started:

```
Prepare the season  Process  ran once  9 ms
  Two telescopes  Insert  inserted 2  3 ms
  Three bookings  Insert  inserted 3  2 ms
    trigger [Note every long booking as it arrives] Note a long booking  Process  ran once for "b-1", into Notes  0 ms
  Confirm the bookings with good seeing  Update  selected 1, changed 1  1 ms
  Drop the cancelled bookings  Delete  removed 1  0 ms
  Assign a dome to each confirmed booking  Process  ran 1, into Assignments 1  1 ms
```


## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | The object ran and failed, or the file could not be read. |
| 2 | A mistake in the command: an unknown option, a name that is not in the file, no file found. |
| 3 | The file has errors, or an edit was refused. Nothing ran and nothing was written. |

***A file with errors runs nothing.*** `run`, `trigger run` and `datasource info` and `describe`
validate the whole file first. Warnings and notes do not stop them.


## Data sources for one run

`--bind` and `--set` point a data source somewhere else for one command. They change only data
sources the file already defines.

```
jsonx run "Prepare the season" --bind 'Bookings=jsonstor-jsonfile:{"Path":"bookings.json"}'
jsonx run "Prepare the season" --set 'Assignments.AdapterName=jsonstor-folder' --set 'Assignments.Settings.Path=assignments'
```

- `--bind Name=adapter` or `--bind Name=adapter:{settings}` replaces the adapter and its settings.
- `--set Name.Settings.Key=value` changes one setting. The value is read as JSON when it can be,
  and as a string otherwise. `--set Name.AdapterName=adapter` changes only the adapter.
- Both can be given more than once.

***A relative path in the file is relative to the file.*** A relative path typed in `--bind` or
`--set` is relative to the directory you run the command in. An absolute path, or a special value
such as `":memory:"`, is used as it is.

An adapter package is loaded only when a data source names it. Install the package for any
adapter other than `jsonstor-memory`, `jsonstor-jsonfile` and `jsonstor-folder`, which come with
jsonstor.


## Secrets

Write a setting as `${env:NAME}` to take it from the environment variable `NAME`:

```
{ "Name": "Assignments", "AdapterName": "jsonstor-postgres",
  "Settings": { "Server": "db.example.org", "Database": "season", "Table": "Assignments",
                "UserName": "season", "Password": "${env:ASSIGNMENTS_PASSWORD}" } }
```

The reference can sit inside a longer string. The value is read when the data source opens and is
never printed: `show`, `plan` and every report show the reference as written. `validate` warns
when a variable is not set; a run that opens the data source fails.


## Editing

`add` and `set` take the body as `--json`:

- `--json '{"Name": "..."}'` inline,
- `--json @body.json` from a file,
- `--json -` from standard input.

For an object noun, `add` fills in `Kind` from the noun. `set` merges the top-level fields you give
and removes any field set to `null`. It does not change a `Name` (use `rename`) or a `Kind`.

```
jsonx query add --json @find-notes.json
jsonx datasource rename Bookings Reservations
```

***An edit that would add an error is refused***, with the findings on standard error and the file
left as it was. An error the file already had does not block an edit, so a broken file can be
fixed one change at a time. `--force` makes the change anyway.

The file is rewritten with tab indentation. Fields jsonx does not know are kept.

***In Windows PowerShell 5.1***, double quotes inside an argument are removed before `jsonx` sees
them, so inline JSON arrives broken. Use `--json @file` or `--json -` there.


## A whole command as JSON

`--input-json <file>` reads an entire invocation from a JSON object, and `--input-json -` reads it
from standard input. `Command` names the command; every other key is named as the argument or
option is.

```
{ "Command": "datasource describe", "name": "Bookings", "rows": 5, "file": "observatory.jsonx" }
```

`--input-json` must be the only argument.


## Using the library

Everything the command line does is available from `require( '@liquicode/jsonx-cli' ).Library`.

```
const FS = require( 'fs' );
const { Library } = require( '@liquicode/jsonx-cli' );

async function main()
{
	let document = JSON.parse( FS.readFileSync( 'observatory.jsonx', 'utf8' ) );

	let findings = Library.Validate.ValidateFile( document );
	if ( findings.some( function ( Finding ) { return Finding.Severity === 'error'; } ) ) { throw new Error( 'The file has errors.' ); }

	let session = Library.Session.Session.NewSession( { Document: document, Path: 'observatory.jsonx', Env: process.env } );
	let report = await session.Run( 'Prepare the season' );
	await session.Release();

	console.log( report.Ok, report.Result );
}

main();
```

`types/jsonx-cli.d.ts` declares the whole library.
