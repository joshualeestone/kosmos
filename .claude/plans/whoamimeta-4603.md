# whoamimeta-4603: whoami and the board name a Muse (Meta) agent's model (#4603 N12)

Card: joshualeestone/kosmos#4603, 0.7.15 diagnostic (2026-10-01): "N12 (Meta, retested on 0.7.15): `whoami` names the
sign-in but not the model on the Meta seat. Suggested: read the model from the live session for every provider."

## Measured first (origin/main 2f258ad58)
- #4691 made whoami take a non-Claude agent's model from its card (what its own session record says). Every runner's
  card reads one (agy, Gemini, Grok, Codex) except Muse: status.js set `isMusePane ? { model: null }`, because Muse
  "picks its own model and says it per turn only" (engine/muserun.js: run.model.configured in each turn's JSONL).
- Nothing kept that per-turn model, so neither the board nor whoami could name it.

## What changes
- engine/musefront.js: after each turn that names a model, keepModel writes it to `.kosmos/muse-model` in the agent's
  folder (beside `.kosmos/muse-session`), 0600, only when it changed, only a safe id ([A-Za-z0-9._:/-], up to 120).
- engine/status.js: readMuseSession reads it for a Muse pane (job runner muse, the agent's worker folder), so the card
  carries the model like every other runner's; whoami's existing card path then names it.

## Decided, and rejected
- Rejected: asking Muse for its model out of band (an extra `muse` call per poll). The turn already says it.
- Rejected: the job's planned model as the answer. Muse picks its own; the record of what it actually ran wins, as
  for the other runners.

## Weakest premise
That the front's workspace is the agent's worker folder (create.workerDir), which readMuseSession reads. The supervisor
passes $WORKDIR to musefront.js; readGrokSession makes the same assumption for Grok. What would change my mind: a Muse
agent whose launch folder differs from its worker folder.

## Tests
engine/musefront.test.js (kept, unchanged by a turn with no model, an unsafe id refused, a change kept, mode 0600);
server.whoami-muse-4603.test.js (no model claimed before a turn, then the card and whoami name the kept one).

## Review 1 (Opus, blind, source-only): 1 blocker, 2 warnings, 3 nits
- B1 the board read the agent-writable model file with a bare readFileSync on every tick (a fifo hangs snapshot(), a
  link to /dev/zero floods it): FIXED, through readWorkerFile (refuses links and non-regular files, O_NONBLOCK, size
  cap), as every other reader of the workers directory does. Arm: a fifo returns at once and names no model.
- W2 the front's folder (fixed in the job at write time) and the board's (workerDir live) could diverge if the
  recorded folder changes after the job was written: ACCEPTED and stated; both come from workerDir today, and
  readGrokSession rests on the same assumption.
- W3 the kept model is never cleared (provider switched away and back, a new sign-in): FIXED, the front forgets it at
  start (forgetModel), so no model is claimed until a turn of this life names one.
- N4 readMuseSession sat under the Grok comment: FIXED, moved above it.
- N5 test pins: FIXED, source 'session' and the display name "Muse Spark 1".
- N6 keepModel followed links: FIXED, lstat; only a regular file is read or replaced, written via a temp + rename.

## Review 2 (Sonnet, blind, source-only): 0 blockers, 2 warnings, 5 nits
- Checked: readWorkerFile accepts the nested file, refuses a `.kosmos` link (outside or inside), returns fast on a fifo
  (lstat refusal; O_NONBLOCK in the swap window), caps at 256 KiB.
- W1 the fifo arm failed hard where mkfifo is missing: FIXED, its own test, skipped without mkfifo (the
  instructions/commitments pattern).
- W2 forgetModel at start blanks the model until the next turn after any front restart: ACCEPTED (staleness traded
  for a short gap, the W3 ruling); said on the card.
- N3 keepModel's lstat-then-read window: FIXED, the same bounded non-blocking reader. N4 a linked `.kosmos`: FIXED,
  refused; a failed rename's temp file is removed. N5 a display-style id is dropped: kept (Muse emits ids).
  N6, N7: kept.
