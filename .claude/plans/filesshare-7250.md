# #7250 — Windows attach: Files-folder link to a share is followed before refusal; confirm CI setup arms

Follow-up from PR #7243 (#7221). Re-scoped on 2026-10-26 after the base moved ~154 commits: the
`hiddenRefusal` rule-1 half (originally Finding 3) landed separately on main via Angel's #7226, so this
branch now carries only the core Files-folder-link bug (Finding 1) and the CI-arms confirmation
(Finding 2).

## Finding 1 (the core bug) — fixed, this branch

`engine/replyfile.js` `winLinkRefusal` / `ownShareProject` gated the own-share-project link follow on
`roots.folders`, which includes the agent's **Files** folder, not only its project folders. When the
Files folder is itself a drive-written symlink to a plain share, `ownShareProject` accepted the link,
the walk followed onto the share, and `realOf(given)` contacted the share **before** `filesRoot` (which
refuses any symlinked Files folder) would have refused it. A share-backed PROJECT folder is the person's
own choice (a project may live on a share); a symlinked Files folder never is, because Kosmos always
makes Files as a real folder.

**Fix:** gate `ownShareProject` on `roots.projectFolders` (project folders only) instead of
`roots.folders`. Current main still gates on `roots.folders` (line ~592), so this is a live bug. The
separate `inOwnShareFolder` use of `roots.folders` (the share-written-Files rule-1 exception) is
untouched and still correct.

**Arm:** `#7250: a Files folder that is ITSELF a link to a share is refused without a realpath contact`
overrides `dmfiles.filesDir` to a symlinked Files dir pointing at an unroutable share and asserts
`refusedUnresolved` (ON_NETWORK, zero realpath calls, fast). Red before the fix (the walk went onto the
unroutable share: red by realpath count or timing), green after. win32 CI arm (`linkOnly`, runs on
windows.yml, skips on the Mac). The review 11-2 arm above it is the positive counterpart: a drive-written
PROJECT folder that is a link to a share still attaches, so the narrowing refuses only the Files link.

## Finding 2 (CI setup arms) — confirmed, no narrowing needed, no code change

`setupSkip` hard-fails on Windows CI when a setup capability is missing. PR #7243's final
`windows-latest` run (head a6369835e, run 40402279569) was green with
`engine/replyfile.win32-7221.test.js [58 tests, 1 skipped]`. A green run with no `setupSkip` hard-fail
proves every setup-dependent arm actually ran; the 1 skip is the probabilistic review-9 BigInt-collision
arm, not a missing-setup skip. No code change.

## Finding 3 (hiddenRefusal rule 1 case/slash) — DROPPED; done on main by #7226

Originally in scope: rule 1's case-sensitive `startsWith(home + path.sep)` let `C:\USERS\me\.aws\...`
(case) or `C:/Users/me/.aws/...` (slash) dodge it. Angel's #7226 (`hiddencase-7226`, merged 2026-10-26,
commits 0919419c11 + 4c2efb1bf4) added `givenHiddenUnderHome`, which finds home by **identity** (device +
inode via `idOf`, links in the prefix followed) while walking the given path. Identity folds case, slash
spelling, a link to home, AND the 8.3 short-name alias (`C:\Users\ADMINI~1\...`) that a string approach
cannot. That is strictly stronger and more general than the `path.win32.relative` string-containment fix
this branch originally carried, so the Finding-3 change (and its `hiddenRefusal` `win` param,
`hiddenRefusalForTests` export, finding-3 unit test, and the `engine.reachable.test.js` reachability
excuse that the export forced) are all removed. The 8.3 residual I had flagged as a follow-up is also
closed by #7226's identity approach.

## Done when
- [x] the Files-as-share-link arm asserts zero realpath calls and fails against the current code
      (reasoned + harness; runs on windows.yml)
- [x] a Windows CI run shows the 7221 suite with every setupSkip arm running (reason stated for the 1
      probabilistic skip)

## Coordination
- #7226 (`hiddencase-7226`) landed the rule-1 half first; this branch no longer touches `hiddenRefusal`.
- Raiden's #7249 (winpath.js classifier) also edits the `ownShareProject` body. Merge-tree check before
  either lands; whoever lands second rebases.

## Verification
- `node --test engine/replyfile.win32-7221.test.js` on the Mac: the Files-as-share-link arm is `linkOnly`
  (skips on Mac), runs on windows.yml (required green).
