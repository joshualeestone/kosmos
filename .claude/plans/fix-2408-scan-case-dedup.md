# fix-2408-scan-case-dedup

Card: joshualeestone/kosmos#2408. Surfaced during Josh's 0.6.45 find-agents "2 of 7 seed
agents" investigation; routed by Splinter. Scan lane (mine); the row UI is Angel's.

## Problem (proven)
`engine/discover.js` `scan()` (#1938) walks `SCAN_DEEP_NAMES`, which ships two case-variant
pairs: `projects`/`Projects` and `Kosmos`/`kosmos`. On macOS's default case-INSENSITIVE
volume, `~/projects` and `~/Projects` are the SAME physical dir, so `defaultScanRoots` pushes
it as two roots and the walk visits it twice, offering every agent under it TWICE.

Root mechanism: the `seenDirs` visit de-dup was keyed on `fs.realpathSync(dir)`, and a comment
claimed "realpathSync collapses" the case variants. That claim is FALSE: `fs.realpathSync` on
macOS resolves symlinks but PRESERVES the input path's case, so the two case spellings produce
two different strings and were never collapsed. Measured repro: one physical agent -> two
candidate rows (candidates:2, visited:4).

## Fix
Key `seenDirs` (the DIRECTORY visit de-dup) on the PHYSICAL-DIRECTORY identity
`st.dev + ':' + st.ino` via `fs.statSync`, not on a path string. `(dev,ino)` is the canonical
physical identity: it collapses case-variants AND symlink aliases on a case-insensitive fs, and
correctly keeps `~/projects` and `~/Projects` DISTINCT on a case-sensitive fs (where they really
are two directories). `statSync` follows a symlink to the target inode (the same collapse
realpath gave for links); a dir hardlink is OS-forbidden, so dev+ino is unique per directory.
A vanished dir (TOCTOU) throws and is skipped. Also corrected the false realpathSync comment.

### The loose-file de-dup (`seenFiles`/`byFile`) is deliberately LEFT on realpath
The first commit also switched the loose-file key to (dev,ino) "to fix the class", but the
challenge-loop reverted it, on evidence: `seenDirs` (dev+ino) sits at the TOP of the walk loop
and skips the re-walk of a case-variant root ENTIRELY, so a loose file under it is never
re-collected -- the loose path already shares the dir-level guard, and reverting the loose key
to realpath reds no test (proven). Realpath is not merely harmless there, it is load-bearing:
it collapses a SYMLINKED loose `.md` reached via two paths. The only scenario the (dev,ino) key
would independently affect is a HARDLINKED `.md` across two distinct real dirs, which is not a
shape agent files occur in. So the final fix is `seenDirs` only; `seenFiles` is unchanged from
#1652.

## Scope (do NOT conflate)
This fixes the OVERcount (an agent offered twice). Josh's 0.6.45 report was an UNDERcount
(2 of 7). This bug contributes to an undercount only indirectly, by double-spending the
MAX_DIRS(6000)/MAX_CANDIDATES(100) budget on a large tree. The primary 2/7 root cause stays open
pending Josh's seed .md files: either this-via-budget, or 5 seeds in folders no provider records
+ outside the scanned roots, or their .md shape failing folderRow's identity/INTRODUCES gate.
Fixing this is also DIAGNOSTIC: it removes the case-variant-via-budget variable, so if 2/7
persists after this + the seeds, the cause is narrowed to (a)/(b).

## Tests (engine/discover.scan-1938.test.js, perturbation-proven)
Added a #2408 test: two case-variant roots at one physical dir de-dupe to ONE candidate. It
DETECTS case-insensitivity (compares inodes of the lower/upper root) and skips on a case-
sensitive fs, where the two paths are genuinely distinct dirs and the bug cannot occur -- which
is also why a symlink-alias test would not distinguish this fix (realpathSync already collapsed
symlink aliases; only the CASE behavior changed). Perturbation: reverting the dir-key to
realpathSync reds exactly this test on a case-insensitive fs (measured 19/19 -> 18/1 -> 19/19).
No web/ surface, so no #1720 browser-check concern. discover/import suites all green.
