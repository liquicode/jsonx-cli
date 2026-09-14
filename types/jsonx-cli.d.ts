// Type declarations for @liquicode/jsonx-cli
//
// ***Hand written, and hand written on purpose.*** The library is Javascript and stays
// Javascript: TypeScript is ***supported and never required***.
//
// `build/types-check.js` loads the running library and asserts three levels agree with this file:
// the package members and `src/jsonx-cli.mjs`; every group and component under `Library`
// (`LibraryComponents`); and every member of every component (its `...Module` interface).

declare module '@liquicode/jsonx-cli'
{

	//---------------------------------------------------------------------
	// Documents and the shapes the components share.

	/** A document is an object. A jsonx file, a data source, an object and a trigger are all documents. */
	export type JsonDocument = { [ Key: string ]: any };

	/** One validation finding (spec section 14). Path is dotted from the root of the file; the root is ''. */
	export interface Finding
	{
		Severity: 'error' | 'warning' | 'note';
		Path: string;
		Message: string;
	}

	/** Where a command reads and writes. Every member is optional to a component which does not use it. */
	export interface Io
	{
		Stdout?: ( Text: string ) => void;
		Stderr?: ( Text: string ) => void;
		ReadFile?: ( Path: string ) => string;
		ReadStdin?: () => string;
		ListDirectory?: ( Path: string ) => string[];
		/** Standard input a line at a time, for jsonx debug. */
		Lines?: () => AsyncIterable<string>;
		WriteFile?: ( Path: string, Text: string ) => void;
		Env?: { [ Name: string ]: string };
		Cwd?: string;
	}

	/** What one storage call measured, with Statistics on. */
	export interface CallStatistics
	{
		Function: string;
		DataSource: string;
		Adapter: string;
		Measured: boolean;
		Translator: string;
		Pushdown: any;
		PushdownRows: number;
		Residual: any;
		ResidualRows: number;
	}

	/** The report of one object run: the objects it called, the Processes its writes triggered. */
	export interface RunReport
	{
		Name: string;
		Kind: string | null;
		Ok: boolean;
		Result: any;
		Summary: string;
		Ms: number;
		Error: { Code: string; Message: string } | null;
		Calls: RunReport[];
		Fired: RunReport[];
		Statistics: CallStatistics[];
		/** What jsonstor-oplog wrote for this object's storage calls, with Trace on. */
		Trace: string[];
		/** Present on a Process a trigger started, and on a trigger run by hand. */
		Trigger?: string;
	}

	/** One node of a plan's static call tree. */
	export interface PlanNode
	{
		Name: string;
		Kind: string | null;
		Does: Array<{ Function: string; DataSource: string | null; Computed?: string; Into?: boolean } | { Object: PlanNode }>;
		Missing?: boolean;
		Repeats?: boolean;
	}

	/** A dry run: what running an object would do, with nothing opened. */
	export interface Plan
	{
		Name: string;
		Kind: string;
		Findings: Finding[];
		Tree: PlanNode;
		DataSources: Array<{ Name: string; Defined: boolean; AdapterName?: string; Installed?: boolean | null; Settings?: JsonDocument; Environment?: Array<{ Name: string; Set: boolean }> }>;
		Triggers: Array<{ Name: string; Process: string; DataSource: string; On: string[] }>;
	}

	/** An entry of a file's DataSources, Objects or Triggers. */
	export interface NameEntry
	{
		Section: 'DataSources' | 'Objects' | 'Triggers';
		Index: number;
		Entry: JsonDocument;
		Name: string | null;
		Path: string;
	}

	/** One place a name is used. */
	export interface NameReference
	{
		Name: string;
		Sort: 'DataSource' | 'Object' | 'Process';
		Path: string;
		Owner: string | null;
		Field: string;
		HasWith?: boolean;
	}

	/** An option of a command. */
	export interface OptionDeclaration
	{
		Type?: 'string' | 'number' | 'integer' | 'boolean' | 'json' | 'jsonl';
		Alias?: string;
		Default?: any;
		Repeat?: boolean;
		Required?: boolean;
		Choices?: any[];
		Inherit?: boolean;
		Describe?: string;
	}

	/** A positional argument of a command. */
	export interface PositionalDeclaration extends OptionDeclaration
	{
		Name: string;
	}

