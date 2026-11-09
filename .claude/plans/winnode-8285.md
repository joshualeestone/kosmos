# winnode-8285: the Windows release script finds the Kosmos runtime's own node (kosmos#8285)

**Posture:** production

From the 11-09 feedback report of the Windows build box: `publish-r2.ps1 -Promote` refused ("node (an executable, not
a .cmd shim) is required ...") because node was not on PATH, while the Kosmos install on the same PC carries its own
node.exe. The workaround was prepending the runtime folder to PATH by hand.

## Change (tools/windows/publish-r2.ps1)
- `Get-NodeExe`: PATH's real node first (a node put there on purpose always wins; a .cmd/.bat shim is still skipped).
  Only when there is none: `%LOCALAPPDATA%\Programs\Kosmos\runtime\node.exe` (the installed app's), then
  `%LOCALAPPDATA%\Kosmos\runtime\node.exe` (the board runtime's copy). Which one is used is said on stderr, so the
  run's log shows what checked the build. Returns an object with `.Source`, as Get-Command's result, so both callers
  are unchanged.
- The list is one script variable (`$KosmosRuntimeNodes`); both refusals now say where node was looked for
  (`$NoNodeWhere`).
- Off Windows (pwsh on a Mac, the bash test) `%LOCALAPPDATA%` is unset, so the fallback finds nothing: unchanged.

Decided: trust the runtime node as much as PATH's. Both are under the same user's control; the runtime one is the
very binary the installed Kosmos runs. Rejected: searching other folders (Program Files, nvm) - a guess the person
did not make; PATH is how they choose one.

## Tests
New `tools.win-publish-node-runtime-8285.test.js` (Windows, under each PowerShell present; the CI job has both):
Get-NodeExe and its list parsed out of the real script under Stop + StrictMode 2.0, against throwaway PATH and
LOCALAPPDATA: app runtime (said on stderr), board copy only, both (app first), real node on PATH wins (nothing said),
a .cmd shim still skipped, neither -> none; and both refusals name where it looked.

## Measured by hand (Windows 11 box, 11-09)
With no node on PATH (this morning's failure), `publish-r2.ps1 -Promote -ApprovedVersion 0.8.00 ... -DryRun` from
this branch: "node is not on PATH; using the Kosmos runtime's own: ...\Programs\Kosmos\runtime\node.exe", the
signed-manifest check and the verification record both PASS, "DRY RUN complete: nothing was written", exit 0.
