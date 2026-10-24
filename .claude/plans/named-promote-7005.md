# named-promote-7005 (kosmos#7005)

## Problem
The Mac promote (`tools/promote-channel.sh`) copies whatever `dist/latest-staging.json` names now onto
`latest.json`, and `setup-staging` onto `/setup`. While a prod GO for one build is pending, no staging cut
can run: it would replace the approved build. Measured 10-23: 0.7.64 approved-pending, ~20 merges behind,
Josh away until about Monday.

## Change (final state; the iteration sections below record how it got here)
`tools/promote-channel.sh <site> [port] --version <V> [--sha <prefix>] [--commit <sha>] [--allow-older] [--force]`
(Mac only). Without `--version` the promote behaves as before, with ONE deliberate default-path output change:
the post-force advice printed the port twice (`${PORT:+..}${PORT:-..}` is not an if/else), now once.

With `--version`:
- **Selection.** Commits on the site's HEAD whose `latest-staging.json` names V (narrowed by `--sha` and
  `--commit`) must agree on sha256, artifact and manifest, else it refuses with advice that fits the shape.
  The one used is the newest whose committed `setup-staging` hashes to its pointer's `setup_sha256` (the
  cut's own commit), else the newest. A later kept commit whose pointer differs in more than its installer
  refuses until `--commit` names the right one; one that matches is reported in a NOTE.
- **Publication and baseline.** With an origin: the commit must be on origin/main, and the checkout's
  `latest.json` must be origin's (one prod baseline for the rollback guard, signature checks and tunnel
  control). The fetch is bounded (`pointer_freeze_fetch`).
- **Checks.** Every existing check runs on the commit's pointer and installer and on the dist/ files they
  name; the installer pair comes from the commit; the moved-staging check does not apply, and instead the
  artifact is re-verified right before the first write.
- **Guards.** `--force` needs `--sha`. V older than prod's, or not comparable (including a prod pointer with no
  version), needs `--allow-older`.
- **Messages.** Named-mode messages name the commit, the HOLD and post-force advice point at a board on V,
  and hand-fix advice reads the commit only when that commit carries V's installer.

## Tests
`tools/test-promote-named-7005.sh` (wired into test:shell after the #5032 test): a fixture site with committed
cuts 9.9.8 then 9.9.9 and many variants; every refusal asserts prod and /setup untouched and has a control.
Each fix in every iteration was shown red-capable by a mutant (the iteration sections name them). Neighbours
green: 5032, 2036 channel/wire, 6149 floor, pointer-freeze, deploy-site-promote, promote-channel-win.

## Rejected
- A pinned per-version pointer file written by the cut: needs a cut change and only helps future builds;
  git already holds every cut's pointer and installer.
- Taking the commit from origin/main instead of HEAD: the commit is read from HEAD, and must ALSO be on
  origin/main (iteration 2), which together with the baseline check covers a checkout ahead of origin.
- Comparing the manifest pair against V's commit: a legitimate re-sign after the cut would refuse; the docs
  say the manifest pair is the dist/ copy, as for any promote.

## Not done (stated on the card)
The experience and agent-spawn gates still need a board running V. After a later staging cut moves the
cut box's board, the experience gate says cannot-tell and the promote HOLDS (forceable after a hand check,
with --sha). Under that cannot-tell, the agent-spawn gate's FAIL or PARTIAL is about the board's other build,
so in named mode it is cannot-tell too, but only when the gate READ the board as another version (iteration
14); a version it could not read may be V, so a FAIL there still refuses. The tunnel gate runs V's tarball.

## Merge hold
Do not merge before the 0.7.64 prod promote lands (Splinter 17:59): Baron's prepped promote scripts call
promote-channel.sh. Not enforced by anything; stated in the PR body.

## Weakest premise
That the cut box's dist/ still holds V's tarball when the promote runs. True for every past cut, but nothing
protects it from a manual retention prune once staging moves on; the promote then refuses (artifact missing).

