# Plan: collapse the pile of same-reason room refusals into one band (#2700)

## The problem

Josh, in the design channel 2026-09-10 (card #2700), on a project dialog room:
> "I'm confused by this: all of these messages at the bottom. Why did Kosmos stop and ask everyone to bring me in? It's just a string of notifications at the bottom. Is there some reason that it does this?"

His screenshot shows a project room whose bottom is a wall of notification bands:
1. one valve headline band: "This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in."
2. then one band per agent: "Raiden tried to post here and Kosmos stopped it: The room was going back and forth without landing, so Kosmos was holding it for the person." repeated for Sub-Zero, Johnny Cage, Kano, Scorpion.

## Diagnosis: fixable render pile-up, not a needs-decision

The behaviour is intended and well-reasoned:
- The room valve (engine/messages.js) stops a room that loops without landing and asks the operator in. That is the product doing its job.
- Per #315, every agent blocked by the valve leaves a `refused` row so it does not read as broken from the outside (before #315, only the first blocked agent was visible and the rest vanished silently).

What Josh sees as "a string of notifications" is the second part: one near-identical `refused` band per held agent, all repeating the same reason. So the fix is a UX/render collapse, not a change to the valve or a policy question for Josh.

## What "finished" looks like

- In a valve-stopped room, the bottom shows the single valve headline band plus ONE band that names every held agent once and gives the reason once, instead of one band per held agent.
- The who-was-held information from #315 is preserved: every held agent's name still appears.
- A single held agent renders exactly as before (no regression for the common one-agent case).
- No engine, snapshot, or route change: this is a client render transform only.

## Design

- Add `pjFoldRoomRows(rows)` in web/index.html: walk the room rows, and where a run of 2+ consecutive `refused` rows shares one `because`, replace the run with a single synthetic `{ kind: 'refused-group', from: [deduped held agents], because, at: last-in-run }`. The run breaks on a different reason or any non-refused row between two refusals; a run of one distinct agent is left as its own `refused` row.
- Add a `refused-group` branch to `pjRoomRow` that renders one `.msg-valve` band: "A, B and C tried to post here and Kosmos stopped them: <reason>." Names go through `pjNameOf` -> `pjJoinNames` -> `esc`; the reason through `pjSentence` -> `esc`, mirroring the `refused` sibling's escaping.
- Wire the fold at the single `paintRoom` call site, AFTER `pjRoomFilterRows` (so it folds exactly what is on screen) and as the LAST transform before render.

## Decisions and rejected alternatives

- **Collapse the refusals, keep the valve headline separate** (chosen) vs. **merge the valve headline and the refusals into one band**. Rejected the merge: the valve row and refused rows are different kinds with different senders, and the valve headline is the operator-facing "why", which reads best on its own line.
- **Preserve per-agent identity** (chosen) vs. **drop the names and show a count**. Rejected the count: #315 exists precisely so a held agent does not read as broken; keeping every name honours that while removing the repetition.
- **Fold at render time** (chosen) vs. **dedup in the engine**. Rejected the engine change: the refused rows are a correct record; the redundancy is purely presentational, so the fix belongs at the render layer and stays reversible.
- **Timestamp of the collapsed band = last refusal in the run** (chosen) vs. first. A single band spanning several events reads best as "as of when is this still happening"; the valve headline already carries the window's start.
- **Keep refused-group out of ROOM_NOT_SPEECH** (chosen) vs. adding the synthetic kind to that set. The set is an engine-emitted-kind vocabulary used by the speech-stamping loop; the fold is the last transform and runs strictly after that loop and pjSilences (both over the raw unfolded allRows), so a refused-group never reaches them. Documented the ordering invariant at the fold site instead of diluting the engine-kind set.

## Weakest premise

That every refusal in one valved room shares one exact `because`, so a run always groups. Verified against the producer: engine/messages.js appends the room refusal with a single fixed `because` string, and a drift-guard test pins the fixture to that producer, so if the engine ever varies the reason the test reds rather than silently shipping an ungrouped wall.

## Verification

- Runtime tests in web.post-receipt.test.js: the pure `pjFoldRoomRows` (grouping, run-of-one, different-reason break, interleaved-post break, dedup), the isolated `refused-group` render (one band, all names, reason once), and the `paintRoom` wiring hop end to end (the whole-wall-to-one-band case, asserting one collapsed band reaches pj-room). Fixture pinned to engine/messages.js.
- #1720 browser-check gate satisfied via a `Browser-check:` trailer (render-only fold covered end to end by the paintRoom test).
- Full suite green on HEAD; challenge-loop converged over two iterations (Opus, Sonnet).
