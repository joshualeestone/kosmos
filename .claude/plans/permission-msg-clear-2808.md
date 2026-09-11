# permission-msg-clear-2808 -- clean up the agent permission/needs-help message

Card: kosmos#2808 (Josh, 0.6.56, support thread 2026-09-11). Addressed to Angel by @-mention.

## Josh's ask (verbatim intent)
The "Needs you" / "waiting on an answer" message shows a wall of raw command text ("a ton of code and junk at the top", "a terrible big mess"). He wants:
1. Truncate the code/junk so it is not filling the top with a mess (a short readable line, full text still available).
2. A one-click button, worded for a white-collar user, to clear the message and make it go away ("Give this agent permission and clear this message" / "Dismiss").

## What finished looks like
- The raw command text in the agent-page "waiting on an answer" box, the header preview, and the project-room question box shows as a SHORT truncated line with an expand affordance, not a multi-line wall.
- A prominent, plainly-worded button on the waiting box clears the message in one click.
- Full command text remains reachable (expand), so nothing is lost.
- CI browser-check paints it and fails under perturbation; node suite green; challenge-loop converged.

## Design decisions (recommend + implement)
- **Truncate, do not delete.** Show the first line (or ~80 chars) + a "Show full command" toggle that reveals the full text. Keeps the information, removes the mess. Applies to: `qtext` (agent page, pjSetScreen at ~22146), `d-said` (header preview ~7428), and `pj-question-text` (project room paintThread ~38713).
- **Reuse the existing clear.** `pjClearState()` (~40421) already POSTs `/api/agent/<name>/clear-selfreport` and is the "Not waiting? Clear it" button (~10674). So the dismiss needs NO engine work. Reword that control to a prominent, white-collar "Clear this message" / "Dismiss" and surface it on the waiting box.
- **Word it as CLEAR/DISMISS, not "give permission".** WEAKEST PREMISE, stated: clear-selfreport clears the waiting/needs_you FLAG (dismisses the notification); it does NOT grant a live pending Claude Code permission (that would need an engine relay of the approval to the agent's session). Labeling it "give permission" would be false for a live prompt. The stale case (Liu Kang's leftover box, which is what Josh hit) needs exactly a dismiss. So MVP button = honest "Clear this message". What would change my mind: if an engine grant-relay already exists (it does NOT for a general Bash prompt; only the folder-trust `qTrust`/answerNote path has a one-click grant) -- then a true "Give permission" is the better label.
- **Fast-follow (needs engine, coordinate with Pete):** a real "Give permission" that relays the approval to unblock the agent for a LIVE prompt. Out of scope for this render PR; flagged to Josh in the ACK.

## Scope
- IN: truncation helper + apply at the 3 sites; reword/surface the clear button; node test (eval-slice runtime) for the truncation + button; a CI browser-check.
- OUT: engine grant-relay (fast-follow); the project-room clear button already exists (#2575) so only truncation there.

## Verification
- Night-shift plain-claude session (no Playwright): build the code + a CI browser-check (headless in CI). Interactive verify is Josh's in-app pass. Full node suite must stay green (watch the sibling count/render checks that pin the old rendering).
