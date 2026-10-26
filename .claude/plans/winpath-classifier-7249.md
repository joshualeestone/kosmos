# #7249: one Windows-path classifier, every spelling a single kind

**Branch:** `winpath-classifier-7249` · **Card:** kosmos#7249 (follow-up from #7221 / PR #7243)

## The defect

`engine/winpath.js` grew one predicate or regex per #7221 review finding
(`isNetworkSpelling`, `isLocalVolumeSpelling`, `isNoFileNamespace`, `DRIVE_ALIAS`,
`SHARE_NAMESPACE`, `NT_LOCAL`, `LOCAL_LONG`). Six fail-opens in the "skipped other-agent
folder" class were each closed by adding one more predicate. The hazard is structural: the
"what kind of path is this" decision is spread across N independent regex predicates that a
caller composes by hand (`isNetworkSpelling(p) && !shareOf(p) && isNoFileNamespace(p)`), so a
new spelling can fall through a gap between two of them.

## The shape the card asks for

One classifier that returns exactly one **kind** per spelling, the existing predicates become
views of it, and a table at the top of the module documents every spelling.

Kinds (one per spelling):

- `local-drive` (a drive letter, incl. its `\\?\C:\`, `\\.\C:\`, `\??\C:\` and DosDevices-alias
  spellings) - carries the drive letter
- `local-volume` (`\\?\Volume{GUID}\`, `HarddiskVolumeN`, Shadow Copy; the NT `\??\` forms too)
- `share` (plain `\\host\share`, and the `\\?\UNC\`, Mup, `GLOBAL??\UNC\`, NT `\??\UNC\`
  spellings) - carries `server\share`
- `no-file-namespace` (pipe, mailslot, DOS-device namespace: `\\.\pipe\`, `\\.\COM1`)
- `unplaceable` (a `\\`/`//`/NT namespace that names no drive, volume or share; treated as
  network and failing closed: `\\.\Weird\x`, `\??\...\LanmanRedirector\...`)
- `local-other` (a rooted or relative path naming no drive at all, e.g. `\Users\a\x`; local,
  judged against the agent's roots, never called network)

## The one subtlety: a DosDevices drive alias is BOTH network-spelled and a drive

`isNetworkSpelling('\??\Global\C:\x')` is **true** today (the NT prefix is a namespace), yet
`driveOf('\??\Global\C:\x')` is **'C'** (its DosDevices alias resolves to drive C, review 22).
The two predicates genuinely **overlap** on `DRIVE_ALIAS` spellings - they are not mutually
exclusive. A naive single-kind classifier that calls such a path `local-drive` and then makes
`isNetworkSpelling` a plain view of `kind` would flip `isNetworkSpelling` from true to false
for these spellings, which changes the control flow of `otherFolderSkip` (the network-gate is
how it decides to leave another agent's folder unresolved) - exactly the skipped-folder class
this card is about, and verifiable only on Windows CI.

**Resolution:** `classify(p)` returns the placeable `kind` **and** a `networkSpelled` boolean
computed from the exact original `isNetworkSpelling` expression. So:

- `kind` is the clean partition (a DosDevices alias is `local-drive`, which is what review 22
  says it is).
- `networkSpelled` preserves the shape quirk, so `isNetworkSpelling` stays **byte-identical**
  to today (`isNetworkSpelling(p) === classify(p).networkSpelled`).
- `otherFolderSkip` keeps its gate on `networkSpelled` (identical skip decision) and uses
  `kind` only for the inner `no-file-namespace` / `share` distinction - so DosDevices-alias
  folders behave exactly as before.

Every other predicate IS a faithful view (verified mutually exclusive over the corpus):
`isLocalVolumeSpelling` = `kind==='local-volume'`; `isNoFileNamespace` = `kind==='no-file-namespace'`;
`isPlainShare` = `kind==='share'` && plain spelling; `driveOf` = `classify.drive`;
`shareOf` = `classify.share`. The pure spelling-shape helpers `isNamespaceSpelling` and
`isLongDrivePath` stay as shape tests (orthogonal to kind; documented in the table).

## Callers repointed in engine/replyfile.js

Every caller that asks "what kind is this path" reads `classify().kind` (or the flags on it):
`otherFolderSkip`, `skippedMayHold`, and the kind branches of `winSpellingRefusal` and
`winRealRefusal`. The path-transform helpers (`asDrivePath`, `asShareSpelling`, `writtenInside`,
`sameWrittenPath`, `mayHold`, `followableLinkTarget`, `isDevicePart`) are not kind decisions and
are unchanged.

## How it is proven

1. **Pure arms, local (Mac):** `engine/winpath.test.js` (3) and the 13 pure arms of
   `engine/replyfile.win32-7221.test.js` run on every platform and must stay green **unchanged**
   (45 win-gated arms skip on Mac). Baseline captured green before any edit.
2. **Parity harness, local:** a throwaway node script asserts every exported predicate's NEW
   output equals the ORIGINAL (origin/main copy) for every path spelling the two suites use.
   This proves behavior preservation for the win-gated spellings too, which the Mac cannot run.
3. **Windows CI, authoritative:** the PR must show a green `windows-latest` run of the 7221
   suite (the 45 skipped arms, including the review-22/23 DosDevices-alias link arms). This is
   the only place the control-flow consequences on real Windows `realpath`/`lstat` are
   exercised, and it is a required gate before merge.

## Coordination

`#7250` (Scorpion, branch `filesshare-7250`) also edits `engine/replyfile.js`, including the
body of `ownShareProject`, which I also touch (its `driveOf`/`sameWrittenPath` checks). Scorpion
claimed one second first, so I land second: I rebase onto his merged `#7250`, re-run the parity
harness and the pure 7221 arms, and `git merge-tree` check before pushing.

## What I got wrong / weakest link (named)

The weakest part of my reasoning is the claim that making `kind` call a DosDevices alias
`local-drive` is invisible to every caller. I preserve `isNetworkSpelling` exactly via
`networkSpelled`, and no pure or win-gated arm asserts `isNetworkSpelling` on a bare
`DRIVE_ALIAS` folder (the alias appears in the suite only as a link target, handled by the
unchanged `followableLinkTarget`/`asDrivePath`). But a production project folder registered
literally as a bare `\??\Global\C:\...` path is a spelling the Mac cannot exercise through
Windows `realpath`. **What would change my mind:** a Windows CI red on any review-22/23 arm, or
a reviewer pointing to a caller that passes a bare DosDevices-alias folder into the skip logic.
**Mitigation:** Windows CI is a required merge gate and I flag this exact risk in the PR body.
