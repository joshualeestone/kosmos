# restore-dircheck-2609: Restore must refuse when the agent's account dir is gone

Card: joshualeestone/kosmos#2609 (filed by April during #2570's loop).

## Problem

An agent's launch file names its account directory by absolute path (CLAUDE_CONFIG_DIR, or CODEX_HOME
for a codex agent). `restoreInner` (engine/remove.js) refuses on unsafe name / unreadable list /
missing record, and reports a gone PLIST (`plistGone`), but nothing checks whether the ACCOUNT dir
still exists. After #2570's one-click "delete for good", pressing Restore re-enables a launchd job
pointing at a deleted directory: the #1659 "working agent that behaves like a blank one" state. The
removed-list UI offered Restore for every record with no check.

## Fix (April's option 1: refuse + actionable reason)

In `restoreInner`, after the missing-record refusal: read the agent's plist via `create.readJob(clean)`
(already used elsewhere in remove.js) and, if it names a `configDir` that does not exist, REFUSE with a
sentence that says what makes it work -- "Add that account back under the same name first, then
restore." dirForLabel is deterministic, so a re-added account brings the exact path back (the
disconnect-then-reconnect path #2570's own copy points people at; after a disconnect the dir is renamed
aside, not deleted).

REFUSE is intentionally stronger than plistGone's warn-and-restore: plistGone re-enables a job with no
plist (benign no-start); configDirGone would run a BROKEN agent on a nonexistent account (worse), so we
refuse AND run nothing (no re-enable). Scope: a DEFAULT-account agent has `configDir: null` and is
untouched; a GONE plist makes readJob return null, so this does not fire (that is plistGone). Engine
half only -- option 3's proactive grey-out of the Restore control is a frontend (web/index.html)
follow-up needing browser verify.

## Verified

- Two tests in engine/remove.test.js (sibling to the plistGone test): (1) account dir deleted -> restore
  REFUSED, refusal names the cause + the fix, NO `enable` call ran, agent stays on the removed list;
  (2) CONTROL: account dir present -> restore RESTORED (the check must not over-refuse). Full
  remove.test.js: 63 pass. Perturbation (disable the check) reds test (1) only -> load-bearing.

## Scope: MAC ONLY (win32 follow-up)

This reads the account dir out of the launchd PLIST (via `create.readJob`). A win32 agent has no
plist -- a registered Scheduled Task -- so `readJob` returns null and the check never fires, yet a
win32 agent DOES carry an account dir (`win32job.js` puts configDir into the task argv). So a
Windows agent whose account was deleted still restores unchecked -- the same class, reopened on the
other substrate (this file calls a platform arm landing in one copy and not the other "this repo's
most expensive recurring shape"). Closing it needs new plumbing (`win32job.status` exposes only
`{registered, enabled}`, no configDir readback), and whether #2570's delete-for-good is win32-live is
unconfirmed, so it is a follow-up, not this card. Flagged in-code and here so the class is honestly
scoped rather than assumed closed. The Restore control grey-out (April's option 3, frontend) is a
separate follow-up.

## Weakest premise

`fs.existsSync` is case-insensitive on macOS, so a case-variant account dir reads as present and this
would NOT refuse -- but that errs SAFE (we do not over-refuse a restore that could land somewhere real),
and it matches the sibling `startableGone` plist check. April's own weakest premise (how often is a
removed agent's account legitimately absent at restore time) does not gate option 1: a clear actionable
refusal is never harmful, unlike a silent grey-out or a silent re-point to the default account.
