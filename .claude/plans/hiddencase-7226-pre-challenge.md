---
pre_challenge: true
method: challenge-loop
branch: hiddencase-7226
diff_hash: 48e0530fcd3389535f9eb96029d278501ec047b072c65d3d9ff785100437dd1d
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T19:01:36Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, a fresh blind reviewer each round). **Converged:** Yes, at iteration 2 (no BLOCKER; its one
WARNING is a Windows-only, pre-existing spelling, handed to the Windows card #7221 with the evidence).
**Total findings:** 3 WARNINGs, 5 NITs. **Fixed:** 4 | **Handed to #7221:** 2 | **No action, with reason:** 2

Reply attachments' rule 1 finds home by identity, so home spelled in another case or reached through a link cannot
skip it (#7226). On main both new arms ATTACH the credentials file; with the change they are refused, with controls.
Validation: server.reply-file-6726, server.attachment-stream-6734, engine.reachable, cli.reply-file-6726 and the
standing guards: 176/176 on three consecutive runs (one earlier run had 1 failure whose name was not captured; the
three reruns were clean, so it is recorded here rather than claimed away).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs.
- Held: home matched at the first (outermost) identity match, so later matches can only check fewer names; repeated
  separators removed; firmlinks and bind mounts share dev:ino; Files handled before hiddenRefusal; a project at or
  above home refused earlier as too wide; cost one stat per component.
- [WARNING] engine/replyfile.js: on Windows the drive was walked twice (C:\C:), so the check never fired --> FIXED:
  walk only what follows path.parse(given).root (checked with path.win32 for drive and UNC roots).
- [WARNING] engine/replyfile.js: a backslash in a POSIX name was split as a separator --> FIXED: split on backslash
  only where path.sep is one.
- [NIT] a '.' segment after home caused a false refusal --> FIXED: skipped.
- [NIT] the case arm skips on a case-sensitive volume (CI on Linux) --> NO ACTION: correct skip; macOS CI and local
  runs cover it, and it ran (not skipped) here.
- [NIT] assert.ok(creds) could not fail --> FIXED: asserts the refused path is the same file as the real one.

#### Iteration 2 (opus)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs.
- Re-checked: attach() refuses any '..' first; drive, UNC, \\?\ and mixed-separator roots parse right; an
  unstattable component cannot turn a refusal into a pass; no new false refusals (a real dot name under home was
  already refused by the chain rule); both tests fail on the old code.
- [WARNING] Windows 8.3 short names (AWS~1 for .aws) have no dot as given --> HANDED to #7221 (Homer's Windows
  spellings card, comment 6424802826): Windows-only, and true before this change.
- [NIT] idOf uses plain-number dev:ino; 64-bit Windows file ids could collide --> HANDED to #7221 with the same comment
  (pre-existing).
- [NIT] the case arm's coverage is macOS-only --> NO ACTION (as iteration 1).
**Converged.**

### Rebase after the 0.7.70 hold (17:3x CDT)
Rebased onto main past #7243 (Homer's Windows half, #7221), which added functions at the same place in
engine/replyfile.js. Resolved by keeping both: #7243's otherFolderSkip/skippedMayHold, then givenHiddenUnderHome,
unchanged from the reviewed version. Re-run after the rebase: the reply-file suites, #7243's
engine/replyfile.win32-7221 and engine/winpath tests, and the standing guards: 192 pass, 0 fail (45 Windows-only
skipped on this Mac).

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | engine/replyfile.js | BRANCH | Windows drive walked twice | FIXED |
| 2 | 1 | WARNING | engine/replyfile.js | BRANCH | POSIX backslash split | FIXED |
| 3 | 1 | NIT | engine/replyfile.js | BRANCH | '.' segment false refusal | FIXED |
| 4 | 1 | NIT | server.reply-file-6726.test.js | BRANCH | case arm skips on case-sensitive volumes | NO ACTION |
| 5 | 1 | NIT | server.reply-file-6726.test.js | BRANCH | assertion that could not fail | FIXED |
| 6 | 2 | WARNING | engine/replyfile.js | PRE-EXISTING | Windows 8.3 short names | HANDED to #7221 |
| 7 | 2 | NIT | engine/replyfile.js | PRE-EXISTING | 64-bit Windows file ids | HANDED to #7221 |
| 8 | 2 | NIT | server.reply-file-6726.test.js | BRANCH | case arm macOS-only | NO ACTION |