	/** A node of a command tree. */
	export interface CommandNode
	{
		Command: string;
		/** Other words which reach this node; a parse names the node by Command. */
		Aliases?: string[];
		/** True keeps the node out of help; it still parses. */
		Hidden?: boolean;
		Describe?: string;
		Commands?: CommandNode[];
		Positionals?: PositionalDeclaration[];
		Options?: { [ Name: string ]: OptionDeclaration };
		GlobalOptions?: { [ Name: string ]: OptionDeclaration };
		Handler?: ( Parsed: ParsedArguments, Context: any ) => Promise<number>;
		/** The library functions the command reaches, such as 'jsonstor.FindMany2' (plan F3.12). */
		Library?: string[];
	}

	/** A parsed command line. */
	export interface ParsedArguments
	{
		Path: string[];
		Positionals: { [ Name: string ]: any };
		Options: { [ Name: string ]: any };
		Given: { [ Name: string ]: boolean };
		Help: boolean;
		/** Whether a value, or the input document, was read from standard input. */
		StdinRead?: boolean;
	}

	/** The answer of an edit. */
	export interface EditOutcome
	{
		Ok: boolean;
		Refused: boolean;
		Findings: Finding[];
		Result: any;
	}

	/** An adapter catalog over one jsonstor instance. */
	export interface AdapterCatalog
	{
		Report: { Loaded: string[]; NotInstalled: string[]; Failed: Array<{ Package: string; Message: string }> };
		Ensure( AdapterName: string ): boolean;
		Entry( AdapterName: string ): JsonDocument | null;
		PathSettings( AdapterName: string ): string[];
		ValidateSettings( AdapterName: string, Settings: JsonDocument ): Finding[];
	}

	/** A session's data sources. */
	export interface DataSourceSet
	{
		Definition( Name: string ): JsonDocument;
		Names(): string[];
		Open( Name: string ): any;
		Opened(): string[];
		Release(): Promise<number>;
	}

	/** One jsonx file held open with everything needed to run it. */
	export interface Session
	{
		Document: JsonDocument;
		Path: string | null;
		jsonstor: any;
		Catalog: AdapterCatalog;
		DataSources: DataSourceSet;
		Host: any;
		Runner: any;
		Run( Name: string, Input?: JsonDocument ): Promise<RunReport>;
		RunTrigger( Name: string ): Promise<RunReport>;
		Release(): Promise<number>;
	}


	//---------------------------------------------------------------------
	// The component modules.

	export interface ParserModule
	{
		TYPES: string[];
		UsageError: new ( Message: string, Path?: string[] ) => Error;
		DefaultIo(): Io;
		CheckTree( Tree: CommandNode ): void;
		CanonicalPath( Tree: CommandNode, Path: string[] ): string[];
		OptionsAt( Tree: CommandNode, Path: string[] ): { [ Name: string ]: OptionDeclaration };
		NodesOnPath( Tree: CommandNode, Path: string[] ): CommandNode[];
		NodeAt( Tree: CommandNode, Path: string[] ): CommandNode;
		ParseArgs( Tree: CommandNode, Argv: string[], Io?: Io ): ParsedArguments;
		Value( Tree: CommandNode, Parsed: ParsedArguments, Name: string ): any;
		coerce( Declaration: OptionDeclaration, Label: string, Text: string, Io: Io, State: JsonDocument, Path: string[] ): any;
	}

	export interface HelpModule
	{
		HelpText( Tree: CommandNode, Path: string[] ): string;
	}

	export interface InputJsonModule
	{
		OPTION_NAME: string;
		ParseDocument( Tree: CommandNode, Document: JsonDocument ): ParsedArguments;
		ParseInvocation( Tree: CommandNode, Argv: string[], Io?: Io ): ParsedArguments;
	}

	export interface ReaderModule
	{
		FileError: new ( Message: string, IsUsage?: boolean ) => Error;
		ParseText( Text: string ): { Document: any; Findings: Finding[] };
		ReadText( Path: string, Io?: Io ): string;
		ResolvePath( File: string | null | undefined, Env: JsonDocument, Cwd: string, Io?: Io ): { Path: string; Source: '--file' | 'JSONX_FILE' | 'directory' };
	}

	export interface WriterModule
	{
		FormatDocument( Document: JsonDocument ): string;
		WriteFile( Path: string, Document: JsonDocument, Io?: Io | null ): string;
	}

