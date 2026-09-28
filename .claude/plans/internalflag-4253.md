# internalflag-4253: rule C, our own machines mark themselves and the public count never reads them

## Why
kosmos#4253 (Josh: filter out test installs; Splinter go on rule C, 09:52 CDT). Harness boards already send
nothing (#4276). What is left is our own REAL boards: the fleet Macs, Homer's Windows box, and the operator's
laptop (Splinter's call: cdddde is internal). Today they need a hand-kept id list (rule B). Going forward, a
machine marks itself once and nobody keeps a list.

## The change (two repos, one branch name)
- kosmos `engine/createdbeacon.js`: `payload()` adds `internal: true` only when the data root holds
  `internal.json` with exactly `{"internal": true}`. Strict: missing, unreadable, "true", 1, {} are normal
  installs. Normal payloads are byte-for-byte unchanged (the contract test still pins four keys for them).
- chaoskosmos-site `api/created.js` + `api/_installs.js`: a ping with `internal === true` is filed under
  `internal/` (same name shape), which the public counter never lists. The count is read across both prefixes
  (Math.max kept) and the record under the other prefix is deleted, so a machine marked after its first ping
  moves out of the public count on its next ping. `recordName` / `parseRecord` are the tested pure half.

## Deploy
NOT before Josh picks the public numbers (Splinter HOLD 09:54). The site half changes nothing until a Kosmos
build that sends the flag runs on a marked machine; the Kosmos half changes nothing until a machine is marked.

## Not done here
- The admin read does not list `internal/` yet, so internal installs vanish from /admin too. Worth its own
  class there.
- Who writes `internal.json` on each fleet machine (a one-line echo into the data root) is a provisioning step,
  not code.

## Weakest premise
That nothing else reads `installs/` expecting every install to be there (for example the admin read or a
future per-install feature). Grep says only counts, admin and created list it.

## Full-suite validation (kosmos half, 10:27 CDT)
- node tests: 11,261 run, 11,096 pass, 0 fail.
- RED, mine, FIXED: the #4273 leak guard caught a createdbeacon-3038 temp dir. The file's cleanup was written as
  the LAST TEST, and the rule C test appended after it recreated the sandbox. The cleanup is now `test.after`.
  Proven both ways in a fresh TMPDIR: the old file leaves 1 dir, the fixed file leaves 0.
- RED, not this branch: test-tunnel-handshake-gate (3, then 14, then on untouched origin/main 53/0 and 35/18 on
  consecutive runs). That is #4352 (CANNOT TELL under load). This diff touches nothing under tools/.
