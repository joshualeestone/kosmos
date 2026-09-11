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

## Finalized implementation decisions (2026-09-11 night shift, after reading the code)

Scope is the AGENT PAGE only (Josh's "Talk to Liu Kang" screenshot). The project room `#pj-question-text` already has a clear button (#2575) and is a documented follow-up, not this PR.

1. TRUNCATION mechanism, chosen to avoid a blind edit to the huge render-talk browser check:
   - `.qask .pj-screen` is ALREADY capped at 200px with `overflow:auto`. render-talk pins only a scrollbar-consistency invariant (a vertically-overflowing box must draw the 6px bar), NOT a specific height. So I shrink the COLLAPSED max-height via a `.clamped` class (~3.4em) and keep `overflow:auto`. The invariant holds, so render-talk (run at the cut, not CI) needs no change.
   - A "Show full command" toggle (`#d-qask-expand`) adds `.expanded` to restore the 200px box. Full text is always in the DOM (pjSetScreen textContent is untouched, so the render checks that read textContent are unaffected).
   - The clamp/toggle only appear for a long question (text length > 160 or > 3 lines), decided from textContent so it is deterministic and needs no layout read.
2. CLEAR button wording = "Clear this message" (NOT "Give this agent permission"). Weakest premise restated: `clear-selfreport` clears the waiting/needs_you FLAG; it does NOT grant a live pending permission. A "give permission" label would be false whenever an agent is genuinely blocked (the button would not unblock it). For Josh's stale-leftover case, clearing IS the complete action. The wording is reversible in a commit, so it is my call to ship the honest version; the true unblock-relay is Pete's engine fast-follow, already flagged to Josh.
3. The agent-page clear handler is a self-contained copy of the trust-restart handler pattern (capture-and-recheck `CURRENT.sessionName === forAgent`), POSTs `/api/agent/<name>/clear-selfreport {reason:'operator-dismissed'}`, and on success re-reads via `paintTalk(CURRENT.sessionName, CURRENT.name)` so the next paint sees asking:false and hides `#d-qask`.

## Blast radius verified (before writing code)
- render-talk.js (agent page, run at CUT not CI): pins scrollbar-consistency + button count scoped to `#d-qopts .qopt`. My new buttons are not `.qopt`; my clamp keeps `overflow:auto`. Compatible.
- render-trust-restart-0644.js (CI-allowlisted): only touches `#d-qask-trust-restart`; no geometry/child-count deps. Compatible.
- render-pj-clear-2575.js (run at CUT): project-room only; untouched (I am not rewording its button, which it pins exactly).
- Node tests touching the area (web.qask-trust-restart-2129, web.said-*, web.unique-ids, web.fold-boxes, web.agent-nav) are source-grep and pin `d-qask-trust-restart` / `d-said`, which I do not change.

## Tests
- NEW node test `web.qask-clear-clamp-2808.test.js`: source-grep the wiring + a runtime eval-slice (no jsdom) of the clear handler and the clamp painter logic. Runnable in this session.
- NEW browser check `docs/browser-checks/render-qask-clear-2808.js` (mirrors render-pj-clear-2575, adapted to the agent page). NOT added to the CI allowlist, matching its sibling's precedent (clear-selfreport checks run at the cut). Adding a check bumps `browser-checks-reason-grep.test.js` EXPECTED_SITES and EXPECTED_CATCH_SITES.
