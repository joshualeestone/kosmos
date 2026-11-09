# winnode-8285: the Windows release script finds the Kosmos runtime's own node (kosmos#8285)

**Posture:** production

From the 11-09 feedback report of the Windows build box: `publish-r2.ps1 -Promote` refused ("node (an executable, not
a .cmd shim) is required ...") because node was not on PATH, while the Kosmos install on the same PC carries its own
node.exe. The workaround was prepending the runtime folder to PATH by hand.

## Change (tools/windows/publish-r2.ps1)
- `Get-NodeExe`: PATH's real node first (a node put there on purpose always wins; a .cmd/.bat shim is still skipped).
  Only when there is none: `%LOCALAPPDATA%\Programs\Kosmos\runtime\node.exe`, the installed app's, put there by its
  installer. Said on stderr once per run, so the run's log shows what checked the build. Returns an object with
  `.Source`, as Get-Command's result, so both callers are unchanged. The help header says all of this.
- The list is one script variable (`$KosmosRuntimeNodes`); both refusals now say where node was looked for
  (`$NoNodeWhere`).
- Off Windows (pwsh on a Mac, the bash test) `%LOCALAPPDATA%` is unset, so the fallback finds nothing: unchanged.

Decided: the installed app's node only. Rejected (challenge-loop iteration 2): the board runtime's copy under
`%LOCALAPPDATA%\Kosmos\runtime`, which the running Kosmos writes and its agents can too. Rejected: other folders
(Program Files, nvm), a guess the person did not make; PATH is how they choose one. Weakest part, named in the help:
the app's node came through the Kosmos release channel this script checks, so the check is then not independent;
a node on PATH gives an independent one, and it always wins.

## Tests
New `tools.win-publish-node-runtime-8285.test.js` (Windows, under each PowerShell present; the CI job has both):
Get-NodeExe, its list, its once-flag and the refusal words parsed out of the real script under Stop + StrictMode 2.0,
against throwaway PATH and LOCALAPPDATA: the app's node (said on stderr, once per run), the board copy never used,
a real node on PATH wins (nothing said), a .cmd shim still skipped, no LOCALAPPDATA -> none, neither -> none; the
refusal words evaluated both ways; and both refusals carry them, assigned before the first check runs.

## Measured by hand (Windows 11 box, 11-09)
With no node on PATH (this morning's failure), `publish-r2.ps1 -Promote -ApprovedVersion 0.8.00 ... -DryRun` from
this branch: "no node executable on PATH (a .cmd shim does not count); using the installed Kosmos app's own:
...\Programs\Kosmos\runtime\node.exe" (once), the signed-manifest check and the verification record both PASS,
"DRY RUN complete: nothing was written", exit 0.