	export interface NamesModule
	{
		SECTIONS: string[];
		HOST_FUNCTIONS: string[];
		RESERVED_NAMES: string[];
		NESTED_STEPS: { [ Operator: string ]: string[] };
		Entries( Document: JsonDocument ): NameEntry[];
		FindEntry( Document: JsonDocument, Name: string ): NameEntry | null;
		WalkSteps( Steps: any[], Path: string, Visit: ( Step: JsonDocument, Operator: string, Path: string ) => void ): void;
		References( Document: JsonDocument ): NameReference[];
	}

	export interface SchemaModule
	{
		SCHEMA: JsonDocument;
		SPEC_VERSION: string;
	}

	export interface EditModule
	{
		NOUNS: { [ Noun: string ]: { Section: string; Kind: string | null; Label: string; Plural: string } };
		EditError: new ( Message: string ) => Error;
		List( Document: JsonDocument, Noun: string ): JsonDocument[];
		Show( Document: JsonDocument, Noun: string, Name: string ): JsonDocument;
		Add( Document: JsonDocument, Noun: string, Body: JsonDocument, Options?: { Force?: boolean; Validate?: JsonDocument } ): EditOutcome;
		Set( Document: JsonDocument, Noun: string, Name: string, Body: JsonDocument, Options?: { Force?: boolean; Validate?: JsonDocument } ): EditOutcome;
		Remove( Document: JsonDocument, Noun: string, Name: string, Options?: { Force?: boolean } ): EditOutcome;
		Rename( Document: JsonDocument, Noun: string, Name: string, NewName: string, Options?: { Force?: boolean; Validate?: JsonDocument } ): EditOutcome;
	}

	export interface ValidateModule
	{
		KINDS: string[];
		TRIGGER_FUNCTIONS: string[];
		ValidateFile( Document: any, Options?: { jsongin?: any; jsonproc?: any; Env?: JsonDocument; CheckSettings?: ( AdapterName: string, Settings: JsonDocument ) => Finding[] } ): Finding[];
		ValidateEntry( Document: JsonDocument, Name: string, Options?: JsonDocument ): Finding[] | null;
		SortFindings( Findings: Finding[] ): Finding[];
		Summarize( Findings: Finding[] ): { Errors: number; Warnings: number; Notes: number };
		PointerToPath( Pointer: string ): string;
	}

	/** An entry of a file in English. Kind is the object's Kind, or 'DataSource' or 'Trigger'. */
	export interface Explanation
	{
		Name: string;
		Kind: string | null;
		Lines: string[];
	}

	export interface ExplainModule
	{
		QUERY_PHRASES: { [ Operator: string ]: ( Operand: any ) => string };
		JOIN_PHRASES: { [ Operator: string ]: string };
		STANDALONE_PHRASES: { [ Operator: string ]: ( Operand: any ) => string };
		UPDATE_PHRASES: { [ Operator: string ]: ( Operand: any ) => string };
		STEP_PHRASES: { [ Operator: string ]: ( Operand: any, Document?: JsonDocument ) => string };
		ExplainCriteria( Criteria: any ): string;
		ExplainUpdateDocument( Update: any ): string;
		ExplainStep( Step: any, Document?: JsonDocument ): string;
		ExplainEntry( Document: JsonDocument, Name: string ): Explanation | null;
	}

	export interface EnvironmentModule
	{
		REFERENCE_PATTERN: RegExp;
		References( DataSource: JsonDocument ): Array<{ Name: string; Path: string }>;
		IsSet( Env: JsonDocument, Name: string ): boolean;
		Resolve( Value: any, Env: JsonDocument ): any;
		Mask( Entry: any ): any;
	}

	export interface AdapterCatalogModule
	{
		DATA: JsonDocument[];
		NewAdapterCatalog( Options: { jsonstor: any; Require?: ( PackageName: string ) => any; Data?: JsonDocument[] } ): AdapterCatalog;
		type_agrees( Type: string, Value: any ): boolean;
	}

	export interface OverridesModule
	{
		OverrideError: new ( Message: string ) => Error;
		IsRelativePath( Value: any ): boolean;
		Apply( Document: JsonDocument, Binds?: string[], Sets?: string[], Cwd?: string, PathSettings?: ( AdapterName: string ) => string[] ): { [ Name: string ]: JsonDocument };
	}

	export interface DataSourcesModule
	{
		DataSourceError: new ( Message: string, Name?: string ) => Error;
		NewDataSources( Options: JsonDocument ): DataSourceSet;
	}

