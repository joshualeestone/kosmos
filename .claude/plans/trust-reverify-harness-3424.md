# Plan: trust-reverify harness (#3424)

## Goal
A re-verify harness for the #2129/#3383/#3406/#3417 trust fix, against the acceptance
bar Splinter set with Josh: the fix is not "done" on one hopeful clean create. It must
pass (1) SEVERAL fresh agents created back-to-back, each seeded in the config location
THAT agent READS (not the default ~/.claude.json, never a sibling's dir), and (2) a
reboot with agents auto-starting, still clean.

## Approach
A single node:test integration file, `engine/create.trust-reverify-3424.test.js`, that
drives the REAL seeding code (`ensureLaunchTrust`, which its own docblock says mirrors
create.js's create-time calls) and asserts on the REAL files:

1. `#3424 bar (1)`: N=5 per-account agents created back-to-back are EACH seeded (trust in
   `configDir/.claude.json` projects, bypass in `configDir/settings.json`, onboarding
   top-level in `configDir/.claude.json`) with NO leak to the default config and NO
   cross-contamination between agents.
2. `#3424 bar (2)`: reboot proxy - re-run `ensureLaunchTrust` for every agent, assert
   idempotent (files byte-identical) and still correctly located, still no default leak.
3. `#3424 default-account path`: a no-CLAUDE_CONFIG_DIR agent is seeded in the DEFAULT
   files it reads (the ~/.claude.json / ~/.claude/settings.json equivalents), the
   #2129/#3406 read location.
4. `#3424 CONTROL`: an un-seeded agent has NO trust key anywhere - proving the assertions
   are non-vacuous (they would fire the #2129 wedge).

5. `#3424 bar (1), default-account variant`: SEVERAL default-account agents seeded
   back-to-back all survive in the ONE shared config (no dropped entry) - the
   read-modify-MERGE correctness for the shared ~/.claude.json. Explicitly SEQUENTIAL
   (the acceptance bar), not the #3088 concurrent file lock.
6. `#3424 #2129 used-machine regression`: a default-account agent IGNORES a poisoned
   CLAUDE_CONFIG_DIR - the clean-env-vs-used-env split that actually broke #2129. Asserts
   BOTH the config (trust) and settings (bypass) sides land in the sandboxed HOME, not the
   poison dir (they are separate code paths, configTarget vs settingsTarget).

(The above grew from the original 4 during the challenge loop: the concurrent-default merge
case and the poison used-machine regression were added in response to blind-review findings.)

The live post-reboot no-prompt BEHAVIOURAL check (real launchd auto-start + a live Claude
coming up) cannot run in CI (no reboot, no real account, and observing "no prompt" would
scrape a pane - the thing Kosmos is moving away from), so it is a documented runbook in
the test file's trailer.

## Why an integration harness (the gap)
- `create.trust-configdir-1629.test.js` is UNIT-level: it MOCKS trustFolder and asserts
  the ARGUMENTS. It never writes a real file or reads it back.
- `ensure-launch-trust.test.js` writes real files but for ONE default-account agent.
Neither covers N-back-to-back per-agent config-dir isolation (the "write file A, read
file B" class) or the relaunch/reboot re-seed. This file does.

## Key decisions / weakest premise
- Asserts CONFIG STATE (key in the read-dir), not a live no-prompt observation. The
  behavioural no-prompt follows from the key being in the read location by the established
  #3389+#3406 mechanism; the behavioural end-to-end stays Josh's live test + the runbook.
- Reuses trust.js's own KEY/BYPASS_KEY/ONBOARDING_KEY/canonicalOnDisk (no second
  derivation - the two-derivations-of-one-fact defect).
- Sandboxes every config root before requiring trust.js (the a-test-writes-the-operator-
  config hazard).
- If Angel/ICK's #3417 fix changes the config-dir model, the assertion shape tracks it
  (coordinated on #3417).

## Scope
Test-only addition. No product code changed. Owner: PigeonPete (#2129 config-seed owner),
at Splinter's direction 2026-09-22.
