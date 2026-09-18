# jsonx Specification

***Version 0.2, draft of 2026-09-18.***

***A jsonx file is an inventory: the data sources a piece of work runs against, the operations
  on them under names, and the triggers which run a process when a store is touched or when
  somebody asks.*** Each operation is a ***jsonx object*** - a JSON object which carries a
  `Kind` and describes one operation on a collection of documents. Nothing in a file runs until
  somebody asks for it by name, and a ***Process*** is how a file says to run several things in
  order. This document specifies the file, its data sources, the five kinds of object, the
  value types they hold, triggers, what running an object means, what a reader must refuse, and
  how the format may change without breaking what was written under it.

---------------------------------------------------------------------

## 1. Introduction

jsonx is a self-contained way to say what should happen to documents: add some to a store,
  read some back, change some, remove some, or run a process over each of them. Each of those is
  one jsonx object. A file gathers such objects under names, beside the definitions of the
  stores they reach, and a ***runner*** carries out whichever one it is asked for.

The situation it is written for looks like this. One system exports a daily file of orders.
  A spreadsheet ties each product to the department which fulfils it. A second system starts
  fulfilment when a row lands in its table. A `.jsonx` file defines the three stores, holds a
  Query which reads the export, a Process which finds each order's department, an Update which
  marks the orders as sent - and one more Process which calls those three in order. Asking a
  runner for that last Process does the day's work. Pointing the file at a test copy of the
  second system is a change to one data source definition, and nothing else in the file moves.