	export interface HostModule
	{
		DEFAULT_MAX_STEPS: number;
		DEFAULT_MAX_CALLS: number;
		NewHost( Settings?: { MaxSteps?: number; MaxCalls?: number } ): { MaxSteps: number; MaxCalls: number; Run( Process: JsonDocument, Input: JsonDocument, Handler: ( Name: string, With: JsonDocument ) => Promise<any> ): Promise<JsonDocument> };
	}

	export interface TriggersModule
	{
		FILTER_NAME: string;
		WATCHED_FUNCTIONS: { [ FunctionName: string ]: string };
		CriteriaForDocuments( Documents: JsonDocument[], KeyFields: string[] ): JsonDocument | null;
		NewTriggerFilter(): JsonDocument;
	}

	export interface RunnerModule
	{
		HOST_PARAMETERS: { [ FunctionName: string ]: string[] };
		/** The host functions and the four storage functions only the ad hoc verbs make. */
		STORAGE_PARAMETERS: { [ FunctionName: string ]: string[] };
		/** The report name of a run no object of the file made. */
		AD_HOC: string;
		RunError: new ( Message: string, Code?: string ) => Error;
		NewRunner( Options: JsonDocument ): any;
	}

	export interface SessionModule
	{
		SessionError: new ( Message: string ) => Error;
		NewSession( Options: { Document: JsonDocument; Path?: string; Binds?: string[]; Sets?: string[]; Env?: JsonDocument; Cwd?: string; jsonstor?: any; Require?: ( PackageName: string ) => any; MaxSteps?: number; MaxCalls?: number; Statistics?: boolean; Trace?: boolean } ): Session;
	}

	export interface PlanModule
	{
		PlanObject( Document: JsonDocument, Name: string, Options?: JsonDocument ): Plan | null;
	}

	export interface InspectModule
	{
		DEFAULT_ROWS: number;
		Info( Session: Session, Name: string ): Promise<{ Name: string; AdapterName: string; Info: JsonDocument; Boundary: string[] }>;
		Describe( Session: Session, Name: string, Rows?: number ): Promise<{ Name: string; Schema: JsonDocument; Samples: JsonDocument[] }>;
	}

	/** One ad hoc storage verb. */
	export interface VerbDeclaration
	{
		Kind: 'Query' | 'Insert' | 'Update' | 'Delete' | null;
		Functions: string[];
		Guard: 'criteria' | 'always' | null;
		Describe: string;
	}

	export interface VerbsModule
	{
		VERBS: { [ Verb: string ]: VerbDeclaration };
		VerbError: new ( Message: string ) => Error;
		/** The object a verb with a kind stands for. Values are named as the command's options are. */
		BuildObject( Verb: string, DataSource: string, Values: JsonDocument, Name?: string ): JsonDocument;
		/** Why the verb is refused without --yes, or null. */
		Guard( Verb: string, Values: JsonDocument ): string | null;
		/** The errors a built object has under the file's rules; paths read `(ad hoc)...`. */
		ValidateObject( Document: JsonDocument, Entry: JsonDocument, ValidateOptions?: JsonDocument ): Finding[];
		Run( Session: Session, Verb: string, DataSource: string, Values: JsonDocument ): Promise<RunReport>;
	}

	/** One engine verb. */
	export interface EngineVerbDeclaration
	{
		/** A sub-group the verb sits in, such as 'schema'. */
		Group?: string;
		Describe: string;
		Inputs: { [ Name: string ]: OptionDeclaration };
		Positionals?: PositionalDeclaration[];
		/** The jsongin members the verb reaches. */
		Library: string[];
		/** True when the result is a findings list. */
		Findings?: boolean;
		Run( Values: JsonDocument ): any;
	}

	export interface EngineModule
	{
		ENGINE_VERBS: { [ Verb: string ]: EngineVerbDeclaration };
		EngineError: new ( Message: string ) => Error;
		/** Throws EngineError for an input mistake; a refusal from jsongin is an error finding. */
		Run( Verb: string, Values: JsonDocument ): { Result: any; Findings: Finding[] };
	}

	/** One name an adapter package answers to. */
	export interface AdapterNameRow
	{
		Name: string;
		/** The prime an alias resolves to; null for a prime or a package with no family. */
		AliasOf: string | null;
		/** The server version it was measured against, such as '8.4'; null when none. */
		MeasuredAgainst: string | null;
	}

