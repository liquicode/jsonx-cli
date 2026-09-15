'use strict';

/*
	Input (plan F5.2) as one Monaco editor: a command line, or a JSON entry once the text begins with {.

	-	***Monaco loads once***, with Studio's inline worker so its JSON worker gets an absolute URL
		(measured under headless Chrome in step 3: the worker's diagnostics arrive).
	-	***Completion is the process's***: Tab or Ctrl+Space asks `Complete` with the text up to the cursor,
		and each suggestion inserts what the answer's Items say - a name already quoted - over what they say
		it replaces. Monaco's own JSON completion is turned off, so the suggestions are jsonx's alone.
	-	Enter sends a command; in JSON it is a new line, and Ctrl+S saves the entry. Escape leaves Input.
	-	***Brackets and quotes are not closed for you***, so what is typed is what arrives, as in the TUI.
	-	A check's findings are drawn as markers, at the key their path ends in when the text has it.
*/

angular.module( 'JsonxWeb' ).factory( 'Monaco', [ '$q', '$window',
	function ( $q, $window )
	{
		let loading = null;

		return {
			Load: function ()
			{
				if ( loading !== null ) { return loading; }
				let deferred = $q.defer();
				loading = deferred.promise;

				let base = $window.location.origin + '/ui/vendor/monaco/min/';
				$window.MonacoEnvironment = {
					getWorkerUrl: function ()
					{
						let source = 'self.MonacoEnvironment = { baseUrl: "' + base + '" };' + 'importScripts( "' + base + 'vs/base/worker/workerMain.js" );';
						return 'data:text/javascript;charset=utf-8,' + encodeURIComponent( source );
					},
				};

				let script = $window.document.createElement( 'script' );
				script.src = 'vendor/monaco/min/vs/loader.js';
				script.onload = function ()
				{
					$window.require.config( { paths: { vs: 'vendor/monaco/min/vs' } } );
					$window.require( [ 'vs/editor/editor.main' ], function ()
					{
						let json = $window.monaco.languages.json.jsonDefaults;
						json.setDiagnosticsOptions( { validate: true, allowComments: false, schemas: [], enableSchemaRequest: false } );
						json.setModeConfiguration( Object.assign( {}, json.modeConfiguration, { completionItems: false, hovers: false } ) );
						deferred.resolve( $window.monaco );
					} );
				};
				script.onerror = function () { deferred.reject( new Error( 'Monaco did not load.' ) ); };
				$window.document.head.appendChild( script );
				return loading;
			},
		};
	}
] );