The vocabulary inside an object belongs to three libraries, and this document names them
  rather than restating them: [`jsongin`](http://jsongin.liquicode.com) for criteria, update
  documents, projections and sorts; [`jsonstor`](http://jsonstor.liquicode.com/#/guides/Storage-Interface.md) for what a store
  does; and [`jsonproc`](http://jsonproc.liquicode.com) for the steps of a process. Where this
  document says a value is *a jsongin query criteria*, the whole of jsongin's definition
  applies, and a reader which cannot evaluate a criteria cannot fully validate a jsonx object.

***Every example in this document uses one invented subject, an observatory***, with three
  collections: `Telescopes`, `Observers` and `Bookings`. It is not anybody's real data, and a
  writer building a jsonx object uses the field names of the data actually in front of it,
  never these. A booking looks like this:

```
{ "_id": "b-2041", "Telescope": "Meridian 40", "Observer": "R. Okafor", "Night": "2026-10-02",
  "Hours": 4, "Target": "NGC 7000", "Seeing": 2.1, "Status": "requested" }
```

---------------------------------------------------------------------

## 2. Conformance and terminology

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL in
  this document are to be interpreted as described in
  [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) when they appear in capitals.

***jsonx file.*** A JSON text whose top-level value is an object of the shape in section 3.

***Data source.*** A named collection of documents, defined in a file's `DataSources` by the
  jsonstor adapter and settings which open it. Section 4.

***jsonx object.*** A JSON object carrying a `Kind` whose value is one of the five kind names
  in section 5, a `Name`, and the fields that kind requires. Held in a file's `Objects`.

***Kind.*** The field which says what a jsonx object is and therefore what running it does.

***Trigger.*** An entry in a file's `Triggers`: a Process, and the timing on which it runs.
  Section 13.

***Name.*** The identifier of a data source, an object or a trigger. A file has one namespace
  for all three. Section 3.

***Value type.*** A JSON value with a defined shape which appears inside a jsonx object and is
  never a jsonx object itself: a criteria, an update document, a sort, a projection. Section 7.

***Host function.*** A function a runner makes available to a Process through jsonproc's
  `$call`. Section 12.

***Runner.*** A reader which runs objects: it opens a file's data sources and carries out the
  object it is asked for. Section 6.

***Reader.*** Anything which accepts jsonx files or objects - a runner, a validator, an editor,
  a person reading one. ***Writer.*** Anything which produces them - a program, a language
  model, a person typing one.

There are four conformance classes.

1. A ***conforming object*** satisfies every MUST in section 5 and in the section for its kind.
2. A ***conforming file*** satisfies every MUST in sections 3, 4 and 13, holds only conforming
   objects, and resolves every name it uses.
3. A ***conforming reader*** accepts every conforming file, refuses what section 14 says it must
   refuse, and preserves what section 15 says it must preserve. A ***conforming runner*** is a
   conforming reader which runs objects as section 6 says.
4. A ***conforming writer*** produces only conforming files, and follows the SHOULDs of this
   document unless it has a reason not to.

---------------------------------------------------------------------

## 3. The file

***3.1*** A jsonx file is a JSON text whose top-level value is a JSON object as defined by
  [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259). The file extension is `.jsonx`.

***3.2*** A file carries no `Kind`. It is not a jsonx object, and its extension says what it
  is.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Jsonx` | string | OPTIONAL | the version of this document the file was written under (15.1) |
| `Name` | string | OPTIONAL | non-empty; a name for the file as a whole, outside the namespace of 3.5 |
| `Description` | string | OPTIONAL | prose for a person |
| `DataSources` | array of data source | OPTIONAL | section 4; absent means none |
| `Objects` | array of jsonx object | OPTIONAL | section 5; absent means none |
| `Triggers` | array of trigger | OPTIONAL | section 13; absent means none |

***3.3*** `DataSources`, `Objects` and `Triggers` are each OPTIONAL, and each MUST be an array
  when present. An absent array means the file has none of that thing, and a writer MAY omit an
  array rather than write it empty. A file with none of the three is a conforming file, and
  there is nothing in it to run.

***3.4*** ***The order of each array is not significant.*** A file is an inventory, not a
  sequence: nothing runs because of where it sits. A writer MAY reorder any of the three arrays
  freely. Order of execution is said by a Process (section 12).

***3.5*** ***One namespace.*** Every data source, object and trigger MUST carry a `Name`, a
  non-empty string, and no two of them - across all three arrays - MAY share one. A Query and a
  data source MUST NOT share a name, nor a Process and a trigger. Names are compared as JSON
  strings, exactly: `Bookings` and `bookings` are two names.

***3.6*** ***Host function names are reserved.*** A data source, object or trigger MUST NOT be
  named `Count`, `FindOne`, `FindMany`, `FindMany2`, `InsertOne`, `InsertMany`, `UpdateOne`,
  `UpdateMany`, `ReplaceOne`, `DeleteOne` or `DeleteMany` (12.6). A later version of this
  document which adds a host function adds its name to this list, and says so.

***3.7*** A name SHOULD say what the thing does in a way which shows what it is, so that a list
  of names reads as a list of operations: *Find the long requested nights*, *Confirm the
  bookings with good seeing*, *Note every long booking as it arrives*. This is a convention and
  is not enforced.

***3.8*** ***Every name a file uses MUST be defined in the file.*** A `DataSource`, an `Into`,
  a host function's `With.DataSource` when it is written as a literal string, a `$call` which
  names an object, and a trigger's `Process` each name something the file defines, of the right
  sort, or the file is in error. A name which is not defined is a misspelling.

***3.9*** A jsonx file MUST be encoded as UTF-8. A writer SHOULD NOT write a byte order mark,
  and a reader MUST accept one.

***3.10*** The field `_id` is reserved on the file, on every data source, object and trigger in
  it: a writer MUST NOT write it and a reader MUST ignore it. It is the identifier a store
  assigns to a document it holds, and none of these is that document. The documents *inside* an
  Insert (section 8) are a store's documents, and this rule does not reach them.

***3.11*** The file, and every data source, object and trigger in it, MAY carry fields this
  document does not define. Section 15 says what a reader does with them.

---------------------------------------------------------------------

## 4. Data sources

***A data source names a jsonstor store***: which adapter opens it, the settings that adapter
  needs, and any filters stacked over it. It is what turns the names an object carries into
  documents.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Name` | string | REQUIRED | 3.5 |
| `AdapterName` | string | REQUIRED | the name of a jsonstor adapter, such as `jsonstor-memory` |
| `Settings` | object | OPTIONAL | the settings that adapter defines; absent means `{}` |
| `Filters` | array | OPTIONAL | filter descriptors, applied in order; absent means `[]` |

***4.1*** `AdapterName` MUST be a non-empty string. Which names exist, and what each one's
  settings are, is defined by jsonstor - see [Storage Adapters](http://jsonstor.liquicode.com/#/guides/Storage-Adapters.md).
  A reader which knows the adapter inventory SHOULD check `Settings` against it: a required
  setting which is missing is an error, a setting of the wrong type is an error, and a setting
  the adapter does not describe is a warning.

***4.2*** `Settings` MUST be a JSON object when present. Its contents belong to the adapter.

***4.3*** `Filters` MUST be an array when present. Each element is a ***filter descriptor***: a
  JSON object with a `FilterName` string naming a jsonstor filter and an OPTIONAL `Settings`
  object for it. Filters are stacked in array order, the first nearest the store. See
  [Storage Filters](http://jsonstor.liquicode.com/#/guides/Storage-Filters.md).

***4.4*** ***Environment references.*** Wherever a string appears inside a data source's
  `Settings`, or inside a filter descriptor's `Settings`, the sequence `${env:NAME}` stands for
  the value of the environment variable `NAME`. A runner replaces each such sequence when it
  opens the data source, and the rest of the string is kept as written, so a connection string
  may carry one reference among other text. `NAME` is one or more letters, digits and
  underscores. ***This is how a file which is shared or kept under source control avoids
  carrying a password.***

```
"Settings": { "Server": "db.example.org", "User": "bookings", "Password": "${env:BOOKINGS_PASSWORD}" }
```

***4.5*** A runner MUST NOT reveal the value an environment reference resolved to. When it
  shows, logs or returns a data source definition, it shows the reference as written.

***4.6*** An environment reference whose variable is not set when the data source opens is a
  failure of that run (6.7), not a defect of the file: the same file is correct on a machine
  which sets the variable.

***4.7*** A definition says where documents are, never what they look like. There is no schema
  field, and a reader learns a data source's shape by reading its documents.

***4.8*** A setting MAY hold a value which is only meaningful on the machine which wrote it - a
  file path is the usual case. A writer which produces a file for another machine SHOULD say so
  in `Description`, or use an environment reference. A data source whose store is unreachable
  when an object runs - a file which is not there, a server which is down - is a failure of that
  run (6.7), not a malformed definition.

Example:

```
{
  "Name": "Bookings",
  "AdapterName": "jsonstor-jsonfile",
  "Settings": { "Path": "bookings.json" },
  "Filters": []
}
```

---------------------------------------------------------------------

## 5. Objects

***5.1*** A jsonx object MUST be a JSON object, and MUST carry a field named `Kind` whose value
  is a string, and that string MUST be one of:

| Kind | What running it does | Section |
|---|---|---|
| `Insert` | adds the documents it carries to its data source | 8 |
| `Query` | reads documents from its data source | 9 |
| `Update` | changes the documents its criteria selects | 10 |
| `Delete` | removes the documents its criteria selects | 11 |
| `Process` | runs a jsonproc process, once, or once for each document its criteria selects | 12 |

***5.2*** A reader MUST refuse an object whose `Kind` is absent, not a string, or not a kind
  name it knows.

***5.3*** A jsonx object MUST carry a `Name` (3.5). A reader, a runner, a trigger and a Process
  refer to an object by its name.

***5.4*** An Insert, Query, Update or Delete MUST carry a field named `DataSource` whose value
  is the name of a data source the file defines: the collection the operation runs against. A
  Process MAY carry one (12.3).

***5.5*** The order of fields in a jsonx object is not significant. A writer SHOULD write
  `Kind` first and `Name` second, so that a person scanning a file sees what each object is
  before anything else.

***5.6*** ***An object is the same object wherever it appears.*** Copied from one file into
  another, it is a conforming element of the second file's `Objects` as long as the names it
  uses are defined there.

---------------------------------------------------------------------

## 6. Running an object

***6.1*** ***A runner runs an object only when it is asked to***, by name - by a person, a
  program, a trigger (section 13), or a Process which calls it (12.7). Reading a file,
  validating it or showing it in an editor runs nothing, and nothing in a file runs because of
  where it sits.

***6.2*** ***Each run is carried out to completion before the run which asked for it
  continues.*** An object which writes to a data source is finished, and its writes are
  visible, before the next step of whatever called it reads that data source.

***6.3*** Running an object produces a ***result***, by kind:

| Kind | Result |
|---|---|
| `Insert` | how many documents were inserted |
| `Query` | the documents read, after projection, sort, skip and limit |
| `Update` | how many documents were selected and how many changed |
| `Delete` | how many documents were removed |
| `Process` with a `DataSource` | one return value per document the process ran over, in order |
| `Process` without a `DataSource` | its one return value |

***6.4*** A runner opens a data source the first time a run needs it, and every later need of
  the same run - and, for a runner which stays open, of later runs - reaches the same store.

***6.5*** ***`Into` routes a result into a data source.*** A Query or a Process MAY carry a
  field named `Into` whose value is the name of a data source the file defines. When it does,
  the runner inserts the result into that data source, as if by jsonstor's `InsertMany`: a
  Query's rows, or those of a Process's return values which are JSON objects. A return value
  which is not an object is part of the result (6.3) and is not inserted. ***`Into` appends.***
  It never empties the target first. An object MUST NOT name its own `DataSource` as its
  `Into`.

***6.6*** A runner which reports on a run SHOULD refer to each object by its `Name`, and when a
  Process calls other objects, SHOULD show each called object's run beneath its caller's.

***6.7*** ***When a run fails, it stops there.*** A store which refuses a call, a criteria
  jsongin refuses, a process which throws, an unreachable store, an environment reference with
  no value - any of these ends the run of the object it happened in. Writes already made stand.
  A runner MUST report which object failed and why. A failure inside an object which a Process
  called is a failure of that `$call` step, and the Process handles it as jsonproc handles any
  failed step (12.7). There are no transactions: jsonstor does not define them, and when it does
  this document will say how a file uses them.

---------------------------------------------------------------------

## 7. Value types

A value type is a JSON value with a defined shape which appears inside a jsonx object. ***A
  value type is never a jsonx object.*** It carries no `Kind`, it never stands alone in
  `Objects`, and a reader MUST NOT accept one as an element of it.

The reason is structural. A criteria's keys are the field names of the writer's own documents,
  so a criteria cannot carry a `Kind` without colliding with a document which has a field
  called Kind - which the observatory's bookings could well have. The other three follow the
  criteria for symmetry, so that the rule is one rule: ***if it has a Kind it is an object, and
  if it has no Kind it is a value.***

Each value type has an owner which defines it. This document names the owner, states the shape
  a reader can check without the owner, and defers everything else.

### 7.1 Criteria

A ***criteria*** is a jsongin query criteria: a JSON object keyed by field name, in which a
  value is either the value the field must equal or an object of query operators over it.

```
{ "Status": "requested", "Hours": { "$gte": 4 } }
```

- A criteria MUST be a JSON object. It MUST NOT be an array.
- An empty criteria `{}` selects every document.
- What the operators are and what they mean is defined by jsongin:
  [jsongin for a Language Model](http://jsongin.liquicode.com/#/guides/Llm-Context.md) is the
  short form and the [Operator Reference](http://jsongin.liquicode.com/#/guides/Operator-Reference.md)
  the long one.
- A reader which can evaluate a criteria SHOULD do so against an empty document when it
  validates one, and report what jsongin refuses as an error. A reader which cannot evaluate a
  criteria can check only that it is an object.

### 7.2 Update document

An ***update document*** is a jsongin update document: a JSON object keyed by update operator,
  each operator's value naming the fields it changes. One update document may carry several
  operators and so describe several changes; it is still one value.

```
{ "$set": { "Status": "confirmed" }, "$inc": { "Revisions": 1 } }
```

- An update document MUST be a JSON object, and every top-level key MUST be an update
  operator jsongin defines.
- An empty update document `{}` is well formed and changes nothing. A reader SHOULD warn about
  one.
- The same jsongin documents define the operators. A reader which can apply an update SHOULD
  apply it to an empty document when it validates one, and report what jsongin refuses.

### 7.3 Sort

A ***sort*** is a JSON object keyed by field name whose every value is `1` for ascending or
  `-1` for descending, applied in key order.

```
{ "Night": 1, "Hours": -1 }
```

- A sort MUST be a JSON object. ***It MUST NOT be an array***, and a writer MUST NOT write the
  shape `[ { "Field": ..., "Direction": ... } ]`, which language models produce when nothing
  says otherwise.
- A value other than `1` or `-1` is an error.
- A field name MAY be a dotted path.

### 7.4 Projection

A ***projection*** is a jsongin projection: a JSON object keyed by field name whose values say
  whether a field is included, excluded, or computed.

```
{ "Telescope": 1, "Night": 1, "Hours": 1 }
```

- A projection MUST be a JSON object.
- Its values and their rules are defined by
  [`jsongin.Project`](http://jsongin.liquicode.com/#/guides/jsongin/Project.md). A reader which
  cannot evaluate a projection checks only that it is an object.

---------------------------------------------------------------------

## 8. Insert

***An Insert adds the documents it carries to its data source.*** It is how a file carries
  data as well as the things done to data: seed rows, fixtures, the handful of documents an
  example needs, a lookup table small enough to write down.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Kind` | string | REQUIRED | `"Insert"` |
| `Name` | string | REQUIRED | 3.5 |
| `DataSource` | string | REQUIRED | a data source the file defines (5.4) |
| `Documents` | array of object | REQUIRED | the documents, in the order they are inserted |

***8.1*** `Documents` MUST be present and MUST be an array, and every element MUST be a JSON
  object. An empty array is well formed and inserts nothing; a reader SHOULD warn about one.

***8.2*** ***The elements of `Documents` are the store's documents, not jsonx objects.*** They
  carry no `Kind`, their fields are whatever the data source holds, and 3.10 does not apply to
  them: an element MAY carry an `_id`, which is handed to the store, and what the store does
  with it is the store's business - see [Storage Invariants](http://jsonstor.liquicode.com/#/guides/Storage-Invariants.md).

***8.3*** A runner runs an Insert as jsonstor's `InsertMany( Documents )`. ***Running an Insert
  twice inserts its documents twice.***

Example:

```
{
  "Kind": "Insert",
  "Name": "Two telescopes",
  "DataSource": "Telescopes",
  "Documents": [
    { "Name": "Meridian 40", "Aperture": 400, "Mount": "equatorial", "Status": "active" },
    { "Name": "Dobson 30", "Aperture": 300, "Mount": "altazimuth", "Status": "stored" }
  ]
}
```

---------------------------------------------------------------------

## 9. Query

***A Query reads documents from its data source***: which documents, which of their fields, in
  what order, how many and from where - and, with `Into`, where they go next.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Kind` | string | REQUIRED | `"Query"` |
| `Name` | string | REQUIRED | 3.5 |
| `DataSource` | string | REQUIRED | a data source the file defines (5.4) |
| `Criteria` | criteria | REQUIRED | 7.1; `{}` reads every document |
| `Projection` | projection | OPTIONAL | 7.4; absent means every field |
| `Sort` | sort | OPTIONAL | 7.3; absent means the store's own order |
| `SkipCount` | integer | OPTIONAL | zero or more; documents passed over before the first is read; absent means zero |
| `MaxCount` | integer | OPTIONAL | greater than zero; absent means the object sets no limit |
| `Into` | string | OPTIONAL | a data source the rows are inserted into (6.5) |

***9.1*** `Criteria` MUST be present and MUST be a criteria. A writer which means every
  document writes `{}` rather than omitting the field, so that a Query with no Criteria is
  visibly incomplete rather than silently total.

***9.2*** `Projection`, `Sort`, `SkipCount`, `MaxCount` and `Into` are each OPTIONAL. A writer
  SHOULD omit each one it has no reason to set, and MUST NOT write `null` in place of omitting
  it.

***9.3*** `MaxCount`, when present, MUST be an integer greater than zero. It is the most
  documents the Query reads. ***Absence means the Query imposes no limit; it does not mean the
  runner must return everything.*** A runner MAY apply a limit of its own to a Query which
  sets none, and SHOULD say that it did.

***9.4*** `SkipCount`, when present, MUST be an integer of zero or more. It is how many of the
  documents the Criteria selects, taken in `Sort` order, are passed over before the first one
  is read; `MaxCount` then counts from there. ***`SkipCount` and `MaxCount` together are a
  page.*** Absent means zero. A reader SHOULD warn when `SkipCount` is set and `Sort` is not,
  because a page of an unordered result is not a page.

***9.5*** A runner runs a Query as jsonstor's `FindMany2( Criteria, Projection, Sort, Paging )`,
  where `Paging` is `{ "SkipCount": ..., "MaxCount": ... }` built from the two fields, each
  present only when the Query carries it, and its result is whatever that returns - see
  [Storage Invariants](http://jsonstor.liquicode.com/#/guides/Storage-Invariants.md) for what is guaranteed about it. With
  `Into`, the rows are then inserted there (6.5).

Example:

```
{
  "Kind": "Query",
  "Name": "Find the second page of long requested nights",
  "DataSource": "Bookings",
  "Criteria": { "Status": "requested", "Hours": { "$gte": 4 } },
  "Sort": { "Night": 1 },
  "SkipCount": 25,
  "MaxCount": 25,
  "Into": "LongNights"
}
```

---------------------------------------------------------------------

## 10. Update

***An Update changes the documents its criteria selects***, in place, in its data source.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Kind` | string | REQUIRED | `"Update"` |
| `Name` | string | REQUIRED | 3.5 |
| `DataSource` | string | REQUIRED | a data source the file defines (5.4) |
| `Criteria` | criteria | REQUIRED | 7.1; `{}` selects every document |
| `Update` | update document | REQUIRED | 7.2 |
| `FirstOnly` | boolean | OPTIONAL | absent means `false` |

***10.1*** `Criteria` MUST be present, as for a Query (9.1). An Update whose Criteria is `{}`
  changes every document in the data source, and a writer SHOULD not produce one by accident.

***10.2*** `Update` MUST be present and MUST be an update document. ***The field is named
  `Update`, in the singular, whatever the number of operators inside it***: it is one update
  document, and an Update object carries one. A reader SHOULD warn when it is empty, because
  an Update which changes nothing is almost always a mistake.

***10.3*** `FirstOnly` says whether only the first document the Criteria selects is changed,
  or every one. ***Absent means `false`***: every selected document is changed. A writer which
  means the first document only MUST write `"FirstOnly": true`.

***10.4*** A runner runs an Update as jsonstor's `UpdateOne( Criteria, Update )` when
  `FirstOnly` is `true`, and `UpdateMany( Criteria, Update )` otherwise.

Example:

```
{
  "Kind": "Update",
  "Name": "Confirm the bookings with good seeing",
  "DataSource": "Bookings",
  "Criteria": { "Status": "requested", "Seeing": { "$lt": 2.5 } },
  "Update": { "$set": { "Status": "confirmed" } }
}
```

---------------------------------------------------------------------

## 11. Delete

***A Delete removes the documents its criteria selects*** from its data source.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Kind` | string | REQUIRED | `"Delete"` |
| `Name` | string | REQUIRED | 3.5 |
| `DataSource` | string | REQUIRED | a data source the file defines (5.4) |
| `Criteria` | criteria | REQUIRED | 7.1; `{}` selects every document |
| `FirstOnly` | boolean | OPTIONAL | absent means `false` |

***11.1*** `Criteria` MUST be present and MUST be a criteria. A Delete whose Criteria is `{}`
  empties the data source. A writer MUST mean that when it writes it, and a reader SHOULD warn
  about it.

***11.2*** `FirstOnly` says whether only the first document the Criteria selects is removed,
  or every one. ***Absent means `false`.***

***11.3*** A runner runs a Delete as jsonstor's `DeleteOne( Criteria )` when `FirstOnly` is
  `true`, and `DeleteMany( Criteria )` otherwise.

Example:

```
{
  "Kind": "Delete",
  "Name": "Drop the cancelled bookings",
  "DataSource": "Bookings",
  "Criteria": { "Status": "cancelled" }
}
```

---------------------------------------------------------------------

## 12. Process

***A Process runs a jsonproc process.*** It is the object which computes and the object which
  orders: it reads other data sources, derives new values, runs other objects of the file one
  after another, and returns what it produced - which `Into` can turn into documents.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Kind` | string | REQUIRED | `"Process"` |
| `Name` | string | REQUIRED | 3.5 |
| `DataSource` | string | OPTIONAL | a data source the file defines; present means once per document (12.4) |
| `Criteria` | criteria | OPTIONAL | 7.1; only with `DataSource`; absent means every document |
| `Steps` | array of object | REQUIRED | jsonproc steps, each one object holding one step operator |
| `Into` | string | OPTIONAL | a data source the object returns are inserted into (6.5) |

***12.1*** ***A Process object is a jsonproc process with `Kind`, `DataSource`, `Criteria` and
  `Into` beside its `Steps`.*** It is flat: `Steps` is a top-level field, and a runner may hand
  the object to jsonproc as it stands. `Name` is both the name of 3.5 and the process's own
  name.

***12.2*** `Steps` MUST be present and MUST be an array. Every element MUST be a JSON object
  with exactly one key, and that key MUST be a step operator jsonproc defines. The step
  operators, the expressions inside them and the `$call` mechanism are defined by jsonproc:
  [jsonproc for a Language Model](http://jsonproc.liquicode.com/#/guides/Llm-Context.md).

***12.3*** ***A Process runs in one of two ways, and `DataSource` says which.***

- ***With a `DataSource`***, it runs once for each document its `Criteria` selects (12.4).
- ***Without one***, it runs once (12.5). `Criteria` MUST NOT be present on such a Process,
  because there is nothing for it to select from.

***12.4*** ***Once per document.*** The process runs once per selected document, in the data
  source's order, and each run starts with a document which carries the selected document at
  `Document`. A step reaches the booking's telescope as `$Document.Telescope`. A runner MAY put
  more beside `Document`, and a process which is to run anywhere MUST NOT depend on anything but
  `Document`. The runs are independent: nothing one run computes is visible to the next.

***12.5*** ***Once.*** The process runs one time, and its run starts with the document the
  runner was handed by whoever asked for the run, or with `{}` when it was handed none. A
  process which is to run anywhere MUST work when it starts from `{}`. A Process which is called
  by another Process (12.7), or run by a trigger, is handed nothing and starts from `{}`.

***12.6*** ***A process does not write to a data source by changing `Document`.*** Changing
  `$Document` changes the run's own copy and nothing in the store; the one exception is a
  trigger which runs `Before` (13.5). A process which is to change documents does so through a
  host function, by calling an object, or by returning values which `Into` routes.

***12.7*** ***Host functions.*** A runner MUST make the jsonstor document functions available
  to a process through jsonproc's `$call`: `Count`, `FindOne`, `FindMany`, `FindMany2`,
  `InsertOne`, `InsertMany`, `UpdateOne`, `UpdateMany`, `ReplaceOne`, `DeleteOne` and
  `DeleteMany`, each by its jsonstor name. The call's `With` carries a `DataSource` naming a data
  source the file defines, and the function's own parameters ***under the names the
  [Storage Interface](http://jsonstor.liquicode.com/#/guides/Storage-Interface.md) gives them*** - so an `UpdateOne` call
  spells its update document `Updates`, because that is the storage function's parameter,
  while an Update object spells its own `Update` (10.2). The call's `Into` receives what the
  function returns.

```
{ "$call": { "Name": "FindOne",
             "With": { "DataSource": "Telescopes", "Criteria": { "Name": "$Document.Telescope" } },
             "Into": "Telescope" } }
```

  ***`With` is a jsonproc expression document, and so is everything inside it.*** A field
  reference such as `$Document.Telescope` is replaced by its value, which is what makes the call
  above work - and an operator is evaluated as an expression operator, which is what breaks a
  criteria or an update document written there as it would be written on an object. `$gt` in a
  criteria is jsongin's comparison expression inside `With`, not the query operator: written
  `{ "Hours": { "$gt": 4 } }` it fails, and written over an array it silently becomes `true` or
  `false`. ***A criteria or an update document holding an operator is wrapped in `$literal`***,
  which passes it to the host function unevaluated. Nothing inside `$literal` is evaluated, so an
  operator whose value comes from the state is built with `$arrayToObject`, the operator's name
  held in `$literal`: `{ "Hours": { "$arrayToObject": [ [ [ { "$literal": "$gt" }, "$Document.Hours" ] ] ] } }`
  reaches the host function as `{ "Hours": { "$gt": 6 } }` for a document of six hours.

```
{ "$call": { "Name": "UpdateMany",
             "With": { "DataSource": "Bookings",
                       "Criteria": { "$literal": { "Hours": { "$gt": 6 } } },
                       "Updates": { "$literal": { "$set": { "Long": true } } } } } }
```

***12.8*** ***Calling an object.*** A `$call` whose `Name` is the name of an object in the file
  runs that object, as section 6 says, and the call's `Into` receives the object's result
  (6.3). ***This is how a file says to run several things in order***: a Process whose steps
  call objects one after another runs them one after another, and jsonproc's `$when`, `$while`,
  `$forEach` and `$try` can decide which run and what happens when one fails.

- A call which names an object MUST NOT carry `With`. The object runs exactly as written.
- The called object's own `Into`, when it has one, applies as it always does.
- A called Process which has a `DataSource` runs once per document, and one which has none runs
  once from `{}` (12.5).
- The object's failure is the failure of the `$call` step (6.7). A `$try` around the call
  catches it; without one, the Process fails.
- A Process MUST NOT call itself, directly or through the objects it calls.

```
{ "$call": { "Name": "Confirm the bookings with good seeing", "Into": "Confirmed" } }
```

***12.9*** A `$call` whose `Name` is neither a host function nor an object of the file is an
  error. Because host function names are reserved (3.6), a name is never both.

***12.10*** The result of a Process is given in 6.3. With `Into`, each return value which is a
  JSON object is inserted there and the others are not (6.5). A run which throws fails the run
  of the Process (6.7).

Example - for each requested booking, look up its telescope and return one assignment:

```
{
  "Kind": "Process",
  "Name": "Assign a dome to each requested booking",
  "DataSource": "Bookings",
  "Criteria": { "Status": "requested" },
  "Steps": [
    { "$call": { "Name": "FindOne",
                 "With": { "DataSource": "Telescopes", "Criteria": { "Name": "$Document.Telescope" } },
                 "Into": "Telescope" } },
    { "$return": { "Booking": "$Document._id", "Observer": "$Document.Observer",
                   "Dome": "$Telescope.Site.Dome" } }
  ],
  "Into": "Assignments"
}
```

Example - run three objects in order, and stop the night's work if the confirmation fails:

```
{
  "Kind": "Process",
  "Name": "Prepare tonight",
  "Steps": [
    { "$try": { "Do": [ { "$call": { "Name": "Confirm the bookings with good seeing" } } ],
                "Catch": [ { "$return": "confirmation failed" } ] } },
    { "$call": { "Name": "Drop the cancelled bookings" } },
    { "$call": { "Name": "Assign a dome to each requested booking", "Into": "Assigned" } },
    { "$return": "$Assigned" }
  ]
}
```

---------------------------------------------------------------------

## 13. Triggers

***A trigger is a Process and the timing on which it runs.*** The Process says which data
  source, which documents and what to do; the trigger says when - before or after an
  operation on its data source, or only when somebody asks.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `Name` | string | REQUIRED | 3.5 |
| `On` | array of string | OPTIONAL | non-empty; operation names (13.3) |
| `When` | string | OPTIONAL | `"Before"` or `"After"`; absent means `"After"`; MUST NOT appear without `On` |
| `Process` | string | REQUIRED | the name of a Process in `Objects` which has a `DataSource` |

***13.1*** `Process` MUST be the `Name` of an object in `Objects` whose `Kind` is `Process` and
  which carries a `DataSource`. A reader MUST report a name which matches no object, matches an
  object of another kind, or matches a Process with no `DataSource`, as an error. ***A trigger
  never holds a process of its own***, so every process a trigger runs can also be run, shown
  and debugged by name.

***13.2*** A trigger carries no data source and no criteria of its own. ***Both come from its
  Process.*** The trigger watches the Process's `DataSource`, and for each document a call
  touches, the Process runs if and only if the document matches the Process's `Criteria` - an
  absent Criteria matching every document (12.4).

***13.3*** ***A trigger with `On` is programmatic, and a trigger without it is manual.*** A
  programmatic trigger fires when one of the operations named in `On` is made on the
  Process's data source through a runner which holds the file. A manual trigger never fires on
  its own: it exists so that it can be listed and run when asked, which runs its Process over
  its data source exactly as 12.4 says. ***A programmatic trigger can be run by hand in the same
  way.*** When `On` is present it MUST be an array, MUST NOT be empty, and every element MUST be
  one of the four operations a trigger can fire on. Each covers the jsonstor functions beside it:

```
Insert   InsertOne  InsertMany
Find     FindOne    FindMany    FindMany2
Update   UpdateOne  UpdateMany  ReplaceOne
Delete   DeleteOne  DeleteMany
```

  ***A trigger does not tell a call which touches one document from a call which touches
  many.*** Which of a pair a runner calls is the runner's business - a Delete with `FirstOnly`
  is a `DeleteOne` and any other a `DeleteMany` (11.3) - and a triggered process runs once per
  document either way (13.6), so the distinction would say nothing a person means. A replaced
  document is a changed one, so `ReplaceOne` is an Update. `Count`, `DropStorage` and
  `FlushStorage` belong to no operation: a process runs over a document, and those calls have
  none. A reader MUST report a jsonstor function name in `On` as an error, as it does any
  other value which is not one of the four.

***13.4*** A trigger fires for a storage call whoever makes it - a person asking for an object,
  another Process, a host function - as long as the call reaches the data source through a
  runner which holds the file. A call made to the same store by a program which does not hold
  the file fires nothing, because nothing is watching it there.

***13.5*** `When`, when present, MUST be `"Before"` or `"After"`, and MUST NOT be present
  without `On`. Absent means `"After"`. ***A trigger which runs `Before` is a gate, and one
  which runs `After` is a consequence.***

  ***Before.*** A runner MUST run every `Before` trigger, for every document the call will
  touch, before it makes the call. ***A process which fails refuses the call***: the call is
  not made, nothing is written, and the object which asked for it fails saying why (6.7).
  For an Insert the documents are the ones submitted, and a process MAY change `Document`:
  the storage then receives the changed document, which is the one place a process changes
  a document by changing `$Document`. For an Update or a Delete they are the documents the
  call's criteria selects, as they are before the call; ***a call which touches one document***
  (a `FirstOnly` object, 10.4 and 11.3) ***is gated on that one document***, the first the
  storage finds, and on no other the criteria selects. A Find has no documents until it is
  made, so a `Before` trigger on a Find runs for none. A `Before` process SHOULD read, change
  the incoming document or refuse, and nothing more: there are no transactions (6.7), so
  what it writes elsewhere stands even when the call is then refused.

  ***After.*** A process run `After` sees each document the storage reports the call touched,
  as it was stored - for a Delete, as it was removed - and its changes to `$Document` reach
  nothing. ***It cannot refuse what has happened***: when it fails, the write was made and
  stands (6.7), the object which made the call fails, and a runner MUST say that the write
  was made. It is the place to change other parts of the data once an operation is done.
  ***What a call touched is what the storage says it touched***; a storage which reports a
  document it matched and did not change is reporting it as touched.

***13.6*** A triggered process runs once per document the call touches and the criteria
  admits, exactly as a run over its data source would (12.4). A runner puts what fired beside
  `Document`, as `Event`: `Function` (the jsonstor function called), `Operation`, `When`,
  `DataSource` and `Trigger`. ***For a `Before` Update, `Event` also carries `Update`, the
  update document, and `Proposed`, the document as the update would leave it*** - for a
  replace, `Proposed` is the replacement - so that a gate can compare what is with what
  would be. A process which is to run outside a trigger as well MUST NOT depend on `Event`.

***13.7*** When the Process carries an `Into`, each run's return value which is an object is
  inserted there (6.5). ***A trigger does not fire for the calls its own Process causes while
  that Process is running*** - through `Into`, a host function or an object it calls - so a
  trigger whose Process writes to the data source it watches does not fire itself again. Every
  other trigger on that data source fires for those calls as 13.4 says.

Example, programmatic:

```
{
  "Name": "Note every long booking as it arrives",
  "On": [ "Insert" ],
  "When": "After",
  "Process": "Note a long booking"
}
```

Example, manual:

```
{
  "Name": "Recount the certifications",
  "Process": "Count each observer's certifications"
}
```

---------------------------------------------------------------------

## 14. Validation

A reader which validates reports ***findings***, each with a severity, a path to the field
  concerned, and a message. The severities are ***error***, which makes the file
  non-conforming; ***warning***, which does not; and ***note***, which is information.

***14.1*** A reader MUST report each of the following as an error.

1. A file which is not valid JSON, or whose top-level value is not a JSON object (3.1).
2. A `Jsonx`, `Name` or `Description` on the file which is present and not a string, or a file
   `Name` which is empty (3.2).
3. A `DataSources`, `Objects` or `Triggers` which is present and not an array (3.3); an element
   of any of them which is not a JSON object.
4. A data source, object or trigger whose `Name` is absent, not a string, or empty; a `Name`
   which repeats another's anywhere in the file (3.5); a `Name` which is a reserved host
   function name (3.6).
5. A data source whose `AdapterName` is absent, not a string, or empty (4.1); whose `Settings`
   is present and not an object (4.2); whose `Filters` is present and not an array, or holds an
   element with no `FilterName` string or with a `Settings` which is not an object (4.3). A
   required setting missing, or a setting of the wrong type, when the reader knows the adapter
   inventory (4.1).
6. An object whose `Kind` is absent, not a string, or unknown (5.2).
7. An Insert, Query, Update or Delete whose `DataSource` is absent, not a string, or empty
   (5.4). Any `DataSource` or `Into` which names no data source the file defines, or names an
   object or a trigger (3.8).
8. An `Into` which equals the object's own `DataSource` (6.5); an `Into` on a kind which does
   not take one.
9. An Insert whose `Documents` is absent or not an array, or an element of it which is not an
   object (8.1).
10. A `Criteria` which is absent on a Query, Update or Delete (9.1, 10.1, 11.1); a `Criteria`
    which is present and not an object (7.1); or one which jsongin refuses, when the reader can
    ask it.
11. A `Projection` or `Sort` which is present and not an object (7.3, 7.4); a `Sort` value other
    than `1` or `-1`; a `MaxCount` which is present and not an integer greater than zero (9.3);
    a `SkipCount` which is present and not an integer of zero or more (9.4).
12. An `Update` which is absent or not an object (10.2), or which jsongin refuses, when the
    reader can ask it.
13. A `FirstOnly` which is present and not a boolean (10.3, 11.2).
14. A Process whose `Steps` is absent or not an array; a step which is not an object holding
    exactly one key; a step whose key is not a step operator, when the reader can ask jsonproc
    (12.2). A Process which carries `Criteria` and no `DataSource` (12.3).
15. A `$call` whose `Name` is neither a host function nor an object of the file (12.9); a
    `$call` which names an object and carries `With` (12.8); a host function call whose
    `With.DataSource` is a literal string naming no data source the file defines (3.8); a host
    function call whose `With.Criteria` holds a query operator, or whose `With.Updates` holds an
    update operator, outside `$literal` (12.7).
16. A Process which calls itself, directly or through the objects it calls (12.8).
17. A trigger whose `On` is present and is not an array, is empty, or holds a name which is not
    one of the functions in 13.3; whose `When` is present and is neither `"Before"` nor
    `"After"`, or is present without `On` (13.5); or whose `Process` is absent, not a string,
    names no object, names an object which is not a Process, or names a Process with no
    `DataSource` (13.1).

***14.2*** A reader SHOULD report each of the following as a warning.

1. An `Update` which is an object with no keys (10.2).
2. An Insert whose `Documents` is empty (8.1).
3. A Delete whose `Criteria` is `{}` (11.1).
4. A Query with a `SkipCount` and no `Sort` (9.4).
5. A data source setting the adapter does not describe (4.1).
6. An environment reference whose variable is not set where the reader is running (4.6).
7. A `Jsonx` which names a version of this document later than the one the reader was written
   to (15.1).

***14.3*** A reader MAY report each of the following as a note.

1. A Query with no `MaxCount`, on which the runner applied a limit of its own (9.3).
2. A data source, or an object other than a Process, which nothing in the file refers to and no
   trigger watches - often a leftover, sometimes a misspelling.

***14.4*** A reader MUST NOT report a field this document does not define as an error (15.3).

---------------------------------------------------------------------

## 15. Compatibility and versioning

***15.1*** ***A file MAY say which version of this document it was written under***, in its
  `Jsonx` field, as the version on this document's first line (`"0.2"`). A reader MUST NOT
  refuse a file for lacking one, and MUST NOT refuse a file for naming a version it does not
  know; it MAY warn (14.2). ***The field is information, not a switch***: a reader reads every
  file by the rules of the version it was written to, and 15.4 is what makes that safe. No
  object and no trigger carries a version.

***15.2*** A writer which knows the version it writes to SHOULD write `Jsonx`. A writer MUST NOT
  write a version it did not follow.

***15.3*** ***A reader MUST preserve a field it does not define***, on the file and on every
  data source, object and trigger in it. When it reads a file and writes it back, every field it
  did not understand is still there, unchanged. A reader MAY ignore such a field for every other
  purpose, and MUST NOT refuse the file for carrying it.

***15.4*** ***A writer MAY add a field this document does not define***, and SHOULD choose a
  name a later version of this document is unlikely to take.

***15.5*** ***A later version of this document may add fields, kinds, values and reserved
  names. It never changes the meaning of a field this version defines, and never removes
  one.*** A field which is OPTIONAL stays OPTIONAL. A change which cannot be made under that rule
  is made by introducing a ***new Kind name***, so that a reader written to this version refuses
  what it cannot read (5.2) rather than misreading it.

***15.6*** The consequence for a reader is that a file written under a later version of this
  document is either readable under this one, or refused by name. It is never silently wrong.

---------------------------------------------------------------------

## Appendix A - JSON Schema

This schema is normative for the ***structure*** of a jsonx file. It cannot express what only an
  engine can decide - whether a criteria is one jsongin accepts, whether a step operator exists
  - or the relations between elements: that names are unique across the three arrays (3.5), that
  every name used is defined and of the right sort (3.8), that `Into` differs from `DataSource`
  (6.5), that a `$call` names something (12.9), that no Process calls itself (12.8), and that a
  trigger's Process has a `DataSource` (13.1). A reader checks those by hand, and a reader which
  validates against this schema alone has checked shape, not meaning. The update operators are
  defined by jsongin and are not enumerated here, so that this schema does not fall behind the
  engine.

```
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "http://jsonstor.liquicode.com/guides/Jsonx-Specification.md",
  "title": "jsonx file",
  "type": "object",
  "properties": {
    "Jsonx": { "type": "string" },
    "Name": { "type": "string", "minLength": 1 },
    "Description": { "type": "string" },
    "DataSources": { "type": "array", "items": { "$ref": "#/$defs/DataSource" } },
    "Objects": { "type": "array", "items": { "$ref": "#/$defs/Object" } },
    "Triggers": { "type": "array", "items": { "$ref": "#/$defs/Trigger" } }
  },

  "$defs": {

    "Name": {
      "type": "string",
      "minLength": 1,
      "not": { "enum": [
        "Count", "FindOne", "FindMany", "FindMany2",
        "InsertOne", "InsertMany", "UpdateOne", "UpdateMany", "ReplaceOne",
        "DeleteOne", "DeleteMany"
      ] }
    },

    "Reference": { "type": "string", "minLength": 1 },

    "DataSource": {
      "type": "object",
      "required": [ "Name", "AdapterName" ],
      "properties": {
        "Name": { "$ref": "#/$defs/Name" },
        "AdapterName": { "type": "string", "minLength": 1 },
        "Settings": { "type": "object" },
        "Filters": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [ "FilterName" ],
            "properties": {
              "FilterName": { "type": "string", "minLength": 1 },
              "Settings": { "type": "object" }
            }
          }
        }
      }
    },

    "Object": {
      "type": "object",
      "required": [ "Kind", "Name" ],
      "properties": {
        "Kind": { "enum": [ "Insert", "Query", "Update", "Delete", "Process" ] },
        "Name": { "$ref": "#/$defs/Name" }
      },
      "oneOf": [
        { "$ref": "#/$defs/Insert" },
        { "$ref": "#/$defs/Query" },
        { "$ref": "#/$defs/Update" },
        { "$ref": "#/$defs/Delete" },
        { "$ref": "#/$defs/Process" }
      ]
    },

    "Criteria": { "type": "object" },

    "UpdateDocument": {
      "type": "object",
      "propertyNames": { "pattern": "^\\$" }
    },

    "Sort": {
      "type": "object",
      "additionalProperties": { "enum": [ 1, -1 ] }
    },

    "Projection": { "type": "object" },

    "Steps": {
      "type": "array",
      "items": { "type": "object", "minProperties": 1, "maxProperties": 1 }
    },

    "Insert": {
      "type": "object",
      "required": [ "Kind", "Name", "DataSource", "Documents" ],
      "properties": {
        "Kind": { "const": "Insert" },
        "DataSource": { "$ref": "#/$defs/Reference" },
        "Documents": { "type": "array", "items": { "type": "object" } }
      },
      "not": { "required": [ "Into" ] }
    },

    "Query": {
      "type": "object",
      "required": [ "Kind", "Name", "DataSource", "Criteria" ],
      "properties": {
        "Kind": { "const": "Query" },
        "DataSource": { "$ref": "#/$defs/Reference" },
        "Criteria": { "$ref": "#/$defs/Criteria" },
        "Projection": { "$ref": "#/$defs/Projection" },
        "Sort": { "$ref": "#/$defs/Sort" },
        "SkipCount": { "type": "integer", "minimum": 0 },
        "MaxCount": { "type": "integer", "minimum": 1 },
        "Into": { "$ref": "#/$defs/Reference" }
      }
    },

    "Update": {
      "type": "object",
      "required": [ "Kind", "Name", "DataSource", "Criteria", "Update" ],
      "properties": {
        "Kind": { "const": "Update" },
        "DataSource": { "$ref": "#/$defs/Reference" },
        "Criteria": { "$ref": "#/$defs/Criteria" },
        "Update": { "$ref": "#/$defs/UpdateDocument" },
        "FirstOnly": { "type": "boolean" }
      },
      "not": { "required": [ "Into" ] }
    },

    "Delete": {
      "type": "object",
      "required": [ "Kind", "Name", "DataSource", "Criteria" ],
      "properties": {
        "Kind": { "const": "Delete" },
        "DataSource": { "$ref": "#/$defs/Reference" },
        "Criteria": { "$ref": "#/$defs/Criteria" },
        "FirstOnly": { "type": "boolean" }
      },
      "not": { "required": [ "Into" ] }
    },

    "Process": {
      "type": "object",
      "required": [ "Kind", "Name", "Steps" ],
      "properties": {
        "Kind": { "const": "Process" },
        "DataSource": { "$ref": "#/$defs/Reference" },
        "Criteria": { "$ref": "#/$defs/Criteria" },
        "Steps": { "$ref": "#/$defs/Steps" },
        "Into": { "$ref": "#/$defs/Reference" }
      },
      "dependentRequired": { "Criteria": [ "DataSource" ] }
    },

    "Trigger": {
      "type": "object",
      "required": [ "Name", "Process" ],
      "properties": {
        "Name": { "$ref": "#/$defs/Name" },
        "On": {
          "type": "array",
          "minItems": 1,
          "items": { "enum": [ "Insert", "Find", "Update", "Delete" ] }
        },
        "When": { "enum": [ "Before", "After" ] },
        "Process": { "$ref": "#/$defs/Reference" }
      },
      "dependentRequired": { "When": [ "On" ] }
    }
  }
}
```

Three things the schema says loosely on purpose. `Criteria` and `Projection` are open objects,
  because their keys are the writer's own field names and no schema can list them. An update
  document requires only that every key begin with `$`, because the operators are jsongin's to
  define. And a reference to a name (`DataSource`, `Into`, a trigger's `Process`) is only a
  non-empty string, because whether it resolves is a relation the schema cannot see.

---------------------------------------------------------------------

## Appendix B - A complete file

The observatory in one file: four data sources, seven objects, and one trigger. Every data
  source is `jsonstor-memory`, so asking a runner for *Prepare the season* gives the same answer
  anywhere. The Process seeds two collections, confirms the bookings with good seeing, drops the
  cancelled one, assigns a dome to each confirmed booking, and returns the assignments - which is
  its result. The trigger notes the long booking as the bookings arrive.

```
{
  "Jsonx": "0.2",
  "Name": "Observatory",
  "Description": "Telescope bookings for the season.",

  "DataSources": [
    { "Name": "Telescopes", "AdapterName": "jsonstor-memory" },
    { "Name": "Bookings", "AdapterName": "jsonstor-memory" },
    { "Name": "Assignments", "AdapterName": "jsonstor-memory" },
    { "Name": "Notes", "AdapterName": "jsonstor-memory" }
  ],

  "Objects": [
    { "Kind": "Insert", "Name": "Two telescopes", "DataSource": "Telescopes",
      "Documents": [
        { "Name": "Meridian 40", "Aperture": 400, "Site": { "Dome": "B" } },
        { "Name": "Dobson 30", "Aperture": 300, "Site": { "Dome": "A" } }
      ] },

    { "Kind": "Insert", "Name": "Three bookings", "DataSource": "Bookings",
      "Documents": [
        { "_id": "b-1", "Telescope": "Meridian 40", "Observer": "R. Okafor", "Hours": 8, "Seeing": 2.1, "Status": "requested" },
        { "_id": "b-2", "Telescope": "Dobson 30", "Observer": "M. Lindqvist", "Hours": 3, "Seeing": 3.4, "Status": "requested" },
        { "_id": "b-3", "Telescope": "Dobson 30", "Observer": "R. Okafor", "Hours": 4, "Seeing": 1.8, "Status": "cancelled" }
      ] },

    { "Kind": "Update", "Name": "Confirm the bookings with good seeing", "DataSource": "Bookings",
      "Criteria": { "Status": "requested", "Seeing": { "$lt": 2.5 } },
      "Update": { "$set": { "Status": "confirmed" } } },

    { "Kind": "Delete", "Name": "Drop the cancelled bookings", "DataSource": "Bookings",
      "Criteria": { "Status": "cancelled" } },

    { "Kind": "Process", "Name": "Assign a dome to each confirmed booking", "DataSource": "Bookings",
      "Criteria": { "Status": "confirmed" },
      "Steps": [
        { "$call": { "Name": "FindOne",
                     "With": { "DataSource": "Telescopes", "Criteria": { "Name": "$Document.Telescope" } },
                     "Into": "Telescope" } },
        { "$return": { "Booking": "$Document._id", "Observer": "$Document.Observer", "Dome": "$Telescope.Site.Dome" } }
      ],
      "Into": "Assignments" },

    { "Kind": "Process", "Name": "Note a long booking", "DataSource": "Bookings",
      "Criteria": { "Hours": { "$gt": 6 } },
      "Steps": [
        { "$return": { "Booking": "$Document._id", "Note": { "$concat": [ "Long booking on ", "$Document.Telescope" ] } } }
      ],
      "Into": "Notes" },

    { "Kind": "Process", "Name": "Prepare the season",
      "Steps": [
        { "$call": { "Name": "Two telescopes" } },
        { "$call": { "Name": "Three bookings" } },
        { "$call": { "Name": "Confirm the bookings with good seeing" } },
        { "$call": { "Name": "Drop the cancelled bookings" } },
        { "$call": { "Name": "Assign a dome to each confirmed booking", "Into": "Assigned" } },
        { "$return": "$Assigned" }
      ] }
  ],

  "Triggers": [
    { "Name": "Note every long booking as it arrives",
      "On": [ "Insert" ], "When": "After",
      "Process": "Note a long booking" }
  ]
}
```

Asking for *Prepare the season* returns one assignment:

```
[ { "Booking": "b-1", "Observer": "R. Okafor", "Dome": "B" } ]
```

and on the way, the trigger has inserted `{ "Booking": "b-1", "Note": "Long booking on
  Meridian 40" }` into `Notes`, because *Three bookings* inserted a booking of eight hours
  through the runner which holds the file.

Pointed at real stores instead - `Bookings` to a spreadsheet, `Assignments` to a database table
  whose password is `${env:ASSIGNMENTS_PASSWORD}` - the same objects read the one and write the
  other, and a Process which leaves out the two Inserts does the season's work against them.

See [Storage Adapters](http://jsonstor.liquicode.com/#/guides/Storage-Adapters.md) for what a data source can name,
  [Storage Invariants](http://jsonstor.liquicode.com/#/guides/Storage-Invariants.md) for what every data source is guaranteed
  to do, [Translation Layer](http://jsonstor.liquicode.com/#/guides/Translation-Layer.md) for how a criteria reaches a store,
  and the two Language Model guides, [jsongin's](http://jsongin.liquicode.com/#/guides/Llm-Context.md) and
  [jsonproc's](http://jsonproc.liquicode.com/#/guides/Llm-Context.md), for the vocabulary inside the objects.