	/** The adapters a data source can name. */
	export interface AdapterSet
	{
		List(): Array<{ AdapterName: string; Kind: 'built-in' | 'external'; Package: string; Installed: boolean; Description: string }>;
		Info( Name: string ): { AdapterName: string; Kind: string; Package: string; Installed: boolean; Description: string; Requested?: string; Driver?: JsonDocument; Names?: AdapterNameRow[]; Settings: JsonDocument[] };
		Settings( Name: string, DataSourceName?: string ): { Name: string; AdapterName: string; Settings: JsonDocument };
	}

	export interface AdaptersModule
	{
		AdaptersError: new ( Message: string ) => Error;
		NewAdapters( Options?: { Data?: JsonDocument[]; Require?: ( PackageName: string ) => any; Resolve?: ( PackageName: string ) => string } ): AdapterSet;
	}

	/** Where a debug is: a snapshot, written as one JSON line per command. */
	export interface DebugSnapshot
	{
		Command?: string;
		Depth?: number;
		Process?: string;
		Document?: { Index: number; Of: number };
		Status?: 'ready' | 'waiting' | 'done' | 'failed';
		Cursor?: any[];
		/** The step the cursor points at, in English. */
		Step?: string;
		State?: JsonDocument;
		Waiting?: { Name: string; With: JsonDocument; Into?: string };
		/** What a declined call would have done. */
		Declined?: JsonDocument;
		Finished?: boolean;
		Outcome?: 'done' | 'failed' | 'quit';
		Result?: any;
		Error?: any;
	}

	/** A Process debugged a step at a time over one session. */
	export interface ProcessDebugger
	{
		Frames: JsonDocument[];
		Finished: boolean;
		Outcome: 'done' | 'failed' | 'quit' | null;
		/** The debugged Process's run report, nested as jsonx run's would be. */
		Report: RunReport | null;
		Start(): Promise<DebugSnapshot>;
		/** step, into, continue, decline, answer <json>, state, skip or quit. */
		Command( Line: string ): Promise<DebugSnapshot>;
		Snapshot(): DebugSnapshot;
	}

	export interface DebuggerModule
	{
		COMMANDS: string[];
		DebugError: new ( Message: string ) => Error;
		/** The step a cursor points at, or null. */
		StepAt( Process: JsonDocument, Cursor: any[] ): JsonDocument | null;
		NewDebugger( Session: Session, Name: string, Input?: JsonDocument ): ProcessDebugger;
	}

	export interface ReportModule
	{
		FormatResult( Output: 'json' | 'jsonl', Value: any ): string;
		WriteResult( Io: Io, Output: 'json' | 'jsonl', Value: any ): void;
		FormatFinding( Finding: Finding ): string;
		FormatSummary( Label: string, Summary: { Errors: number; Warnings: number; Notes: number } ): string;
		FormatRunReport( RunReport: RunReport, Depth?: number, Options?: { Statistics?: boolean; Trace?: boolean } ): string;
		FormatPlan( Plan: Plan ): string;
	}


	//---------------------------------------------------------------------
	// The library's components, by group.

	export interface LibraryComponents
	{
		CommandLine: {
			Parser: ParserModule;
			Help: HelpModule;
			InputJson: InputJsonModule;
		};
		File: {
			Reader: ReaderModule;
			Writer: WriterModule;
			Names: NamesModule;
			Schema: SchemaModule;
			Edit: EditModule;
		};
		Validate: ValidateModule;
		Explain: ExplainModule;
		Session: {
			Environment: EnvironmentModule;
			AdapterCatalog: AdapterCatalogModule;
			Overrides: OverridesModule;
			DataSources: DataSourcesModule;
			Host: HostModule;
			Triggers: TriggersModule;
			Runner: RunnerModule;
			Session: SessionModule;
			Plan: PlanModule;
			Inspect: InspectModule;
			Debugger: DebuggerModule;
		};
		Storage: {
			Verbs: VerbsModule;
		};
		Engine: EngineModule;
		Adapters: AdaptersModule;
		Report: ReportModule;
	}


	//---------------------------------------------------------------------
	// The library.

	export interface JsonxCliLibrary
	{
		/** The version of this package. */
		Version: string;
		/** The components, by group. */
		Library: LibraryComponents;
	}


	//---------------------------------------------------------------------
	// Named exports.

	export const Version: JsonxCliLibrary[ 'Version' ];
	export const Library: JsonxCliLibrary[ 'Library' ];

	const LIBRARY: JsonxCliLibrary;
	export default LIBRARY;
}
