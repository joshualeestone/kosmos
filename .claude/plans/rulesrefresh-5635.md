# rulesrefresh-5635: #5635 F1 (stale Kosmos-written instructions) and F2 (summary freshness counts idle time)

From Josh's multi-model feedback on 0.7.27 (2026-10-07), filed by Splinter. Card: kosmos#5635.

## Finished looks like
**F1.** At board start, every agent of ours whose working-rules text is Kosmos's own text that nobody edited is brought to the current rules with no click, and the running agent is told to read the section again. That covers both kinds of copy:
- a managed span whose content is a known earlier block (doctrine `knownContent`);
- a plain, unedited copy of an earlier block (doctrine `pastBlockIn`).

A test proves that a changed template section reaches an existing agent's file. Rules a person edited, files without the rules, and an agent whose person said Not now to this version are left for the click, as today.

**F2.** A summary still stale after #4581's idle and quiet rules also says when the member went idle ("last reported idle" for runners that report idle only), so idle reads differently from overdue. It stays stale.

## F1 decisions (Angel)
- **The consent rule was my own design for #539, not a ruling from Josh.** #539's body proposes "no instruction file changes without a person's click", and doctrine.js enforces it. Josh's 10-07 feedback asks for every Kosmos-written section to refresh live, the third report of the same staleness (#4890, #5297, now #5635). Recurrence is the tell: the click is not happening, so the person never gets the fix.
- **Once per BLOCK per agent** (review 3, re-keyed in review 4). The profile records the hash of the block last written (`doctrineWrote`), by this sweep or by a click. If a person puts the earlier rules back after that block was written, that is their choice, and only the click changes it until a later block ships. Keyed on the block, not DOCTRINE_VERSION, because text fixes ship inside a version (doctrine-past.js has several rows for v21, v24 and v25), and a later fix must still arrive. The record is written before the file and put back if the write fails (review 5), so a failed write is tried again at the next boot and a restore is never overwritten twice. A profile that exists but cannot be read stops the write (review 5): store.readProfile would read it as empty and lose a Not now.
- **Decided (review 3, W3):** a span from a click before #4890 holds only the headings the agent lacked, beside its plain copy. It is not a whole block, so it stays on the per-agent dialog, as today. That is the safe direction, and no such span exists on this Mac's 22 instruction files. A per-version list of section hashes would let these be proven too; that is a follow-up if one is reported.
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
- **Round 2 (sonnet):** 0 blockers, 2 warnings, both fixed in the no-click write.
  - W1: words on a marker line or inside the frame comment were not compared. Both marker lines are now exact, and every frame-prefixed line must be a frame Kosmos wrote (FRAME_TAILS; old wordings kept, so spans born before this change still update).
  - W2: a plain copy with a heading the person also has elsewhere was replaced minus that section. Now replaced only when every section is written.
  - CONVENTION: a span with Windows line endings is left for the click (no mixed endings).
  - NITs: the frame wording no longer overclaims ("while it is exactly as Kosmos wrote it, and asks first otherwise"). Decided: a plain copy inside a code fence is treated as on the click path (rare); ambiguous files and write conflicts still log at boot (they are real).
- **Round 3 (opus):** 0 blockers, 3 warnings.
  - The reviewer replayed all 34 historical blocks against the shipped table: every earlier block updates, the current one is left. Four real Kosmos-born files on this Mac update cleanly; the 18 hand-made ones are left.
  - W1 fixed: an undo was re-applied each boot; now once per version.
  - W2 fixed: a plain copy must end at a clean boundary (end of file, blank line, heading, marker).
  - W3 decided (above).
  - C1/C2 fixed: comment and docstring.
  - N1 fixed: old click frame tested.
  - N4 fixed: "last reported starting".
  - N3 fixed: the plan's F2 line.
  - N2/N5 decided: positive arms use a synthetic table (the reviewer's replay covered the real one); an imported file's plain earlier block is updated, by the card's principle.
- **Round 4 (sonnet):** 0 blockers.
  - Q1 answered no: nothing but an unedited whole block is written without a click.
  - W fixed: once-per-version would block a text fix inside the same version; now keyed on the block written.
  - Conventions fixed: the record is written before the file, and the click records it too, so a restore after a click holds.
  - NITs decided: doctrineVersion advanced by the auto write (harmless: it means "carries current rules"); boot logs for ambiguous files and conflicts are intended.
- **Round 5 (opus):** 0 blockers, 4 warnings, all fixed.
  - W1: the clean-boundary check runs on every replace, a span in the file too.
  - W2: the record is put back when the write fails.
  - W3: an unreadable profile stops the write (strict read; store.profilePath exported).
  - W4: the re-read line no longer says "with your person's OK".
  - C1 plan wording fixed. C2: F2's new shape is in the plan; the projectview JSDoc is left as is (nothing reads idleKind as "idle" without the state).
  - N1-N4 fixed: title, dead field noted, a control on the newer-summary arm, and the three new arms.
- **Round 6 (sonnet):** 0 blockers.
  - W fixed: the boot log's filter never matched ("instruction file", singular). A missing file is now `left` from refreshUnedited itself, with no string match, and refreshFleet is tested with an agent that has no file.
  - C fixed: the wholeKnownBlock comment is back above it.
  - NITs fixed: "may bring this block up to date" (no overclaim); the clean boundary takes a real heading line only (`#{1,6} `).
  - NIT decided: the source-level pin that the board calls refreshFleet stays; the behaviour is tested through refreshFleet itself.
