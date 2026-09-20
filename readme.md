# jsonx-cli

The jsonx command line: validate, plan, run, debug and edit a `.jsonx` file, work with the
documents in its data sources, use jsongin on its own, serve the file to programs over HTTP, a
WebSocket or MCP, and work with it in a terminal interface or a browser.

A `.jsonx` file holds the data sources a piece of work uses, the operations on them, and the
triggers that run a process when data changes. The format is defined in
[the jsonx specification](docs/Jsonx-Specification.md). The examples below use its Appendix B, the
observatory file, saved as `observatory.jsonx`.

Requires Node 22 or later. From a checkout, run `npm install`, then `node bin/jsonx.js`.


## Choosing the file

Every command that reads a file finds it the same way:

1. `--file <path>` (or `-f`).
2. The `JSONX_FILE` environment variable.
3. The one `.jsonx` file in the current directory.

With none of these, or with more than one `.jsonx` file in the directory, the command stops and
says what it tried. `engine`, `adapters`, `new` and `completion` read no file, and refuse `--file`.


## Commands

| Command | What it does |
|---|---|
| `jsonx validate [name]` | Report the findings for the file, for one entry, or for a draft given as `--json`. `--strict` fails on warnings too. |
| `jsonx plan [name]` | Show what running an object, or a draft given as `--json`, would do. Opens no data source. |
| `jsonx run [name]` | Run an object, or a draft given as `--json`. `--input <json>` starts a Process that has no `DataSource`. |
| `jsonx trigger run <name>` | Run a trigger by hand: its Process over its data source. |
| `jsonx explain [name]` | Say in English what a data source, object or trigger does, or a draft given as `--json`. |
| `jsonx debug <process>` | Step through a Process, one command at a time. |
| `jsonx <noun> list` | List the entries of a kind. |
| `jsonx <noun> show <name>` | Show one entry. |
| `jsonx <noun> add --json <body>` | Add an entry. |
| `jsonx <noun> set <name> --json <body>` | Change fields of an entry. A field set to `null` is removed. |
| `jsonx <noun> remove <name>` | Remove an entry. Refused while anything refers to it. |
| `jsonx <noun> rename <name> <new-name>` | Rename an entry and every reference to it. |
| `jsonx datasource info <name>` | What the data source reports about itself. |
| `jsonx datasource describe <name>` | A JSON Schema inferred from the first rows, and those rows. `--rows` sets how many. |
| `jsonx datasource <verb> <name>` | Read and write the documents in a data source. See below. |
| `jsonx engine <verb>` | Query, sort, update and validate documents with jsongin, with no file. |
| `jsonx adapters list` | Every adapter, and whether it is installed. |
| `jsonx adapters info <name>` | An adapter's package, driver, settings, and the names it answers to. |
| `jsonx adapters settings <name>` | A data source entry for an adapter, ready to add. |
| `jsonx new <kind>` | A skeleton to start from: a file, or one entry. |
| `jsonx format` | Rewrite the file in canonical order. `--check` only reports. |
| `jsonx completion <shell>` | The completion script for `bash`, `zsh` or `powershell`. |
| `jsonx serve --api` | Serve the file's commands over HTTP and a WebSocket until stopped. See [Serving the file](#serving-the-file). |
| `jsonx serve --ui` | The same, and the Web UI for a browser. See [The Web UI](#the-web-ui). |
| `jsonx mcp` | Serve the file's commands as MCP tools, over standard input and output or `--http`. |
| `jsonx tui` | Work with the file in a terminal interface. See [The terminal interface](#the-terminal-interface). |

The nouns are `datasource`, `query`, `insert`, `update`, `delete`, `process` and `trigger`.
`data` is another name for `datasource`. `jsonx --help`, and `--help` after any command, lists
every option.

```
jsonx validate --file observatory.jsonx
jsonx plan "Prepare the season"
jsonx run "Prepare the season"
jsonx explain "Prepare the season"
```


## Output

***The result goes to standard output, and nothing else does.*** Progress, findings and the run
report go to standard error, so a result can be piped or redirected.

- `--output json` (the default) writes the result as indented JSON.
- `--output jsonl` writes one line per element of an array result.
- `--output text` writes the result for reading: `Key: value` lines, and lists one item per line.
- `--output table` writes a list of documents as columns. A cell longer than 40 characters is cut
  short. Anything that is not a list of documents is written as text.
- `--quiet` writes nothing to standard error.
- `--verbose`, on a command that runs something, adds what each storage call measured: the rows
  the data source returned and the rows kept.
- `--trace`, on a command that runs something, adds every storage call with its parameters and its
  result.

Use `json` or `jsonl` when a program reads the output.

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

```
jsonx run "Prepare the season" --output table --quiet
```

```
Booking  Observer   Dome
-------  ---------  ----
b-1      R. Okafor  B
```


## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | What ran failed, a debug was stopped before it finished, `format --check` found a change, the file could not be read, a server could not use its port, or `tui` could not reach its process. |
| 2 | A mistake in the command: an unknown option, a name that is not in the file, no file found, a change refused for want of `--yes`, a server address other than loopback with no token, or `tui --url` reaching a jsonx of another version. |
| 3 | The file has errors, an edit was refused or `--check` found it would add an error, or jsongin refused a criteria, update or schema. Nothing ran and nothing was written. |

***A file with errors runs nothing.*** Every command that opens a data source validates the whole
file first. Warnings and notes do not stop it.


## Reading and writing documents

`jsonx datasource <verb> <name>` works on the documents in a data source the file defines. Each verb
takes its values as options; a JSON value is inline, `@file`, or `-` for standard input.

| Verb | Options | What it does |
|---|---|---|
| `find` | `--criteria`, `--projection`, `--sort`, `--skip`, `--max`, `--into` | Read documents. |
| `find-one` | `--criteria`, `--projection` | Read the first document, or `null`. |
| `count` | `--criteria` | Count documents. |
| `join` | `--with`, `--on`, `--type`, `--as`, `--criteria`, `--with-criteria` | Match two data sources against each other. |
| `union` | `--with`, `--criteria`, `--with-criteria` | Read two data sources, one set after the other. |
| `insert` | `--documents` | Insert one document or an array of them. |
| `update` | `--criteria`, `--update`, `--first-only`, `--changes` | Change documents. |
| `replace` | `--criteria`, `--document` | Replace the first document selected. |
| `delete` | `--criteria`, `--first-only` | Remove documents. |
| `flush` | | Write out what the adapter holds in memory. |
| `drop` | | Remove the whole store. |
| `refresh-index` | | Rebuild the index jsonstor keeps for the store. |
| `ping` | | Open the data source and count its documents. |

```
jsonx data find Bookings --criteria @long-nights.json --sort @by-night.json --max 10
jsonx data count Bookings --criteria @long-nights.json
```

`--max 0` reads every document.

`join` and `union` are the only verbs which read two data sources. `--with` names the second one.
`--criteria` keeps the meaning it has in every other verb here — which documents to read — on the
first side, and `--with-criteria` does the same for the second. The join criteria is `--on`, where
`$$Left` is the document being joined from and a field path such as `$Name` is a field of the
document it is tested against.

```
jsonx data join Readings --with Domes --on @by-dome.json --as Dome
jsonx data union Readings --with Archive --criteria @this-season.json
```

`--type` is `Left`, `Inner`, `Right` or `Outer`. `--as` names the field the matches are written
to, as an array; without it they are merged into the document instead, and ***a field both
documents carry takes the match's value*** — including `_id`, which is the reason to give `--as` a
name of its own. Either way one document in is one document out, and `union` removes nothing.

The report names both reads: the join is the outer line and the second data source's read sits
under it. `jsonx engine join` and `jsonx engine union` do the same two things over documents given
on the command line, with no file and no data source.

`find`, `insert`, `update` and `delete` run exactly as a Query, Insert, Update or Delete in the file
would: the same result, the same report line (named `(ad hoc)`), and the same triggers fire. The
object is checked against the file's rules first, so a criteria jsongin refuses stops the command
before anything opens.

***An `update` or `delete` whose criteria selects every document needs `--yes`***, and so does
every `drop`. A criteria of `{}` or `null` selects every document.

`--save <name>` stores the command in the file as an object of that name, and runs nothing:

```
jsonx data find Bookings --criteria @long-nights.json --save "Long nights"
jsonx run "Long nights"
```

A save is checked like `add`: refused when it would add an error, unless `--force`. `--save` is
available on `find`, `insert`, `update` and `delete`.

`--changes`, on `update` and on `run` of an Update, adds each document the update changed to the
result, as it was before and after:

```
jsonx data update Bookings --criteria @b-2.json --update @confirm.json --changes
```

```
{ "Selected": 1, "Changed": 1,
  "Changes": [ { "Before": { "_id": "b-2", ..., "Status": "requested" },
                 "After":  { "_id": "b-2", ..., "Status": "confirmed" } } ] }
```

When nothing was selected, `Changes` is `[]`. When the selected documents carry no primary key
value, a changed document cannot be matched to the one it was before, and `Changes` is left out.


## Explaining

`jsonx explain <name>` says in English what an entry does, without opening anything:

```
jsonx explain "Assign a dome to each confirmed booking" --output text --quiet
```

```
Name: Assign a dome to each confirmed booking
Kind: Process
Lines:
  For each document in "Bookings" where Status is "confirmed", run these steps from { Document }, and insert each object it returns into "Assignments":
  1. Call FindOne on "Telescopes" where Name is $Document.Telescope, and put the answer at "Telescope".
  2. Finish, answering a document with Booking as $Document._id, Observer as $Document.Observer and Dome as $Telescope.Site.Dome.
```


## An object that is not in the file

`validate`, `plan`, `explain` and `run` take `--json <object>` in place of a name. The object is
treated exactly as the file's entry of its kind would be, and nothing is written: `run --json` runs
it unsaved.

```
jsonx validate --json @confirm.json
jsonx plan --json @confirm.json
jsonx explain --json @confirm.json
jsonx run --json @confirm.json --changes
```

An object with a `Kind` is checked as an object; one with `AdapterName` and no `Kind` as a data
source; one with `Process` and neither as a trigger. Its findings are pathed `Draft`, so
`Draft.Update` is the draft's `Update`. A draft with no `Name` is named `(ad hoc)`.

```
jsonx validate --json @empty.json
```

```
[ { "Severity": "warning", "Path": "Draft.Update", "Message": "This Update's update document is empty, so it changes nothing (10.2)." } ]
```

A draft whose `Name` is already in the file is checked in that entry's place, and a note says so;
neither is an error. ***`run --json` checks the draft first, and a draft with an error runs nothing***
(exit 3). Give a name or `--json`, not both.


## Debugging a Process

`jsonx debug <process>` reads one command per line from standard input, and writes one JSON line
per command to standard output: where the Process is, the step it is on in English, its state, and
the call it is waiting on.

| Command | What it does |
|---|---|
| `step` | Take one step. At a call, run the call and go on. |
| `into` | At a call to a Process, step through that Process too. |
| `continue` | Run until the next call, or until this Process finishes. |
| `decline` | Fail the waiting call without running it, and show what it would have done. |
| `answer <json>` | Give the waiting call this answer without running it. |
| `state` | Show where the Process is again. |
| `skip` | Leave this document, and go on to the next. |
| `quit` | Stop. |

`step` onto a call shows the call waiting; the next `step` runs it. `decline`, `answer` and `into`
act on a waiting call. A declined call fails the step, so a `$try` around it catches the failure.

```
jsonx debug "Prepare the season"
```

The debug keeps its data sources open from the first command to the last, so a memory store keeps
what earlier steps wrote. It ends when the Process finishes, on `quit`, or at the end of input, and
the run report goes to standard error then. It exits 0 when the Process finished, and 1 otherwise.
The last line carries the result. Because standard input carries the commands, no option value can
be read from `-` here; use `@file`.


## jsongin without a file

`jsonx engine <verb>` runs jsongin on documents given on the command line, in a file, or on
standard input. Documents are `--documents <json>` (one document or an array) or
`--documents-jsonl <jsonl>` (one document per line).

| Verb | What it answers |
|---|---|
| `match --document --criteria` | Whether the document matches: `true` or `false`. |
| `filter --criteria` | The documents that match. |
| `sort --sort` | The documents in order. |
| `project --projection` | Each document through a projection. |
| `update --update` | Each document with an update applied. |
| `diff --before --after` | The update that turns one document into the other. |
| `invert --before --patch` | The update that undoes a patch. |
| `distinct --fields` | The distinct combinations of some fields. |
| `join --with --criteria [--type] [--as]` | Each document with what it matched in a second set. |
| `union --with` | One set of documents after another. |
| `evaluate --expression [--document]` | The value of an expression. |
| `aggregate --pipeline [--scope]` | The documents through an aggregation pipeline. |
| `validate-query --criteria` | The findings for a criteria: `[]` when it is accepted. |
| `flatten`, `expand` | Each document with dotted field names, or nested again. |
| `merge --document --with` | One document merged over another. |
| `get --path` | The value at a dotted path in each document. |
| `operators [family]` | The operator names: `query`, `update`, `expression`, `stage` or `accumulator`. |
| `schema infer` | A JSON Schema inferred from the documents. |
| `schema validate --schema` | The findings for each document against a schema: `[]` when all are valid. |
| `schema init --schema [--document]` | A document filled in with the schema's defaults. |
| `schema project --schema` | Each document with only the fields the schema declares. |

```
jsonx engine filter --documents-jsonl @rows.jsonl --criteria @long-nights.json --output jsonl
jsonx engine schema infer --documents - < rows.json
jsonx engine join --documents-jsonl @rows.jsonl --with @domes.json --criteria @by-dome.json --as Dome
```

`join` and `union` read the second set of documents from `--with`, which is one document or an
array of them. A join criteria is matched against each pair: `$$Left` is the document being joined
from, and a field path such as `$Name` is a field of the document it is tested against, so
`{ "$expr": { "$eq": [ "$Name", "$$Left.Dome" ] } }` reads "the dome whose name this row names".
`--type` is `Left`, `Inner`, `Right` or `Outer`; `--as` names the field the matches are written
to, as an array, and without it they are merged into the document instead. Either way one document
in is one document out. `union` removes nothing, so two identical documents both come back.

`$lookup`, `$unionWith` and `$graphLookup` take the documents they join with rather than the name
of a collection, since jsongin has no collections. Write them into the stage, or bind them with
`--scope` and name them there:

```
jsonx engine aggregate --documents-jsonl @rows.jsonl --scope @domes-named.json --pipeline @with-dome.json
```

Given one document, a verb answers for one document; given an array, it answers an array. A criteria,
update or projection that jsongin refuses is reported on standard error with exit 3, even when there
are no documents.


## Adapters

```
jsonx adapters list
jsonx adapters info jsonstor-mysql-v8.4
jsonx adapters settings jsonstor-sqlite --data-source Local
```

`list` shows every adapter package and whether it is installed here. `info` takes a package's name
or any name it answers to, and lists those names: the ones with their own dialect first, then the
others with the dialect each one uses and the server version it was measured against. The names are
read from the installed package, so a package that is not installed shows its settings only.

`settings` writes a data source entry with every required setting and every setting that has a
default. It can go straight into the file:

```
jsonx adapters settings jsonstor-jsonfile --data-source Local | jsonx datasource add --json -
```


## Starting and formatting a file

`jsonx new <kind>` writes a skeleton: `file`, `datasource`, `query`, `insert`, `update`, `delete`,
`process` or `trigger`. `--name` sets its Name. A `new file` skeleton validates with no errors, and
the entry skeletons use the `Store` data source it defines, so each one can be added to it:

```
jsonx new file --name Inventory > inventory.jsonx
jsonx new query --name "Recent rows" | jsonx query add --json -
```

***In Windows PowerShell 5.1, save a skeleton with `Out-File -Encoding utf8`***, not `>`, which can
write UTF-16. jsonx reads UTF-8, with or without a byte order mark.

```
jsonx new file --name Inventory | Out-File -Encoding utf8 inventory.jsonx
```

`jsonx format` rewrites the file in canonical order: the file's fields, each data source's and
trigger's, and each object's `Kind` and `Name` first, then the rest in the order the specification
lists them. Fields jsonx does not know are kept, after the others. The order of entries is kept.
`jsonx format --check` writes nothing and exits 1 when the file would change. A file that differs
only in line endings is already formatted.


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
never printed: `show`, `plan`, `explain`, every report, every served answer and every MCP resource
show the reference as written. `validate` warns when a variable is not set; a run that opens the
data source fails.


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

`--check` on `add` or `set` checks the change exactly as it would be made and writes nothing. It
exits 3 when the change would add an error, and 0 otherwise.

```
jsonx query add --json @long-nights.json --check
```

The file is rewritten with tab indentation. Fields jsonx does not know are kept.

***In Windows PowerShell 5.1***, double quotes inside an argument are removed before `jsonx` sees
them, so inline JSON arrives broken. Use `@file` or `-` there, for `--json` and every other JSON
option.


## Completion

`jsonx completion <shell>` writes a completion script. It completes commands, options, option
choices, `.jsonx` files after `--file`, and the names in the file: objects for `run`, Processes for
`debug`, data sources for the `datasource` verbs. Names are read from the file each time, so a new
entry completes straight away.

```
source <(jsonx completion bash)
source <(jsonx completion zsh)
jsonx completion powershell | Out-String | Invoke-Expression
```

In bash, a name with spaces is completed without quotes; add them yourself.


## A whole command as JSON

`--input-json <file>` reads an entire invocation from a JSON object, and `--input-json -` reads it
from standard input. `Command` names the command; every other key is named as the argument or
option is.

```
{ "Command": "datasource describe", "name": "Bookings", "rows": 5, "file": "observatory.jsonx" }
```

`--input-json` must be the only argument. An option that takes JSON Lines takes an array here.


## Serving the file

`jsonx serve` and `jsonx mcp` hold the file open and answer its commands for other programs until
they are stopped. Every served command answers the same object:

```
{ "Ok": true, "ExitCode": 0, "Result": [ ... ], "Findings": [], "Log": [ "Prepare the season  Process  ran once  9 ms", ... ] }
```

`Result` is what the command writes to standard output, `Log` is its report one line at a time,
`Findings` are its findings, and `ExitCode` is its [exit code](#exit-codes). `Result` is left out
when the command has none.

### The Web API

```
jsonx serve --api --file observatory.jsonx
```

It serves at `http://127.0.0.1:3470` until Ctrl+C. `--port` picks another port, and `--port 0` a
free one.

When it is ready, it writes one line to standard output, for a program that started it:

```
{"File":"C:\\season\\observatory.jsonx","Url":"http://127.0.0.1:3470","Ws":"ws://127.0.0.1:3470/ws","Pid":24480}
```

With `--ui` the line also carries `Ui`, the address of the [Web UI](#the-web-ui).

`--attached` also stops it when its standard input ends, so the program that started it can stop it
by closing that input. It stops the same way as on Ctrl+C: data sources are flushed and closed.

- `GET /` lists every command it answers, with its route, arguments and options, and the
  [profile](#profiles) it serves: each command says its `Defaults` and whether to `Confirm` it.
- `POST /<command>` runs a command: `POST /run`, `POST /datasource/find`,
  `POST /engine/schema/infer`. The body is the command's [JSON document](#a-whole-command-as-json)
  without `Command`.

```
{ "name": "Prepare the season" }
```

```
curl -s -X POST http://127.0.0.1:3470/run -H "Content-Type: application/json" -d @run.json
```

```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3470/run -ContentType application/json -Body (Get-Content run.json -Raw)
```

The HTTP status follows the exit code:

| Exit code | Status |
|---|---|
| 0 | 200 |
| 1 | 500 |
| 2 | 400 |
| 3 | 422 |

A command whose result is a list answers one JSON line per item when the request sends
`Accept: application/x-ndjson`, then a last line with `Ok`, `ExitCode`, `Findings` and `Log`.

### The WebSocket

`jsonx serve --api` also answers a WebSocket at `ws://127.0.0.1:3470/ws`. One connection carries
commands and their answers, and the server tells the connection what happens while it is open:
each object a run starts and finishes, and each change to the file. The connection passes the same
checks as any other request (see [Who can call](#who-can-call)).

Every message is one JSON object. The first message from the server is `Hello`: the version, the
file, the file's contents as written, the [profile](#profiles), and the commands, as `GET /` lists them.

A request carries an `Id` of your choosing, and everything the server sends about that request
carries the same `Id`. The `Answer` always comes last.

| Send | What it does |
|---|---|
| `{ "Id": "1", "Invoke": { "Command": "run", "name": "Prepare the season" } }` | Run a command. `Invoke` is the command's [JSON document](#a-whole-command-as-json), and `Answer` is the object above. |
| `{ "Id": "2", "Read": "jsonx://entry/Bookings" }` | Read the file (`jsonx://file`) or one entry, as written. |
| `{ "Id": "3", "Debug": { "process": "Prepare the season" } }` | Start debugging a Process. |
| `{ "Id": "4", "Step": "step" }` | Send one [debug command](#debugging-a-process). Its `Answer` is where the Process is now. |

A program drawing its own front end, as the Web UI does, can also ask the server to read what a person
types. These run nothing and answer at once, even while a debug is open:

| Send | Its `Result` |
|---|---|
| `{ "Id": "5", "Line": "data find Bookings --max 5" }` | What sending the line would do: `Outcome` is `invoke` or `debug` with the `Document` to send, `confirm` when `--yes` would be needed, `help` with its `Text`, `usage` with `Findings`, or `refused` for a command a front end does not send, such as `serve` or `tui`. A line cannot read `@file` or `-`. |
| `{ "Id": "6", "Entry": "{ \"Kind\": \"Query\", ... }" }` | Whether typed JSON is an entry, which one (`Target`), and the `Save` and `Check` commands to send for it. |
| `{ "Id": "7", "Complete": "run \"Prep" }` | Completions for the end of the text; each item says what to insert and how many characters it replaces. |
| `{ "Id": "8", "Actions": "Bookings" }` | The commands an entry offers, each with its command `Line`. |
| `{ "Id": "9", "Inventory": true }` | Every entry, with the worst finding in each. |
| `{ "Id": "10", "Profile": "run" }` | Switch the [profile](#profiles) for every connection; `"Profile": null` asks. `Result` is the profile, in the shape of a profile file: `Name`, `Describe`, `Commands`, `Without`, `Defaults`, `Confirm` and `Instructions`. |

| Received | When |
|---|---|
| `{ "Id", "Event": "report", "Phase": "open" or "close", "Name", "Kind", "Depth", ... }` | An object of the request starts or finishes. A close carries `Ok`, `Summary` and `Ms`. |
| `{ "Id", "Event": "log", "Line" }` | A line of the request's report. |
| `{ "Id", "Event": "finding", "Finding" }` | A finding of the request. |
| `{ "Id", "Event": "debug", "Snapshot" }` | The debug has moved: first when it starts, then after each command. |
| `{ "Id", "Answer" }` | The request is done. |
| `{ "Event": "document" }` | The file changed. Read it again for what you need. |
| `{ "Event": "reload", "Outcome" }` | The file was edited on disk; `Outcome` says whether it was picked up. |
| `{ "Event": "queue", "HeldBy" }` | A debug started (`"debug"`) or ended (`null`). |
| `{ "Event": "profile", "Profile" }` | The profile was switched, by any connection. |

- ***A debug holds the file for as long as it is open.*** While it is open, every request from every
  program that opens a data source or changes the file waits, and the `queue` event says why.
  `validate`, `plan`, `explain`, `list`, `show`, `engine`, `adapters` and `new` still answer at once.
- One connection has at most one debug. It ends when the Process finishes, on `quit`, or when the
  connection closes. The `Debug` request is answered then, with every snapshot as `Result` and the run
  report as `Log`, as `jsonx debug` writes them.
- A message that is not JSON closes the connection. A message that is JSON but not a request is
  answered with exit code 2.

Node 22's own `WebSocket` can connect:

```
const socket = new WebSocket( 'ws://127.0.0.1:3470/ws' );
socket.onmessage = function ( Message ) { console.log( Message.data ); };
socket.onopen = function () { socket.send( JSON.stringify( { Id: '1', Invoke: { Command: 'run', name: 'Prepare the season' } } ) ); };
```

### MCP

```
jsonx mcp --file observatory.jsonx
```

An MCP client starts `jsonx mcp` and talks to it over standard input and output. To add it to
Claude Code:

```
claude mcp add jsonx -- node <checkout>/bin/jsonx.js mcp --file <path>/observatory.jsonx
```

`jsonx mcp --http` serves MCP at `http://127.0.0.1:3471/mcp` instead, with `--host`, `--port` and
`--token` as for `serve`. It speaks MCP revision 2025-11-25, which the official MCP SDK speaks.

***`jsonx mcp` serves the `run` [profile](#profiles) unless `--profile` says otherwise***: the reads, the
draft checks and `run`. `--profile full` serves every command.

```
jsonx mcp --profile translate --file observatory.jsonx
```

- Each command is a tool named by its words joined with `_`: `run`, `datasource_find`,
  `engine_schema_infer`. A tool's arguments are the command's JSON document without `Command`, and
  it answers the object above.
- `initialize` answers the profile's description and instructions in `instructions`, and declares
  `tools.listChanged`. The instructions are what a model reads, so they say what the session does and
  name the file without its folder; they never say the profile's name, which `jsonx/profile` answers. A tool the profile does not serve is unknown.
- `jsonx/profile` with `{ "profile": "run" }` switches the profile for every connection, and with no
  params asks; it answers the profile as the WebSocket does. After a switch, `notifications/tools/list_changed`
  follows over standard input and output; over `--http`, which opens no stream, the next `tools/list`
  shows the new list.
- ***Under `full`, or a custom profile that serves them, `datasource_update`, `datasource_delete` and
  `datasource_drop` require `yes`.*** `yes: true` confirms a call that touches every document or removes
  the store; a call without `yes` is refused. Beside `save`, which runs nothing, `yes` is not needed.
- The file is the resource `jsonx://file`, and each data source, object and trigger is
  `jsonx://entry/<name>`.

### Profiles

A profile says what a served session answers: which commands, which options they are served
without, what a request gets when it does not say, and which commands a front end should confirm
with a person before sending. `--profile` on `jsonx serve` and `jsonx mcp` names one: a built-in,
or a `.json` file of the same shape. Every served surface reads the same profile, and a front end
switches it for all of them with the WebSocket's `Profile` request or MCP's `jsonx/profile`.

| Profile | Serves | Confirm |
|---|---|---|
| `full` | Every command. `jsonx serve` uses it when `--profile` is absent. | Nothing. |
| `translate` | `datasource list`, `describe`, `find` and `count`; `list` for each kind of object and for triggers, so an object is called by the name the file gives it; `validate`, `plan` and `explain`. Builds objects and runs nothing. | Nothing. |
| `run` | `translate`, and `run`. `jsonx mcp` uses it when `--profile` is absent. | `run`. |
| `design` | `run`, and every `list`, `show`, `add`, `set`, `remove` and `rename`; `datasource info`; `adapters`; `new`; `format`. | `run`, `format`, and every `add`, `set`, `remove` and `rename`. |

In `translate`, `run` and `design`, no command is served with `force` - a change the file's rules refuse
is mended, not forced - `datasource find` is served without `into` and `save`,
and `max` is 5 unless the request gives one. ***So nothing a model is offered writes, except `run`,
which the front end confirms first.*** A request for a command or an option the profile does not
serve is refused with exit code 2: `[run] is not served in this session.` The message does not name
the profile, because a model reads it as a tool's answer.

A custom profile is a JSON file:

```
{ "Name": "mine", "Describe": "Validate only.", "Commands": [ "validate" ] }
```

```
jsonx mcp --profile ./mine.json --file observatory.jsonx
```

`Commands` lists served commands by their words, or is `"*"` for every command. `Without` maps a
command to the options it is served without, `Defaults` to the values a request gets when it does
not give them, `Confirm` lists the commands to confirm, and `Instructions` is a paragraph for a
model, which MCP sends at `initialize`. A file naming a command or an option that is not served is
refused, and the server does not start.

### What a request cannot change

A request runs against the file and data sources the server was started with. `file`, `bind`,
`set` and `quiet` are refused, and so is an `output` other than `json`. Give `--file`, `--bind` and
`--set` to `jsonx serve` or `jsonx mcp` instead. `completion`, `serve`, `mcp` and `tui` are not
served, nor is anything outside the [profile](#profiles). `debug` is served only over the WebSocket,
because a debug needs a connection that stays open.

### Who can call

- ***`jsonx serve` and `jsonx mcp --http` bind to `127.0.0.1` by default***, and refuse a request
  from a web page on another site. `jsonx mcp` over standard input and output listens on no address.
- Any other `--host` needs a token, from `--token` or `JSONX_TOKEN`. Without one, the server does
  not start.
- With a token, every request must send `Authorization: Bearer <token>`.

```
jsonx serve --api --host 0.0.0.0 --token "a long random value"
```

A browser cannot send that header when it opens a WebSocket, so a page asks for a ticket first:

- `POST /ws/ticket`, with the token, answers `{ "Ticket": "...", "ExpiresInMs": 30000 }`.
- `ws://host:port/ws?ticket=<ticket>` then connects without the header. A ticket opens one connection
  within 30 seconds, and nothing else.
- `GET /ui/config.json` answers `{ "TokenRequired": true }` or `false`, without a token, so a page
  knows whether to ask.

```
curl -s -X POST http://127.0.0.1:3470/ws/ticket -H "Authorization: Bearer a long random value"
```

### While it serves

- ***Requests take turns*** for anything that opens a data source or changes the file, so each run
  sees the data as the one before it left it. `validate`, `plan`, `explain`, `list`, `show`,
  `engine`, `adapters` and `new` answer at once.
- Data sources stay open between requests, so a `jsonstor-memory` store keeps what earlier requests
  wrote.
- ***A write through the server fires the file's triggers***, as the same write typed at the
  command line would.
- ***The file is watched.*** An edit saved to it while it is served is picked up between requests
  and reported on standard error. A data source whose definition changed opens again from the new
  definition; the others keep their data. A file that no longer reads as JSON is not picked up, and
  the server keeps the file as it was.
- An edit made through a request (`add`, `set`, `rename`, `format`, `--save`) writes the file and
  takes effect from the next request.
- ***A file with errors is still served***, so it can be fixed through requests. Until it is, every
  run answers 422.
- An environment variable is read when its data source opens. Restart the server to use a new value.


## The terminal interface

```
jsonx tui --file observatory.jsonx
```

`jsonx tui` starts `jsonx serve` for the file, connects to it over the WebSocket, and stops it when you
quit. `--bind` and `--set` are passed on to that server.

To work with a file that is already being served, attach to it instead. Quitting leaves that server
running:

```
jsonx tui --url ws://127.0.0.1:3470/ws
```

`--token`, or `JSONX_TOKEN`, is the token that server needs. `--url` refuses `--file`, `--bind` and
`--set`, since the server already holds its file. It also refuses a jsonx of a different version,
because commands typed here are read with this version's command table.

The screen has four panes:

- ***Inventory*** lists the data sources, objects by kind, and triggers, each marked with its worst
  finding. Enter, or a second click, on an entry opens its actions: run, debug, find, count, plan,
  explain, validate and the rest. Run, debug and anything that only reads is sent straight away;
  an action marked `…` that changes something is put in Input for you to finish. `edit` puts the
  entry's JSON in Input.
- ***Input*** takes a command as you would type it after `jsonx`, such as `data find Bookings --max 5`.
  Tab completes commands, options and names. A line starting with `{` is an entry: it is checked as you
  type, and Ctrl+S saves it, adding it or replacing the entry of that name.
- ***Log*** shows each command's report and findings, and says when an edit saved on disk was
  picked up. Inventory follows every change to the file, however it was made.
- ***Data Rows*** shows a list result as rows. Enter on a row shows its JSON, and PgUp and PgDn page
  through a `find`. An update run with `--changes` shows each document before and after.

| Key | What it does |
|---|---|
| Tab, Shift+Tab | Move between panes. In Input, Tab completes. |
| Esc | Leave Input. |
| F1 | Help. |
| F2 | Switch between the dark and light themes. |
| F3 | Switch between the small, normal and large layouts. |
| F5, F6, F7 | Hide or show Inventory, Log or Data Rows. |
| Ctrl+Q | Quit. |
| `s` `i` `c` `d` `t` `k` `x` | While debugging, outside Input: step, into, continue, decline, state, skip, quit. |

A click moves to a pane, and the wheel scrolls. ***A command that needs `--yes` asks first***, and
sends `yes` only when you answer `y`. The theme, the layout and the hidden panes are kept in
`~/.jsonx/tui.json`.


## The Web UI

```
jsonx serve --ui --file observatory.jsonx
```

Then open `http://127.0.0.1:3470/ui/` in a browser; opening `http://127.0.0.1:3470/` goes there too.
`--ui` serves everything `--api` does as well. The page works with the file through the server it came
from, so it shows the same file, and a change made from the page, the TUI, the command line or an
editor shows in all of them.

When the server was started with a token, the page asks for it. It is kept for that browser tab until
the tab is closed.

The page has the same four panes as the [terminal interface](#the-terminal-interface):

- ***Inventory*** lists the entries, each marked with its worst finding. Double click an entry, or
  select it and press Enter, for its actions: run, debug, find, plan, explain, `edit` and the rest.
  Actions marked `…` go to Input for you to finish.
- ***Input*** takes a command as you would type it after `jsonx`. Enter sends it, and Tab completes
  commands, options and names. Text starting with `{` is an entry: it is checked a moment after you stop
  typing, with any finding shown under Input and underlined in the text, and Ctrl+S saves it. `edit`
  puts an entry's JSON here.
- ***Log*** shows each command's report and findings. While a Process is debugged, a strip above it
  shows the step in English, with a button for each [debug command](#debugging-a-process).
- ***Data Rows*** shows a list result as rows. Click a row for its JSON, which you can copy or save;
  Previous and Next page through a `find`; an update run with `--changes` shows each document before
  and after; Save as JSON saves the rows.

| Key | What it does |
|---|---|
| Enter | In Input, send the command. On an entry, open its actions. |
| Tab | In Input, complete. |
| Ctrl+S | In Input, save the entry. |
| Esc | Leave Input, or close a dialog. |
| `y`, `n` | Answer a confirmation. |
| `s` `i` `c` `d` `t` `k` `x` | While debugging, outside Input: step, into, continue, decline, state, skip, quit. |

***A command that needs `--yes` asks first***, and sends `yes` only when you answer yes.

The buttons at the top switch between the light, dark and system themes and three text sizes. The ▾
in each pane's header hides or shows it. Drag the line between two panes to resize them; with the
line selected, the arrow keys move it, and a double click puts it back. The page remembers these in
the browser.

If the server stops, the page says it is disconnected and does not reconnect; reload it once the
server is running again.


### The jsonx terminal

`http://127.0.0.1:3470/ui/terminal.html` is the same file, as a terminal: a transcript and one line to
type on. It runs the same commands the Web UI's Input does, on the same process, so what you do in one
shows in the other.

```
jsonx serve --ui --file observatory.jsonx
```

| Key | What it does |
|---|---|
| Enter | Send the line. |
| Tab | Complete the command, option or name you are typing. |
| Up, Down | The lines you have already sent on this page. |
| `y`, `n` | Answer a confirmation. |

A command that needs `--yes` asks first, and the prompt shows `y/n` until you answer. `debug` opens the
debugger here as a conversation: the prompt shows `debug`, and every line you type is one of its
[debug commands](#debugging-a-process) until it ends.

***It runs jsonx commands and nothing else.*** It is not a system shell, and commands that no page can
send — `serve`, `mcp`, `tui` and `completion` — are refused.


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