//---------------------------------------------------------------------
angular.module( 'JsonxWeb' ).directive( 'jsonxInput', [ 'Monaco', 'JsonxSession', '$timeout',
	function ( Monaco, JsonxSession, $timeout )
	{
		return {
			restrict: 'A',
			link: function ( Scope, Element )
			{
				let host = Element[ 0 ];
				let state = JsonxSession.State;
				let editor = null;
				let monaco = null;
				let command_mode = null;
				let applying = false;
				let providers = [];

				Monaco.Load().then( function ( Loaded )
				{
					monaco = Loaded;
					editor = monaco.editor.create( host, {
						value: state.Input.Text,
						language: 'plaintext',
						automaticLayout: true,
						minimap: { enabled: false },
						lineNumbers: 'off',
						glyphMargin: false,
						folding: false,
						scrollBeyondLastLine: false,
						wordWrap: 'on',
						fontSize: 13,
						renderLineHighlight: 'none',
						quickSuggestions: false,
						suggestOnTriggerCharacters: false,
						autoClosingBrackets: 'never',
						autoClosingQuotes: 'never',
						autoSurround: 'never',
						tabCompletion: 'off',
						fixedOverflowWidgets: true,
						ariaLabel: 'Input: a command, or a JSON entry',
					} );
					command_mode = editor.createContextKey( 'jsonxCommandMode', true );

					register_completion();

					// Enter sends a command; the suggest widget keeps Enter while it is open.
					editor.addCommand( monaco.KeyCode.Enter, function () { submit(); }, 'jsonxCommandMode && !suggestWidgetVisible' );
					editor.addCommand( monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () { save(); } );
					editor.addCommand( monaco.KeyCode.Tab, function () { editor.trigger( 'jsonx', 'editor.action.triggerSuggest', {} ); }, '!suggestWidgetVisible' );
					editor.addCommand( monaco.KeyCode.Escape, function () { leave(); }, '!suggestWidgetVisible' );

					editor.onDidChangeModelContent( function ()
					{
						if ( applying ) { return; }
						let text = editor.getValue();
						set_mode( text );
						Scope.$applyAsync( function () { JsonxSession.SetInput( text, { Typed: true } ); } );
						return;
					} );

					Scope.$watch( function () { return state.Input.Text; }, function ( Text )
					{
						if ( editor === null || Text === editor.getValue() ) { return; }
						applying = true;
						editor.setValue( Text );
						applying = false;
						set_mode( Text );
						let model = editor.getModel();
						editor.setPosition( model.getPositionAt( Text.length ) );
						return;
					} );

					Scope.$watchCollection( function () { return state.Input.Findings; }, draw_markers );
					Scope.$on( 'jsonx.focus-input', function () { if ( editor ) { editor.focus(); } } );

					set_mode( editor.getValue() );
					host.setAttribute( 'data-ready', 'true' );
					return;
				}, function ( error )
				{
					JsonxSession.Log( 'error', error.message );
					return;
				} );


				//---------------------------------------------------------------------
				function set_mode( Text )
				{
					let json = String( Text ).trim()[ 0 ] === '{';
					command_mode.set( !json );
					let model = editor.getModel();
					let language = json ? 'json' : 'plaintext';
					if ( model.getLanguageId() !== language ) { monaco.editor.setModelLanguage( model, language ); }
					host.parentElement.classList.toggle( 'is-json', json );
					return;
				}

				function submit()
				{
					Scope.$applyAsync( function () { JsonxSession.Submit(); } );
					return;
				}

				function save()
				{
					Scope.$applyAsync( function () { JsonxSession.Submit(); } );
					return;
				}

				function leave()
				{
					$timeout( function ()
					{
						let entry = document.querySelector( '.jsonx-entry.selected' ) || document.querySelector( '.jsonx-entry' );
						if ( entry ) { entry.focus(); }
						else if ( document.activeElement ) { document.activeElement.blur(); }
						return;
					} );
					return;
				}


				//---------------------------------------------------------------------
				function register_completion()
				{
					let provider = {
						provideCompletionItems: function ( Model, Position )
						{
							let end = Model.getOffsetAt( Position );
							let text = Model.getValue().slice( 0, end );
							return JsonxSession.Complete( text ).then( function ( Completion )
							{
								if ( !Completion ) { return { suggestions: [] }; }
								return {
									suggestions: Completion.Items.map( function ( Item, Index )
									{
										let start = Model.getPositionAt( end - Item.Replace );
										return {
											label: Item.Label,
											kind: Completion.Json ? monaco.languages.CompletionItemKind.Value : monaco.languages.CompletionItemKind.Keyword,
											insertText: Item.Insert,
											filterText: Item.Insert,
											sortText: String( 100000 + Index ),
											range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: Position.lineNumber, endColumn: Position.column },
										};
									} ),
								};
							} );
						},
					};
					providers.push( monaco.languages.registerCompletionItemProvider( 'plaintext', provider ) );
					providers.push( monaco.languages.registerCompletionItemProvider( 'json', provider ) );
					return;
				}


				//---------------------------------------------------------------------
				// A finding at the key its path ends in, when the text has one; else over the first line.
				function draw_markers( Findings )
				{
					if ( editor === null ) { return; }
					let model = editor.getModel();
					let text = model.getValue();
					let markers = ( Findings || [] ).map( function ( Finding )
					{
						let parts = String( Finding.Path || '' ).split( '.' ).filter( function ( Part ) { return Part !== '' && !/^\d+$/.test( Part ); } );
						let key = parts.length ? parts[ parts.length - 1 ] : null;
						let at = key ? text.indexOf( '"' + key + '"' ) : -1;
						let start = ( at >= 0 ) ? model.getPositionAt( at ) : { lineNumber: 1, column: 1 };
						let finish = ( at >= 0 ) ? model.getPositionAt( at + key.length + 2 ) : { lineNumber: 1, column: model.getLineMaxColumn( 1 ) };
						return {
							severity: ( Finding.Severity === 'error' ) ? monaco.MarkerSeverity.Error : ( Finding.Severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info ),
							message: Finding.Message,
							startLineNumber: start.lineNumber, startColumn: start.column,
							endLineNumber: finish.lineNumber, endColumn: finish.column,
						};
					} );
					monaco.editor.setModelMarkers( model, 'jsonx', markers );
					return;
				}


				Scope.$on( '$destroy', function ()
				{
					providers.forEach( function ( Each ) { Each.dispose(); } );
					if ( editor !== null ) { editor.dispose(); }
					return;
				} );
				return;
			},
		};
	}
] );
