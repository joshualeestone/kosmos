# winnode-8285: the Windows release script finds the Kosmos runtime's own node (kosmos#8285)

**Posture:** production

From the 11-09 feedback report of the Windows build box: `publish-r2.ps1 -Promote` refused ("node (an executable, not
a .cmd shim) is required ...") because node was not on PATH, while the Kosmos install on the same PC carries its own
node.exe. The workaround was prepending the runtime folder to PATH by hand.

## Change (tools/windows/publish-r2.ps1)
- `Get-NodeExe`: PATH's real node first (a node put there on purpose always wins, unchecked: the person's choice; a
  .cmd/.bat shim is still skipped). Only when there is none: `%LOCALAPPDATA%\Programs\Kosmos\runtime\node.exe`, the
  installed app's, and ONLY while Windows reports its Authenticode signature Valid with signer name exactly
  `OpenJS Foundation` (node's publisher; `$NodePublisher`). Otherwise skipped, and the caller refuses.
- Said on stderr once per run: which node checks the build, or why the app's was not used. Returns an object with
  `.Source`, as Get-Command's result, so both callers are unchanged. The help header says all of this.
- `$KosmosRuntimeNodes` and `$NodePublisher` are script variables; both refusals say where node was looked for
  (`$NoNodeWhere`, honest when there is no `%LOCALAPPDATA%`).
- Off Windows (pwsh on a Mac, the bash test) `%LOCALAPPDATA%` is unset or points nowhere, so the fallback finds
  nothing: unchanged.

Decided: the app's node, gated on its publisher signature. The folder says nothing about the file (challenge-loop
iteration 3): the user has full control of `%LOCALAPPDATA%\Programs\Kosmos` and the updater rewrites it. The signature
catches a damaged, half-updated or replaced node.exe. It is NOT a boundary against code that can write that folder
(iteration 4): a DLL planted beside node.exe still loads into a Valid node, the file can change between check and
run, and such code could put a node on PATH, which was always run unchecked. The release PC is trusted as a whole, as
before; the help, the comment and this plan say so rather than claim more. The signature read is not under
-NodeTimeoutSec (about 0.5 s online here; offline not measured), and only runs when PATH has no node. The issuer is
not pinned (a root the user added would make a look-alike Valid): the same "PC trusted as a whole" covers it. Off
Windows (pwsh) there is no Authenticode cmdlet, so nothing is checked and nothing is used. Rejected (iteration 2): the board runtime's
copy under `%LOCALAPPDATA%\Kosmos\runtime`, also user-writable; with the signature gate it would be as safe, but one
place is enough. Rejected: other folders (Program Files, nvm), a guess the person did not make; PATH is how they choose
one. Weakest part: a node.exe signed by OpenJS but of an old, vulnerable version would still be used; it is the node
the installed Kosmos itself runs, so it is the node that release already trusts.

## Tests
New `tools.win-publish-node-runtime-8285.test.js` (Windows, under each PowerShell present; the CI job has both):
Get-NodeExe, its list, the publisher, the once-flag and the refusal words parsed out of the real script under Stop +
StrictMode 2.0, against throwaway PATH and LOCALAPPDATA. A signed node is the test's own node.exe (an official build),
hard-linked or copied; an empty file is an unsigned one. Covers: signed app node used (said), unsigned one NOT run
(said why), the board copy never looked at, a real PATH node wins unchecked, a .cmd shim still skipped and named in
the line (and none named when there is none), said once per
run, no LOCALAPPDATA -> none and silent, neither -> none, the refusal words both ways, and both refusals carry them
above their callers. A CI-only check asserts the Windows job's node is signed, so the signed arms cannot skip there.

## Measured by hand (Windows 11 box, 11-09)
With no node on PATH (this morning's failure), `publish-r2.ps1 -Promote -ApprovedVersion 0.8.00 ... -DryRun` from
this branch: "no node on PATH; using the installed Kosmos app's own (signed by OpenJS Foundation):
...\Programs\Kosmos\runtime\node.exe" (once), the signed-manifest check and the verification
record both PASS, "DRY RUN complete: nothing was written", exit 0. The installed node.exe reads Status Valid, signer
CN=OpenJS Foundation.
