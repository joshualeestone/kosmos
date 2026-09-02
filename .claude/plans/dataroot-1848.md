# Plan: remote.js and you.js route their data base through store.ROOT (kosmos#1848)

## Problem
`engine/remote.js:61` and `engine/you.js:42` read `process.env.AGENT_WORKFORCE_DATA || store.ROOT`
directly, bypassing the one data-root derivation (`store.dataRootFor`, exposed as `store.ROOT`). Two
consequences (#1848, from a blind reviewer on the #1820 branch):
1. A RELATIVE AGENT_WORKFORCE_DATA scatters these two files' state to a cwd-relative path -- it never
   passes through the `p.isAbsolute` refusal #1820 added to dataRootFor.
2. They join under the BARE value, without the `AgentWorkforce` leaf dataRootFor appends, so under an
   override remote.json/you.json land in a DIFFERENT directory than avatars/profiles/the rest.

Splinter's framing: this is the PREREQUISITE for #1704 (one person, several Kosmos installations),
where AGENT_WORKFORCE_DATA is the multi-Kosmos SWITCH. The constraint on #1704 is "new code goes
through dataRootFor; nothing reads AGENT_WORKFORCE_DATA or os.homedir() directly." So the fix is the
STRUCTURAL one (route through the helper), not a per-call-site leaf patch.

## The change
- engine/remote.js: `const BASE = store.ROOT;` (was `process.env.AGENT_WORKFORCE_DATA || store.ROOT`).
- engine/you.js:    same. Updated the (now-wrong) comment that claimed the "click drive grandparent
  derivation" depends on the bare shape -- see below.
- engine/remote.test.js: remote.js's state files now live under SANDBOX/AgentWorkforce (the leaf), so
  the test derives `DATA_ROOT = require('./store').ROOT` and uses it for the 4 state-file references
  (was bare SANDBOX). Derived, not hardcoded, so it follows any future leaf rename.

## Prod-inert
In production AGENT_WORKFORCE_DATA is unset, so `store.ROOT` == the old `unset || store.ROOT` -- BYTE
IDENTICAL. The change bites ONLY the override/sandbox case (adds the leaf + the isAbsolute refusal).

## The "click drive grandparent derivation" -- NOT actually coupled
you.js's old comment warned it depends on you.json's bare sandbox shape. Traced: the only grandparent
derivation is web/index.html:27306 (`paintSettingsFacts`), which computes parent/grandparent of a
PROJECT folder (`p.folder`) to render "In your <parent> folder." -- unrelated to you.json's storage
depth. The browser check docs/browser-checks/click-first-run.js tests the UI, not file paths. So
changing you.json's depth does not affect it; the comment overstated the coupling and is corrected.

## Verified
- engine/remote.test.js 20/20 (baseline 20/20 without the change -> all 6 failures were my path churn,
  now fixed); engine/you.test.js 11/11 (self-consistent via the you.js API); and 7 other
  AGENT_WORKFORCE_DATA tests (server.remote-tick, firstrun-isolation-1780, engine.dirmode-1763,
  engine.runnable-not-directory, install.uninstall-litter-1547, projects, wouldping) all 0 fail.

## Deliberately NOT in this PR
- commitments.js:52 is a THIRD instance of the same `AGENT_WORKFORCE_DATA || store.ROOT` pattern.
  #1848 names remote.js + you.js; commitments.js (and #1821/trust.js) are the same class, left for a
  follow-up so this PR stays the two files the card names. Fixing 2 of 3 reduces the odd-ones-out from
  3 to 1; it does not create a worse inconsistency.

## Weakest premise
That the web grandparent derivation is truly decoupled from you.json's depth. I read the derivation
(operates on p.folder, a project path) and the browser check (UI-level), and both engine test suites
pass, but I did not exhaustively trace every consumer of the you record. If a consumer derives a path
UP from you.json's location, it would shift by one segment under an override.
