'use strict';

/*
	The jsonx terminal (plan O7, cut 6): a transcript and one line, on the file's own process.

	***It is a jsonx terminal, not a shell.*** Nothing typed here reaches an operating system shell: every
	line goes to the process as a `Line` request, which reads it with the same command table the CLI uses
	and answers what sending it would do. `serve`, `mcp`, `tui` and `completion` are refused there, so this
	page never has to know which commands are not for a front end.

	It is the Web UI's pieces in one pane: JsonxClient for the connection and its token, JsonxTheme for the
	look, and the process for every decision - what a line means, what completes it, and what it answers.

		Enter       sends the line
		Tab         completions from the process; one candidate is inserted, several are listed
		Up, Down    this page's own history
		y / n       answers the confirmation the --yes rule asks for
		a debug     opens as a conversation: its commands are typed until it ends
*/

angular.module( 'JsonxWeb' ).controller( 'TerminalController', [ 'JsonxClient', 'JsonxView', 'JsonxHost', '$q', '$timeout', '$window', '$scope',
	function ( JsonxClient, JsonxView, JsonxHost, $q, $timeout, $window, $scope )
	{
		const LINE_LIMIT = 2000;

		let terminal = this;
		let state = {
			Connection: 'connecting',
			Hello: null,
			Message: null,
			TokenNeeded: false,
			Token: '',
			Lines: [],
			Text: '',
			Busy: 0,
			Confirm: null,
			Debug: null,
		};

		let history = [];
		let history_at = 0;

		terminal.State = state;
		terminal.View = JsonxView;
		terminal.Host = JsonxHost;


		//---------------------------------------------------------------------
		function write( Kind, Text )
		{
			String( Text ).split( /\r?\n/ ).forEach( function ( Line, Index, All )
			{
				if ( Line === '' && Index === All.length - 1 ) { return; }
				state.Lines.push( { Kind: Kind, Text: Line } );
			} );
			if ( state.Lines.length > LINE_LIMIT ) { state.Lines.splice( 0, state.Lines.length - LINE_LIMIT ); }
			$timeout( scroll_down );
			return;
		}

		function scroll_down()
		{
			let transcript = $window.document.getElementById( 'jsonx-transcript' );
			if ( transcript ) { transcript.scrollTop = transcript.scrollHeight; }
			return;
		}

		function finding_text( Finding )
		{
			return Finding.Severity + '  ' + ( Finding.Path ? Finding.Path + ': ' : '' ) + Finding.Message;
		}


		//---------------------------------------------------------------------
		// Connecting: the same config, token and ticket the Web UI uses.

		terminal.Start = function ()
		{
			JsonxClient.OnClose( function ()
			{
				state.Connection = 'closed';
				write( 'error', 'The connection to the jsonx process closed.' );
				return;
			} );

			return JsonxClient.Config().then( function ( Config )
			{
				if ( Config.TokenRequired )
				{
					state.Connection = 'closed';
					state.TokenNeeded = true;
					state.Message = 'This jsonx process needs a token.';
					let kept = read_token();
					return kept ? terminal.UseToken( kept ) : null;
				}
				return connected( JsonxClient.Connect() );
			} ).catch( function ( error )
			{
				state.Connection = 'closed';
				state.Message = error.message;
				return null;
			} );
		};

		function connected( Connecting )
		{
			return Connecting.then( function ( Hello )
			{
				state.Connection = 'open';
				state.Hello = Hello;
				state.Message = null;
				state.TokenNeeded = false;
				write( 'text', 'jsonx ' + ( Hello.Version || '' ) + ' - ' + Hello.File );
				write( 'text', 'Type a jsonx command. This is not a system shell.' );
				return Hello;
			} );
		}

		const TOKEN_STORE = 'jsonx-web.token';
		function read_token() { try { return $window.sessionStorage.getItem( TOKEN_STORE ); } catch ( error ) { return null; } }
		function keep_token( Token ) { try { $window.sessionStorage.setItem( TOKEN_STORE, Token ); } catch ( error ) { /* asked again next time */ } return; }
		function forget_token() { try { $window.sessionStorage.removeItem( TOKEN_STORE ); } catch ( error ) { /* nothing kept */ } return; }

		terminal.UseToken = function ( Token )
		{
			let token = String( Token || state.Token || '' ).trim();
			if ( token === '' ) { return $q.resolve( null ); }
			state.Message = null;
			state.Connection = 'connecting';
			return JsonxClient.Ticket( token ).then( function ( Issued )
			{
				return connected( JsonxClient.Connect( Issued.Ticket ) ).then( function ( Result ) { keep_token( token ); state.Token = ''; return Result; } );
			} ).catch( function ( error )
			{
				forget_token();
				state.Connection = 'closed';
				state.TokenNeeded = true;
				state.Message = error.message;
				return null;
			} );
		};


		//---------------------------------------------------------------------
		// One line typed.

		terminal.Send = function ()
		{
			let text = String( state.Text );
			if ( text.trim() === '' ) { return $q.resolve( null ); }
			state.Text = '';
			history.push( text );
			history_at = history.length;

			// The confirmation asked for by the --yes rule takes this line as its answer.
			if ( state.Confirm !== null ) { return answer_confirm( text ); }
			// A debug open on this connection takes its commands the same way.
			if ( state.Debug !== null ) { return step_debug( text ); }

			write( 'command', '> ' + text );
			return JsonxClient.Send( { Line: text } ).then( function ( Answer )
			{
				if ( !Answer.Ok ) { write( 'error', ( Answer.Log || [] ).join( ' ' ) ); return null; }
				let read = Answer.Result;

				if ( read.Outcome === 'usage' || read.Outcome === 'refused' )
				{
					( read.Findings || [] ).forEach( function ( Finding ) { write( 'error', finding_text( Finding ) ); } );
					return null;
				}
				if ( read.Outcome === 'help' ) { write( 'text', read.Text ); return null; }
				if ( read.Outcome === 'debug' ) { return start_debug( read.Document ); }
				if ( read.Outcome === 'confirm' )
				{
					state.Confirm = { Message: read.Message, Document: read.Document, Label: text.trim() };
					write( 'confirm', read.Message + ' (y/n)' );
					return null;
				}
				return run( read.Document );
			} );
		};


		function answer_confirm( Text )
		{
			let confirm = state.Confirm;
			let said = Text.trim().toLowerCase();
			write( 'command', '> ' + Text );
			if ( said !== 'y' && said !== 'yes' )
			{
				state.Confirm = null;
				write( 'text', 'Not sent.' );
				return $q.resolve( null );
			}
			state.Confirm = null;
			return run( Object.assign( {}, confirm.Document, { yes: true } ) );
		}


		//---------------------------------------------------------------------
		// Running one command, and writing what it answered.

		function run( Document )
		{
			state.Busy++;
			return JsonxClient.Invoke( Document ).then( function ( Answer )
			{
				state.Busy--;
				( Answer.Findings || [] ).forEach( function ( Finding ) { write( 'finding', finding_text( Finding ) ); } );
				( Answer.Log || [] ).forEach( function ( Line ) { write( Answer.Ok ? 'log' : 'error', Line ); } );
				if ( !Answer.Ok ) { write( 'error', 'exit ' + Answer.ExitCode ); }
				if ( typeof Answer.Result === 'string' ) { write( 'text', Answer.Result ); }
				else if ( typeof Answer.Result !== 'undefined' ) { write( 'result', JSON.stringify( Answer.Result, null, '\t' ) ); }
				return Answer;
			} );
		}


		//---------------------------------------------------------------------
		// A debug, as a conversation: every line until it ends is one of its commands.

		/*
			***A step is written once***, however it arrives. A snapshot reaches the page twice: as a debug
			event, and as the answer to the command which asked for it. So a command's own answer writes it,
			and the events write only what arrives while nothing was asked - the first stop, and the stops a
			`continue` runs through. Suppressing a repeat instead would swallow a step which really did
			repeat, which is what stepping twice looked like (2026-09-16).
		*/
		let stepping = false;

		function write_step( Snapshot )
		{
			if ( !Snapshot || !Snapshot.Step ) { return; }
			write( 'debug', ( Snapshot.Process ? Snapshot.Process + ': ' : '' ) + Snapshot.Step );
			return;
		}

		function start_debug( Document )
		{
			let options = Object.assign( {}, Document );
			delete options.Command;
			state.Debug = { Process: options.process };
			stepping = false;
			write( 'debug', 'Debugging ' + options.process + '. Type step, into, continue, decline, answer <json>, state, skip or quit.' );

			return JsonxClient.Send( { Debug: options }, function ( Message )
			{
				if ( Message.Event === 'debug' && !stepping ) { write_step( Message.Snapshot ); }
				return;
			} ).then( function ( Answer )
			{
				( Answer.Findings || [] ).forEach( function ( Finding ) { write( 'finding', finding_text( Finding ) ); } );
				( Answer.Log || [] ).forEach( function ( Line ) { write( Answer.Ok ? 'log' : 'error', Line ); } );
				write( Answer.Ok ? 'debug' : 'error', 'The debug ended' + ( Answer.Ok ? '.' : ', exit ' + Answer.ExitCode + '.' ) );
				state.Debug = null;
				return Answer;
			} );
		}

		function step_debug( Text )
		{
			write( 'command', '> ' + Text );
			stepping = true;
			return JsonxClient.Send( { Step: Text } ).then( function ( Answer )
			{
				stepping = false;
				if ( !Answer.Ok ) { write( 'error', ( Answer.Log || [] ).join( ' ' ) ); return Answer; }
				let snapshot = Answer.Result;
				if ( snapshot && snapshot.Error ) { write( 'error', typeof snapshot.Error === 'string' ? snapshot.Error : JSON.stringify( snapshot.Error ) ); }
				else { write_step( snapshot ); }
				return Answer;
			} );
		}


		//---------------------------------------------------------------------
		// Completion, from the process: one candidate is inserted, several are listed.

		terminal.Complete = function ()
		{
			let text = String( state.Text );
			if ( state.Debug !== null || state.Confirm !== null ) { return $q.resolve( null ); }
			return JsonxClient.Send( { Complete: text } ).then( function ( Answer )
			{
				if ( !Answer.Ok ) { return null; }
				let completion = Answer.Result;
				let candidates = completion.Candidates || [];
				if ( candidates.length === 0 ) { return null; }
				if ( candidates.length === 1 )
				{
					let item = ( completion.Items || [] )[ 0 ];
					// The process says how a candidate is inserted, so the page never has to quote.
					state.Text = item ? ( text.slice( 0, text.length - ( item.Replace || 0 ) ) + item.Insert ) : ( text + candidates[ 0 ].slice( ( completion.Prefix || '' ).length ) );
					return completion;
				}
				write( 'text', candidates.join( '   ' ) );
				return completion;
			} );
		};


		//---------------------------------------------------------------------
		// The keys this page hears: Enter sends, Tab completes, Up and Down walk its history.

		terminal.OnKey = function ( Event )
		{
			if ( Event.key === 'Enter' ) { Event.preventDefault(); terminal.Send(); return; }
			if ( Event.key === 'Tab' ) { Event.preventDefault(); terminal.Complete(); return; }
			if ( Event.key === 'ArrowUp' )
			{
				if ( history.length === 0 ) { return; }
				Event.preventDefault();
				history_at = Math.max( 0, history_at - 1 );
				state.Text = history[ history_at ];
				return;
			}
			if ( Event.key === 'ArrowDown' )
			{
				if ( history.length === 0 ) { return; }
				Event.preventDefault();
				history_at = Math.min( history.length, history_at + 1 );
				state.Text = ( history_at === history.length ) ? '' : history[ history_at ];
				return;
			}
			return;
		};

		terminal.Start();
		return;
	}
] );
