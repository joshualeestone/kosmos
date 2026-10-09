# rulesrefresh-5635: #5635 F1 (stale Kosmos-written instructions) and F2 (summary freshness counts idle time)

From Josh's multi-model feedback on 0.7.27 (2026-10-07), filed by Splinter. Card: kosmos#5635.

## Finished looks like
**F1.** At board start, every agent of ours whose working-rules text is Kosmos's own text that nobody edited is brought to the current rules with no click, and the running agent is told to read the section again. That covers both kinds of copy:
- a managed span whose content is a known earlier block (doctrine `knownContent`);
- a plain, unedited copy of an earlier block (doctrine `pastBlockIn`).

A test proves that a changed template section reaches an existing agent's file. Rules a person edited, files without the rules, and an agent whose person said Not now to this version are left for the click, as today.

**F2.** A member whose summary is older than the rhythm, on a project with nothing open for them, reads as idle since then, not overdue.

## F1 decisions (Angel)
- **The consent rule was my own design for #539, not a ruling from Josh.** #539's body proposes "no instruction file changes without a person's click", and doctrine.js enforces it. Josh's 10-07 feedback asks for every Kosmos-written section to refresh live, the third report of the same staleness (#4890, #5297, now #5635). Recurrence is the tell: the click is not happening, so the person never gets the fix.
- **The line that holds:** Kosmos rewrites without a click only text that is, byte for byte, a WHOLE earlier block (`wholeKnownBlock` for a span, `pastBlockIn` for a plain copy). Review round 1 showed `knownContent`'s per-section match also accepts a span with a section deleted or reordered, which is the person's edit, so that match no longer counts here. A person's words are never touched. That is the property #539 protected, and it survives. What goes is the click for text nobody but Kosmos wrote.
- **Kept on the click:** a span the person edited (`edited`), and a file with no rules block (appending sections to a file Kosmos never wrote rules into is adding to the person's text).
- **A Not now for this version is honoured:** no auto-refresh for that agent until the version changes.
- **At board start, beside the community sweep** (a board restart is the update, the same moment the other sweeps use). Each changed agent is owed the re-read line (instructionRereadOwe, #5297).
- **The frame line** written at birth and on a click says "Kosmos may update this block when the rules change, with your OK". It changes to say that Kosmos keeps the block current while it is unedited, and asks first once the person has edited it. sectionContentOf strips the frame line, so this changes no comparison.

## F2 decisions (Angel)
- **Measured first: the existing fixes shipped.** #4581's `idleExcused` and its R9 `quietExcused` (019251f45) are both in 0.7.27, whose app commit b2a018cb8 is in the served manifest. Josh's project still read all five stale. Each rule leaves cases out on purpose: `idleExcused` only covers runners that report working (not Codex), and `quietExcused` needs the project to have had a task. The test project's work most likely went through the room, which leaves no task time.
- **The call: the card's first option, "show idle since next to it".** A summary still stale after both rules now says when the member went idle, from its latest idle or started report (never an operator's clear), for ANY runner. The state stays 'stale'. Nothing is excused that the two rules did not prove, so an agent that stopped mid-work still reads behind, now with the fact that tells the two apart.
- **Rejected: counting only working time.** No working-time record exists for every runner (Codex reports idle only), so "only working time" would be a guess for some members and a fact for others.
- `kosmos project show` on both platforms prints these words (engine/projectview.js). The page shows no summary freshness, so it does not change.

## Weakest premise
That the test agents' stale text was a known earlier block. If the multi-model test project's files were edited, or born from a role text that carries the rules inline, this refresh would not reach them. Verify on a served build with an agent created before it (the card asks for that).

## Review log
- **Round 1 (opus):** 1 blocker and 3 warnings, all fixed.
  - Blocker: a deleted or reordered section was put back on every boot. Now only a whole earlier block is rewritten, tested against the shipped table, and red on the old code.
  - W2: no idle note when the summary is newer than the idle report; Codex and paneless members read "last reported idle".
  - W3: the module header and the frame-line notes now state the two writers.
  - W4: the sweep is `doctrine.refreshFleet`, tested on behaviour.
  - Nits: a missing instructions file is quiet at boot (N5). Decided as before this change: the frame-prefix filter (N6), and CRLF spans rewritten as LF without a loop (N7). The "idle since X ago" wording stays, as #4581's idle line has it (N8).
