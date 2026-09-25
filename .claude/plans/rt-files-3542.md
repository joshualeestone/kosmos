# Plan: #3542, render-thread red on every box

## Finished looks like
`render-thread` passes on current main on Agent1s, and it still fails if the page stops handling a
borrowed name's missing Files folder.

## What was measured (2026-09-24, Agent1s, origin/main 40025ee4)
- The card's original three failures are gone: two pass, and the focus one is a SKIP the check
  itself attributes to #3557.
- One failure remained: "no console errors" caught a 404 from `/api/agent/rook/files` while the
  check had the untied (borrowed-name) agent open.
- That request was added by #3614 (the agent page's Files list, ba5d029d). For a name with no
  folder of its own the route answers 404 by design, and the page turns it into "This agent has no
  folder of its own on this computer, so there is no Files list."
- CI never saw it: the CI allowlist skips render-thread, so only local and cut-time 3b runs fail.

## Change
`docs/browser-checks/render-thread.js`: a predicate `exempt404Files` tolerates a 404 only on the
untied name's own `/files` URL. It is keyed on that URL, not on the window while the untied agent is
open, like the existing removal-400 exemption: the Files list re-polls every 5 s, so a 404 can land
after the window closes. Four two-way controls pin its scope (covers rook's /files; not a tied
agent's, not a route under it, not another status). Then the page's sentence is asserted on screen
(innerText plus a height guard), so the 404 is tolerated only while the page actually handles it.

Rejected: changing the route to answer 200 with an empty list. That changes the product's
contract (the page tells a missing folder apart from an empty one by the 404), and it reaches
further than a check.

## Verified
- render-thread alone on the branch: all checks pass.
- Red control: with the exemption removed (committed, run, reset), render-thread fails on the 404.
- Red control: with the page's sentence changed to the route's "No agent by that name." (committed,
  run, reset), the new assertion fails.

## Weakest premise
That the 404 is the only thing left between render-thread and green on every box. Measured on
Agent1s only; Mortals was not rerun.
