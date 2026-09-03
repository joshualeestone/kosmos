# Plan: #1996 - the report store refuses a reasonless summons and keeps paragraph breaks

## What this is

kosmos#1996, the SERVER-side residual of #1985's CLI fix (Splinter's routing: both
halves are server-side, neither needs a ruling). Two defects in engine/selfreport.js:

1. **Silent discard (the dangerous half).** `kosmos report needs_you`/`blocked` with
   an empty note recorded SUCCESS and stored `because: null` - a reasonless red on
   the board, the agent believing it had explained itself. Same empty-input shape as
   the sed bug #1985 fixed, and the same shape post/reply already REFUSE - only here
   it failed OPEN. `selfreport.record` now refuses the two WAITING_ON_A_PERSON states
   unless they carry actionable content.
2. **K-13 newline flatten.** `capped()` replaced newlines with spaces for EVERY
   field, collapsing a multi-line `because` in the stored record and undoing #1927's
   paragraph-break goal.

## Approach

- **Refusal mirrors #2001's already-merged CLI rule, with the SAME set** (a note OR
  --on OR --owner). #2001 refuses an empty summons before the network; this is the
  server-side half, so a summons arriving by any non-CLI path (SDK runner, direct
  loopback POST, a CLI predating #2001) is refused too. The sets MUST match: a server
  stricter than the CLI would reject `report blocked --on X`, which #2001 approves.
  `project`/`until` are excluded as non-actionable context, matching #2001.
- **New `cappedSentence` for `because`** keeps internal newlines (folding CR / U+2028
  / U+2029 to `\n`, and `\t`/`\v`/`\f` to a space, trimming only the outer
  whitespace). The single-value fields (on/owner/until/project/instance) still
  flatten via `capped` - a newline there is a display/injection hazard, not a
  paragraph. JSONL-safe (JSON.stringify escapes the `\n`).

## Decisions (Josh's autonomy ruling: made the call, here is the reasoning)

- **Refuse (not "record with no note but say so")** for needs_you/blocked: a
  reasonless red is close to useless (the card's words), and refusing forces the
  agent to say what it needs. Rejected: recording it and softening the success
  string (leaves the useless red on the board).
- **Scope to WAITING_ON_A_PERSON**, not all states: started/working/idle/stopped are
  informational and a bare heartbeat legitimately carries no note.
- **Weakest premise:** `blocked` with no content might have a legitimate quick use;
  if so the refusal is a cheap correction (it names exactly what to add), not a lost
  report, and #2001 already made the same call CLI-side.

## Verification

- 33 selfreport tests + full engine suite (2103) green. Tests assert the STORED value
  (selfreport.read), never the exit code - an empty string that round-trips as
  success passes every status check. Load-bearing control: blocked/needs_you WITH
  --on/--owner but no note is ACCEPTED (proves the server matches #2001, is not
  stricter on the actionable-content fields). Perturbation-verified: the new tests go
  red against the unfixed code.
- Callers checked: the only automatic needs_you/blocked writers (the permission hook,
  the StopFailure hook) always send content, so no live caller regresses.
- Reviewed via a challenge-loop across TWO models (Sonnet + Opus) deliberately, per
  the model-diversity lesson: independent-but-identical reviewers share blind spots.

## Deferred (documented, out of #1996's server-side scope)

- **Render visibility.** The report reason's detail-header surface (`.dtask`) is
  `white-space: nowrap` + ellipsis, so a multi-line `because` shows as one line
  THERE. The store now preserves the break (the source of truth, and the message
  surfaces already render #1927 breaks via `.dm-b` pre-wrap); a guaranteed multi-line
  render of the report REASON is a web/index.html UI decision (Renet's active file)
  and a separate follow-up, not a server change.
- **CLI/server whitespace-emptiness symmetry.** #2001's CLI uses `tr -d '[:space:]'`
  (ASCII); the server uses JS `.trim()` (Unicode-aware). A field of ONLY exotic
  whitespace (e.g. nbsp) is accepted by the CLI but refused by the server. This FAILS
  SAFE (the direction never inverts; the server never accepts a reasonless red the
  CLI would refuse) and the server's stricter behaviour is arguably more correct (an
  nbsp-only reason is visually blank). No valid server-side fix exists; perfect
  symmetry is a small CLI change for #2001's owner. Flagged, not fixed.

## Not in scope

The `msg` single-line measurement (card's "Also open") needs a two-agent box -
needs-operator, not code.
