---
pre_challenge: true
method: challenge-loop
branch: chatask-7016
diff_hash: f5f2389ce8174de9c469beeb9f703fd6ebdcc6a51ccbd1ac902b95a08caad467
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T02:44:46Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** all 5 WARNINGs from iteration 1, the CONVENTION and 4 NITs from iteration 1, 2 NITs from iteration 2 | **Deferred:** listed below | **Filed:** #7020 (server side) | **Asked:** 0

Validation at c87d4bdb38 (origin/main not ahead):
- `bash ios/LogicTests/run.sh`: VERDICT: PASS 704/704.
- Mutants, each run against the full suite and restored, all red: the arm floor, the arm window, a 5xx read as not sure, the answered lock, one press in the air, a typed send blocked during a press, presence off, reported questions, the reset guard, a retry during a press, a retry's read counting as sending, Send again during a press, booleans read as numbers, the settled card, the not-sure line kept out of Show details.
- Debug simulator build with -warn-long-expression-type-checking=100: no warnings (CI runs Xcode 26.6).
- Release simulator build: 0 KOSMOS_SAMPLE_ markers and no sample text; Debug has 8 (the control).
- Simulator shots of spec states 1 to 4, light and dark: ~/work/design-shots/kosmos-7016/. Tapping is not exercised (no tool on this Mac drives the simulator); the states come from Debug-only switches.
Subdirectory CLAUDE.md audit: none under ios/.

After the proof, Mona Lisa's design review (approved, one change) at e2f02d0cf6:
- the composer line clears on the next send or press, and sits 6 pt above the composer (her updated spec);
- the not-sure Debug sample now holds the answered lock, as a real not-sure press does, so its shot draws the buttons
  locked at 50% (the first shot set only the line).
LogicTests 704/704 again; Debug build clean at 100 ms; shot 4 retaken, light and dark.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] a retry could cross a press in the air. Fixed: retry checks it; a retry still reading counts as a send.
- [WARNING] Send again during a press marked the row sent and sent nothing. Fixed.
- [WARNING] a failed read left the last question pressable; every permission prompt shares its question line, so a stale card could approve the next command. Fixed: no thread read, no buttons. Server side filed as #7020.
- [WARNING] a refusal's sentence vanished with the next read. Fixed: the conversation line.
- [WARNING] VoiceOver heard nothing. Fixed: announcements and an Armed value.
- [CONVENTION] note precedence lived in the view. Fixed: Board.choicesState, tested.
- [NIT] tick read outside body; composer line left after a reset; parsing looser than the board's; the sample armed state in the future. Fixed.
- [NIT] deferred: the lock is keyed on the question, options and header, not the question alone (more cautious); FlowLayout re-arranges at placement; UIScreen width; the spec says buttons come back on not sure, the board keeps them off for 6 s (the code follows the board; noted for Mona Lisa).

#### Iteration 2
**Reviewer model:** sonnet
- No BLOCKER and no WARNING.
- [NIT] the arm note was kept off Allow and Deny. Fixed.
- [NIT] the conversation line outlived its question. Fixed.
- [NIT] deferred: a send in the same instant as a press can drop the typed words (not reachable by a person); the lock is not cleared when the menu goes (safer).
- [CONVENTION] deferred: ChatView wiring has no unit test (the decisions are in tested Board functions).
