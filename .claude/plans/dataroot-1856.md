# Plan: nine engine files route their data base through store.ROOT (kosmos#1856)

## Problem
Follow-up to #1848 (PR #1855). NINE engine files still read the data root directly:
  autoupdate.js:35 commitments.js:52 engmode.js:25 forget.js:35 heartbeat-setting.js:25
  limits.js:31 notify.js:34 ping.js:44 policy.js:40
all the identical line `const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;`. AGENT_WORKFORCE_DATA
is the multi-Kosmos switch (#1704); a file that reads it directly reads the right variable at the
wrong time -- bypassing the AgentWorkforce leaf, #1820's isAbsolute guard, and whatever a switcher sets.

## The change (copy #1855, nine times)
Each -> `const BASE = store.ROOT;`. store.ROOT = dataRootFor(platform, home, env), so it inherits the
leaf + guard and cannot drift from the one derivation. Prod-inert by construction: `undefined || X === X`.

## Prod-inertness -- DEMONSTRATED, not asserted (the acceptance test)
Stashed the nine changes, captured each FILE-exporting module's resolved path with AGENT_WORKFORCE_DATA
UNSET on OLD vs NEW code:
  autoupdate/engmode/limits/ping -> /Users/.../Library/Application Support/AgentWorkforce/<m>.json
BYTE-IDENTICAL old vs new. The change bites only the override/sandbox case (adds the leaf + guard).

## Test churn (5 tests, the same shape as #1848's remote.test.js)
Under an override the modules' state moved under the AgentWorkforce leaf, so tests writing DIRECTLY to
a bare path (or to module.FILE without making its now-leafed dir) failed to find the dir:
- engmode.test / limits.test: mkdir dirname(module.FILE), not the bare SANDBOX.
- ping.test: fresh() now mkdirs dirname(ping.FILE) before the direct writes.
- autoupdate.test: write to mod.FILE (+ mkdir its dir), not join(dir, 'autoupdate.json').
- forget.test: the commitments dir is now store.ROOT/commitments, not SANDBOX/commitments (it already
  used store.ROOT for chats; commitments was the lagging half my commitments.js change exposed).
Also corrected commitments.js's now-stale comment (the layout gap it described is closed: the store now
lives at $DATA/AgentWorkforce/commitments, mirroring avatars/profiles).
Full engine suite: 1928/1928 pass, 0 fail.
- heartbeat-setting.test: its two direct hb.FILE writes were ORDER-DEPENDENT-green (an earlier
  test's write() created the leaf dir; green in the full run, ENOENT in isolation). Added a
  beforeEach mkdir dirname(hb.FILE) so each test is self-contained. (Caught by the blind review --
  my first "four with no failure -> inert" read was wrong for this one.) policy.test was ALSO order-dependent (its #479 direct policy.FILE write
  ENOENTs in isolation; my first isolation check was a FALSE GREEN, caught by the iter-2 blind
  review) -- fixed with the same mkdir dirname(policy.FILE). notify.test has no direct FILE write.

## create.js:213-214 (the VARIANT) -- ASSESSED, and LEFT OUT, per the card's instruction
supportDir() = `env ? join(env, 'AgentWorkforce') : join(home, 'Library','Application Support','AgentWorkforce')`.
create.js already requires store (no cycle), and on macOS supportDir() == store.ROOT byte-for-byte
(prod AND override). BUT supportDir() hardcodes the macOS shape, while store.ROOT via dataRootFor is
win32-aware -- so on Windows they DIFFER (store.ROOT gives AppData/Roaming, supportDir gives the wrong
Library/Application Support). Routing it through store.ROOT would therefore CHANGE win32 behaviour,
which (a) violates this card's "byte-identical when the var is unset" acceptance test on win32, and
(b) touches the Windows agent's install paths (supportDir()/bin holds the supervisor + bridge) --
Shredder's domain (#1112). That is a separate, deliberate change, not this PR. Left, and said so here
and on the card, exactly as the card's DO-NOT directs.

## Also left, per the DO-NOTs
- docs/browser-checks/* (they SET the var as fixtures).
- the raw os.homedir() class (~40 sites, #1821 covers trust.js).
- status.js:76,162 (reads the var for sandbox DETECTION, a legitimate different question).
