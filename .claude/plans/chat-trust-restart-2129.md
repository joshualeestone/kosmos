# chat-trust-restart-2129: surface the one-click Trust & Restart in the chat "Needs you" box

## kosmos#2129 (recovery half)

Josh, on 0.6.50, repeatedly hit Claude Code's folder-trust prompt when creating agents. On the
agent's chat ("Talk to X") view it renders as a "Needs you" box he could not respond to, understand,
or dismiss, and the only path offered was the manual Terminal arrow-key answer. The one-click
"Trust & Restart" button already existed but only on the Terminal tab (#d-trust-restart, route
POST /api/agent/<name>/trust-and-restart, shipped 0.6.44). This surfaces that same one-click action
in the chat-view box so the person acts in one click where the problem shows.

Split (Splinter, 2026-09-09): Baron owns the CORE prevention (pre-trust at agent creation, no build
in 0.6.50, a Josh-gated sign-in test remains); this branch is the RECOVERY affordance and is
independently shippable.

## What changes (web/index.html)

- A `#d-qask-trust-restart` button + `#d-qask-trust-restart-msg` receipt inside the `#d-qask` box.
- The render unhides it ONLY when `body.answerNote` is set. Per #1629, `answerNote` is sent for the
  Claude Code folder-trust dialog and is null for every other question, so the button appears for
  the trust prompt ONLY, never for the #2456/#2575 reported-question false-positive state
  (`body.question.reported === true`, answerNote null).
- A self-contained click handler (a deliberate copy of #d-trust-restart's, NOT a shared helper, so
  the qask isolation tests that lift this region do not throw on a delegate). Same route, same
  capture-and-recheck on CURRENT.sessionName.
- The receipt clears + the button re-enables on agent switch, mirroring the #d-trust-restart-msg
  reset (the qask elements are reused, not rebuilt per agent, so a landed receipt would otherwise
  stand under the next agent).

## Deliberate decisions / scope

- The byte-pinned qlab render line (web.trust-note-1629.test.js) and the answerNote copy in
  engine/status.js are NOT changed here. Reworking the copy to LEAD with the one click is a coupled
  fast-follow (it touches two byte-pinned render sites + status.js + the tests); the button is the
  core fix and stands alone. The box's existing text still explains the trust situation.
- Full dismissibility (an X that hides the box without acting) is out of scope: for the trust
  prompt, Trust & Restart IS the resolution. The false-positive box that should not appear at all
  is #2575/#2456 (Renet, detection root cause).

## Verification

- web.qask-trust-restart-2129.test.js pins the wiring statically (button exists + hidden by default,
  gated on answerNote, POSTs the route, receipt cleared on switch), with a control that fails if the
  answerNote gate is dropped.
- render-trust-restart-0644.js gains arm 7 (the chat-box twin) + its surface tokens.
- The live show-on-trust-state HEADED walk on the running app is owed to the dedicated claude-fe
  agent (this session has no Playwright); the node test + browser-check cover structure.

## Owner / lane

Filed + built by Mona Lisa (design/recovery affordance). Angel/Renet own the web seam and detection;
Baron owns the core prevention. Collision with Angel's orgchart-rings (#2576/#2577) checked: zero
region overlap (hers ~13253-19017, this ~7018/20913/25650).
