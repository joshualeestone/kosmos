# #2414 — find-agents LOCATION coverage (scan arbitrary-named folders)

## The gap
Josh seeded 10 agents (Documents, Downloads, an arbitrary-named "Work" folder, possibly the
user home root); only 2 of 10 surfaced at the find-agents/import screen. Renet's 10-agent shape
accounting proved the SHAPE gate is not the dominant cause (9 of 10 pass shape). The misses are
dominated by LOCATION.

`engine/discover.js` `scan()` today reaches:
- a FIXED name list (`SCAN_DEEP_NAMES` = work/projects/Projects/Developer/dev/src/code/repos/
  Kosmos/kosmos) walked DEEP (5);
- a shallow `$HOME` walk at `HOME_DEPTH=2` (root + children + grandchildren);
- TCC dirs (Documents/Downloads/Desktop) only under an explicit importScan grant path (#2125).

So an agent under an arbitrary-named folder (any name not in the fixed list) nested deeper than
a grandchild is invisible: only the shallow HOME_DEPTH=2 walk reaches non-curated folders, and
it stops at depth 2.

## The call (implemented)
Add `discoverHomeParents(home)`: read the top level of `$HOME` and promote every REAL directory
that is not a dotdir, not in `SCAN_SKIP` (matched case-insensitively — see below), and not
already a curated name to a DEEP root (`DEEP_DEPTH=5`). Runs on BOTH the auto and import scans
(these are non-TCC folders that need no grant, so they belong on the auto find-agents screen too).

This directly implements Josh's "it could have been called anything": no fixed name list to
fall through — every top-level folder is walked to full depth.

**`$HOME` is read FIRST, at depth 0, and the old shallow `$HOME` walk is removed.** The prior
code walked `$HOME` shallow (depth 2) LAST; that is gone. `defaultScanRoots` now pushes
`{dir: home, maxDepth: 0}` first (reads `~/CLAUDE.md` + loose `~/*.md` on one directory visit,
so the home root — a Josh-seeded location — is never starved by a heavyweight discovered sibling
like `~/go/pkg/mod`), then the curated names, then the discovered parents. Discovery reaches
`$HOME`'s children FURTHER than the old shallow walk did, so removing it loses no coverage.

**Case-insensitive `SCAN_SKIP` (`isScanSkip`).** On the case-insensitive macOS fs a lowercase
`~/downloads` is the same physical dir as the TCC-protected `Downloads`; a case-sensitive check
would miss it and promote it to a deep root, reintroducing the #2125 macOS-access-prompt ambush.
Applied at both discovery and the descent skip. Tradeoff (accepted, documented in code): it also
case-folds the build/system names, so a folder whose name case-collides with a skip word is
skipped — negligible probability, and a single case-insensitive set is more robust than a two-set
split that could let case-sensitivity creep back into the TCC subset.

## Why this preserves #2125 (the no-ambush regression)
`SCAN_SKIP` already contains Documents, Downloads, Desktop, Library, Applications, Music, Movies,
Pictures, Public, Photos Library. Discovery filters candidate names through `SCAN_SKIP` and skips
every dotdir, so it NEVER promotes a TCC-protected folder to a deep root. The auto scan therefore
fires no macOS access prompt. The TCC folders still reach a scan only through the explicit
`importScan` tcc-root path (the app-identity hatch), entirely unchanged.

## Rejected alternatives
- **Just raise HOME_DEPTH from 2 to 5.** Rejected: it deepens the shallow catch-all indiscriminately
  without giving each folder a proper root, and it would still walk `$HOME` last (starvation). Discovering
  parents is more precise — each promoted folder gets the same DEEP treatment as a curated one, and reading
  `$HOME` itself at depth 0 up front keeps the root `~/CLAUDE.md` from being starved. (The shallow `$HOME`
  walk was removed entirely, superseded by discovery + the depth-0 home read; there is no `HOME_DEPTH` any
  more.)
- **Follow arbitrary top-level symlinks (stat, like curated roots do).** Rejected: a curated root NAME
  is trusted (a symlinked `~/work` → external volume is followed on purpose). An arbitrary DISCOVERED
  name is untrusted; following `~/x → /` would make the whole filesystem a deep root and reintroduce
  the no-symlink-escape class this module family has shipped six times. Discovery uses `lstat` and adds
  real directories only.

## Weakest premise (name it, per the anti-stopping rule)
A person who keeps an arbitrary-named workspace as a SYMLINK to an external volume (e.g.
`~/ClientWork → /Volumes/…`) is NOT covered, because discovery refuses to follow arbitrary top-level
symlinks. Mitigation today: naming it one of the curated names (`work`, `projects`, …) is followed;
a future explicit "add a folder" action can cover the arbitrary-symlink case deliberately. I chose the
no-escape side of the tradeoff on purpose — an escape is a security defect, a missed symlinked-volume
folder is a one-time inconvenience with a workaround. Would change my mind if measurement showed
arbitrary-named external-volume workspaces are common; they are an edge case.

## Tests
`engine/discover.location-2414.test.js` (8 arms, sandboxed via a CONSISTENT fixture home so
`defaultScanRoots` runs on a bare scan):
- arbitrary-named folder nested DEEP (depth 3, name not case-colliding with a curated one) is found;
- the user home root's own CLAUDE.md is found;
- #2125 control: a bare scan does NOT reach ~/Documents / ~/Downloads / ~/Desktop;
- a top-level dotdir and a top-level node_modules are not promoted;
- an arbitrary top-level SYMLINK is not followed (no escape);
- a positive CONTROL that the fixture home is really scanned (absences are the guard, not a dead scan).
Perturbation-verified: neutering discovery reds exactly the arbitrary-deep arm. Full discover suite
+ full node gate (5083) green.

## Sequencing / merge order
Third of three find-agents fixes, after #2408 (merged, PR #2412) and #2410 (Renet, Gemini parsing —
CONVERGED, PRs first). Agreed with Renet: #2410 merges first, I rebase #2414 onto main after and
re-verify. Hunks ~400 lines apart in discover.js (mine ~785-845 defaultScanRoots; hers ~1250 inside
scan()) — clean rebase expected. Both 0.6.46-blocking (Splinter).