## Iteration 1 (challenge) changes
- My first version took the newest commit naming V and claimed a hand republish "carries the same pointer
  fields". That was wrong: publish-staging-pointer.sh keeps setup_sha256 only for the same build, so a staging
  rollback to V after a later cut commits V's pointer with NO installer, beside the later cut's setup-staging.
  Fixed: agreement across commits naming V, and the paired (cut) commit preferred.
- Added the rollback guard (--allow-older): with the gates holding on a moved board, --force is this mode's
  usual path, and a mistyped version must not downgrade prod.

## Iteration 2 (challenge) changes
- The two named-mode messages used `${X:+A}${X:-B}` as an if/else; `:-` yields X itself when set, so both
  ended in a stray version. Now precomputed hints; tests assert the whole sentence, and the default
  sentence is asserted unchanged.
- Agreement is on the whole build (sha256, artifact, manifest), not the sha alone.
- With an origin remote, the chosen commit must be on origin/main (a commit never pushed was never served).
- The version compare fails closed on a non-numeric version.
- Not changed: `-G` does not look into merge commits. Measured 10-23: 0 merges among the site's 133
  latest-staging.json commits on origin/main; the real lookup for 0.7.64 returns 65d9aa8 (its cut) in 18 ms.

## Iteration 3 (challenge) changes
- A version cut more than once (a re-cut after an abort) left commits disagreeing on V's build with no way
  forward: `--sha <8+ hex of the approved build's sha256>` now names it (Josh's GO names version and sha),
  and the refusal lists each build's sha, commit and date.
- A version that cannot be compared with prod's no longer reads "older than"; it says it cannot be compared
  (still refused without --allow-older).
- docs/staging-channel.md step 4 documents --version / --sha / --allow-older and the hold on a moved board.
- The -G comment states why it finds every commit: the pointer is one line.
- Not changed: in named mode origin main is fetched up to three times (the pointer-freeze guard, the publication check, and the #6609 key list when on); harmless, each bounded.

## Iteration 4 (challenge) changes
- After a forced cannot-tell, named mode sends the post-deploy experience check to a board on V (a Mac
  updated to it, or a fresh /setup install), not to the cut box's board, which has moved on.
- Named mode re-verifies the artifact against its sidecar and the pointer sha right before the first write
  (a re-cut of V during the gates replaced the bytes; before, latest.json was written first).
- `--force` with `--version` needs `--sha`: a forced named promote names the approved bytes.
- Pre-existing bug fixed in passing, in the DEFAULT path's post-force advice: `${PORT:+ (:$PORT)}${PORT:- ...}`
  printed the port twice ("(:16999)16999"). This is the one default-path output change on this branch.
- Docs say precisely what differs in named mode.

## Iteration 5 (challenge) changes
- The no-installer hand fix offers the named commit's setup-staging only when that commit itself changed it
  (V's own cut); beside a republish it says the installer may belong to another cut.
- Docs: the origin/main requirement applies when the site has an origin.
- Not changed (NITs): -G follows HEAD's path history and skips merges (measured 0 merges, above); the new test
  is wired without a separate bash -n line (promote-channel.sh already has one); the merge hold is process.

## Iteration 6 (challenge) changes
- The disagreement refusal's advice fits the shape: different bytes (use --sha), a --sha prefix two builds
  share (give more of it), or the same bytes under another artifact or manifest (fix the history by hand).
- Commit dates use %cd --date=short, not %cs (git 2.21+; Mortals has 2.54, but nothing pinned it).
- A site that is not a git checkout is refused as such, not as "pull the site".
- The header says exactly what differs in named mode (it said "every check runs unchanged").
- The test's leftover-folder check has a control that plants a folder and sees it.

## Iteration 7 (challenge) changes: the selection rule stops moving; the decision moves to the operator
Iterations 2 and 7 pulled the agreement rule in opposite directions (widen it to artifact and manifest; then:
a manifest-only difference is a dead end). Rather than flip it again, the rule stays strict and the operator
gets the decision: `--commit <site sha>` picks the commit (it must still name V and pass every check). When
the cut's own commit wins over a later commit naming V, a NOTE says so and whether that later pointer differs
in more than its installer (with the --commit to use it).
- The named-mode HOLD message names a board on V and --force with --sha.
- Docs: --commit, and a version that cannot be compared also needs --allow-older.
- Test: a failing fetch refuses (reached past the pointer-freeze guard, which fetches first, with
  KOSMOS_POINTER_FREEZE_OFFLINE=1).
- Not changed (NITs): `printf '%s\n' $_builds` word-splits on purpose (fields are hex and bare filenames);
  the "beside the OLDER /setup" sentence names prod's installer and stays.

## Iteration 8 (challenge) changes
- The rollback guard's baseline is origin/main's latest.json when the site has an origin (a checkout behind
  origin, or holding an undeployed promote, gave a wrong baseline); otherwise the checkout's, and it says which.
- A later commit naming the same build whose pointer differs in more than its installer now REFUSES until
  --commit names the right one (it was a NOTE). Compared only among the commits --sha/--commit leave: found
  while testing this, comparing against a commit --sha had excluded (another build) refused wrongly.
- Not changed (NIT): diff-tree reports nothing for a merge commit, which takes the cautious hand-fix branch
  (0 merges measured in the site's pointer history).

## Iteration 9 (challenge) changes
- A prod pointer that exists but names no version is cannot-compare (refused without --allow-older); only
  no pointer at all passes as a first promote (it failed open).
- One baseline: with an origin, named mode refuses unless the checkout's latest.json is origin's, so the
  rollback guard, the #6468 signature checks and the tunnel gate's control read the same prod.
- The named-mode fetch goes through pointer_freeze_fetch (bounded, one retry).
- Named-mode messages name the commit instead of "staging" (artifact missing, sha mismatch, manifest, floor).
- Test asserts the named HOLD sentence.
- Not changed (NIT): a 7-character --commit prefix matching two commits is resolved by the agreement logic,
  not refused as ambiguous (safe either way).

## Iteration 10 (challenge) changes
- Test: the numeric-compare control asserts its fixture really serves 9.9.9 first (it could pass on 1.0.0).
- Test: the first Kosmos+ sign-in gate is shown to read the named pointer (and staging's in default mode).
- Docs: nothing but dist-retention's keep window protects V's tarball once staging moves on; do not prune
  while a GO is pending.
- Messages: "$NAMED_VERSION's cut" (it printed the literal "V's cut"); reject_pathy and the installer-mismatch
  refusal name the commit's pointer in named mode; the header says the manifest pair is read from dist/.
- Not changed (NIT): only the newest kept commit is compared with the chosen one, not a middle republish;
  the pointer writer emits fixed fields, so that needs a hand-edited pointer.
- Merge hold (process, stated in the PR): not before the 0.7.64 prod promote lands.

## Iteration 11 (challenge) changes
- Docs step 4 split into parts, and it says the manifest pair is the checkout's dist/ copy (the commit pins
  the artifact's sha, not the manifest's), as for any promote.
- The plan's top sections rewritten to the final state (they described the first version).
- Not changed: comparing the manifest pair against V's commit (a re-sign after the cut is legitimate); a
  middle republish is not compared (needs a hand-edited pointer); an ambiguous 7-char --commit prefix is
  resolved by the agreement logic.

## Iteration 12 (challenge) changes
- The origin/main check runs inside the selection loop: a never-pushed commit naming V is not a candidate, so
  it cannot cause a "cut more than once" refusal; when only unpublished commits name V, the refusal lists them.
- The same version as prod's with other bytes (a re-cut replacing it) passes the rollback guard, as intended,
  and now prints a NOTE; documented.
- Wording: the announce line no longer says the commit carries the installer; the baseline source says when
  origin's main has no latest.json; the no-candidate refusal points at --sha/--commit when they filtered.

## Iteration 13 (challenge) changes
- The agent-spawn gate never checks the board's version: on a board not tied to V (experience gate
  cannot-tell), its FAIL/PARTIAL is about another build, so named mode treats it as cannot-tell (forceable after
  a hand check) instead of refusing V unforceably. Default mode keeps its refusal (control).
- The publication filter runs after --commit/--sha, so a --sha that matches nothing is blamed, not an
  unrelated unpublished commit.
- Header: which filters shape the agreement set. One more message names the commit's pointer. Docs: which
  gates hold on a moved board; a pruned tarball can be fetched back only while a deploy still serves it.

## Iteration 14 (challenge) changes: the agent-gate rule stops moving; the decision moves to evidence
Iterations 13 and 14 pulled one rule apart (13: an agent FAIL on a moved board refuses V for another build's
defect; 14: downgrading on any cannot-tell makes a real wedge on V forceable). Neither guess is right; the
experience gate already says which case it is. Named mode keeps its output and downgrades an agent-spawn
FAIL/PARTIAL only when it read the board as another version ("the board on :P runs W, not V"); a source-pin
test keeps that sentence and the parser in step. An unread version keeps the refusal.
- A named promote prints the sha256 of the manifest it checked (the commit pins only the artifact's sha).
- Not changed (NIT): the header's selection paragraph stays prose; the test:shell entry has no bash -n line.

## Iteration 15 (challenge) changes
- The same-build NOTE says when the later commit names another installer than the one copied to /setup.
- Named mode tees only the experience gate's stdout (where its #5084 line is printed), so its stderr stays on
  stderr as in default mode.
- The agent-spawn downgrade's PARTIAL arm is tested (and its unread-version control); docs name PARTIAL.
- A NOTE names never-pushed commits naming V that were ignored; IFS is explicit for the deliberate word split.
- The plan file is renamed to the folder's <branch>.md shape; one docs line rewrapped.
- Not changed (NIT): "this checkout (origin's main has none)" is reachable only on a first-ever prod pointer.

## Iteration 16 (challenge) changes
- Docs: a board that is down or refuses the token is refused outright by the experience gate (exit 1, not
  forceable), because the gate cannot read which build it runs; the same unread-version rule as iteration 14.
  The suggested reorder (read the version before the nonce) was checked against the gate and rejected: a
  #2023-broken board on another version already answers cannot-tell (the version check runs before the redeem),
  and a down board answers neither, so a reorder changes nothing there and would weaken default mode.
- Every HOLD/PARTIAL message that offers --force names --sha in named mode (FORCE_WORDS; default unchanged).
- diff-tree --root, so a V pointer in a root commit still finds its installer; docs: --commit must name a
  commit that changed V's pointer.

## Iteration 17 (challenge) changes
- The pointer comparison used JSON.stringify with Object.keys(p).sort() as a replacer, which is a key
  allow-list at EVERY level, so a nested difference was invisible. Now util.isDeepStrictEqual. The test isolates
  a nested-only difference (my first version of it differed at the top level too and passed on the old code;
  rebuilt, it is red on the old comparison).
- Not changed (NITs, disclosed already): the manifest is the dist/ copy (its sha is printed); /setup in the
  no-installer branch is compared with HEAD, as in default mode; the final PROMOTED line is the default one.

## Iteration 18 (challenge) changes
- The agent-spawn gate's contract comment states the named-mode exception; the downgrade message warns that a
  cause on this machine (a sign-in, a trust prompt) would hit V too, to check by hand before any --force.
- Both origin/main baseline reads are guarded by the same "has an origin remote" test as the publication check.
- A second pin: the gate's say() writes to stdout, which is all named mode captures (pin shown to refuse a
  stderr variant).
- Not changed (NITs): a middle republish is not compared; origin/main is hard-coded, as in the rest of the
  script and pointer_freeze_fetch; tee may reorder interleaved gate output against its stderr.

## Iteration 19 (challenge) changes
- With an origin, named mode requires the checkout to hold all of origin/main: a checkout behind it could miss a
  later commit naming V (a re-cut) and never ask for --sha.
- The agent downgrade message no longer says "before any --force" (it is reached only with --force given).
- The post-force advice says "which runs W" only when the gate read W, else "which could not be tied to V".
- set -f for the deliberate word split. Docs: the checkout must hold all of origin's main.
- Not changed (NIT): the final PROMOTED line keeps the default wording (disclosed).
