# Plan: #1582 -- refuse an ephemeral temp-root hook path into a durable settings file

## Problem

kosmos#1582: every release cut resolves an `app/bin/kosmos-report-hook.sh` that genuinely
exists inside the cut's temp sandbox, and `ensureWired` persists that ephemeral path into
the durable, shared `~/.claude/settings.json`. That points all 18 agents at a directory
gone the moment the cut ends; the board then reports working builders as idle. Measured:
four distinct dead paths in one night, one per cut.

## Checklist

- [x] Add a fifth refusal to `engine/reporthook.js` `ensureWired`, matching the shape of
      the four existing refusals: do not persist a temp-root hook path into a durable
      settings file. (Per Josh's card comment: the resolver is correct; the fix is here.)
- [x] Handle the macOS trap Josh measured: `os.tmpdir()` returns `/var/folders/...` but the
      persisted paths are the resolved `/private/var/...` form, so compare against
      `fs.realpathSync(os.tmpdir())` (raw fallback) AND the raw form.
- [x] Refinement, flagged for review: refuse only when the script is ephemeral AND the
      settings file is durable (not under temp). The literal "any temp path" breaks the
      suite, whose fixtures put both under temp for isolation; the refinement matches the
      card's rationale (a DURABLE shared file must not point at an ephemeral tree).
- [x] Tests: resolved-form refusal (catches the trap), a non-temp control that must not
      fire, and the ephemeral-both case that must still wire.
- [x] Full `tools/run-tests.sh` suite green.

## Not in scope (the apply, per Josh: "wants an awake operator")

Cleaning the currently-poisoned `settings.json` and verifying the next cut no longer
re-poisons are the operator's apply step. This branch is the reviewable code fix only.

## Also related (recorded, not done here)

The same "land a new coordinator/relay pair WITH a join test or it silently rots" lesson
applies to the #1015 revoke-token work (separate design proposal in Josh-Brain).
