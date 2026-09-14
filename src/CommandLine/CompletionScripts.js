'use strict';

/*
	The shell completion scripts: bash, zsh and PowerShell (plan F4.1).

	***Each script is a thin callback***: it hands the words typed to `jsonx __complete` and offers
	what comes back, one candidate per line, so completion always answers from the command tree and
	the file as they are now (Complete.js).

	***The word being typed goes last, after a `:`*** (Complete.CURRENT_MARK), because Windows
	PowerShell 5.1 drops an empty argument to a native program. The scripts do the same in every
	shell, so `__complete` reads one convention.
*/

const Complete = require( './Complete.js' );


const SHELLS = [ 'bash', 'zsh', 'powershell' ];


//---------------------------------------------------------------------
function bash( Program )
{
	return [
		'# ' + Program + ' completion for bash. Load it with:',
		'#     source <(' + Program + ' completion bash)',
		'_' + Program + '_complete()',
		'{',
		'	local IFS=$\'\\n\'',
		'	local words=( "${COMP_WORDS[@]:1:COMP_CWORD-1}" )',
		'	COMPREPLY=( $( ' + Program + ' __complete -- "${words[@]}" "' + Complete.CURRENT_MARK + '${COMP_WORDS[COMP_CWORD]}" 2>/dev/null ) )',
		'}',
		'complete -o default -F _' + Program + '_complete ' + Program,
		'',
	].join( '\n' );
}


//---------------------------------------------------------------------
function zsh( Program )
{
	return [
		'#compdef ' + Program,
		'# ' + Program + ' completion for zsh. Load it with:',
		'#     source <(' + Program + ' completion zsh)',
		'_' + Program + '()',
		'{',
		'	local -a candidates',
		'	candidates=( "${(@f)$( ' + Program + ' __complete -- "${(@)words[2,CURRENT-1]}" "' + Complete.CURRENT_MARK + '${words[CURRENT]}" 2>/dev/null )}" )',
		'	compadd -Q -- "${candidates[@]}"',
		'}',
		'compdef _' + Program + ' ' + Program,
		'',
	].join( '\n' );
}


//---------------------------------------------------------------------
function powershell( Program )
{
	return [
		'# ' + Program + ' completion for PowerShell. Load it with:',
		'#     ' + Program + ' completion powershell | Out-String | Invoke-Expression',
		'Register-ArgumentCompleter -Native -CommandName ' + Program + ' -ScriptBlock {',
		'	param( $WordToComplete, $CommandAst, $CursorPosition )',
		'	$typed = @()',
		'	foreach ( $element in ( $CommandAst.CommandElements | Select-Object -Skip 1 ) )',
		'	{',
		'		if ( $element.Extent.EndOffset -gt $CursorPosition ) { break }',
		'		if ( $element -is [System.Management.Automation.Language.StringConstantExpressionAst] ) { $typed += $element.Value } else { $typed += $element.Extent.Text }',
		'	}',
		'	if ( $WordToComplete -ne \'\' -and $typed.Count -gt 0 ) { $typed = @( $typed | Select-Object -First ( $typed.Count - 1 ) ) }',
		'	$arguments = @( \'__complete\', \'--\' ) + $typed + @( \'' + Complete.CURRENT_MARK + '\' + $WordToComplete )',
		'	& ' + Program + ' @arguments 2>$null | ForEach-Object {',
		'		$text = $_',
		'		if ( $text -match \'[\\s\'\'"]\' ) { $text = "\'" + ( $_ -replace "\'", "\'\'" ) + "\'" }',
		'		[System.Management.Automation.CompletionResult]::new( $text, $_, \'ParameterValue\', $_ )',
		'	}',
		'}',
		'',
	].join( '\n' );
}


//---------------------------------------------------------------------
function Script( Shell, Program )
{
	let program = ( typeof Program === 'string' && Program !== '' ) ? Program : 'jsonx';
	if ( Shell === 'bash' ) { return bash( program ); }
	if ( Shell === 'zsh' ) { return zsh( program ); }
	if ( Shell === 'powershell' ) { return powershell( program ); }
	throw new Error( 'There is no completion script for [' + Shell + ']; the shells are ' + SHELLS.join( ', ' ) + '.' );
}


//---------------------------------------------------------------------
module.exports = {
	SHELLS: SHELLS,
	Script: Script,
};
