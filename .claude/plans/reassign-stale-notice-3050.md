# reassign-stale-notice-3050 - actionable staleness note + Update button (#3050)

## Problem (kosmos#3050, Josh 6.63 testing, for 6.65)

On the agent detail Instructions tab, when the instruction file has changed on disk
since the box was opened (Josh hit this after reassigning an agent to report to
someone else, which restarts the agent and rewrites its file), the staleness note
read:

> This file has changed since you opened it. What is in the box is not what is on
> disk any more. Reopen this agent to see the current version.

Josh's report: "there's no action for me to take or do anything as a user." The note
told him what to do ("reopen this agent") but gave him no control, and "reopen this
agent to see the current version" does not even parse cleanly. He asked for wording
like "This agent needs to be updated" plus an Update button that "spins our K
animation and then it's updated."

## The fix (web/index.html only)

1. **Reword the note** (`#d-instr-outdated`): "**This file has changed since you
   opened it.** This agent needs to be updated." - Josh's own wording.
2. **Add an Update button** (`#d-instr-update`) inside the note.
3. **Add a separate updating element** (`#d-instr-updating`) carrying the Kosmos K
   mark (`.kspin`), because `loadInstructions()` hides the note at its START (so the
   button vanishes the instant it is pressed); the K therefore cannot live inside
   the note.
4. **Handler**: on click, hide the note, show the K element, `await
   loadInstructions(CURRENT.sessionName)` - the existing reload path that fetches the
   current on-disk version, repopulates the box and `INSTR_VERSION`, and hides the
   note - then hide the K and, on a clean success, show "Updated." in `#d-instr-msg`.
5. Wire `#d-instr-updating` into the untied-card reset list so it hides on agent
   switch.

### Why reuse loadInstructions rather than a new endpoint

"Reopen this agent to see the current version" IS `loadInstructions` - the exact
reload the old text described. The Update button just gives that a control. It
replaces the box with the current on-disk version, which is the intended semantics:
the note only shows when the file has moved on from the box, and "Update" means "take
what is on disk now."

### Confirmation only on clean success

`loadInstructions` catches its own errors (never throws) and clears `#d-instr-msg` to
'' ONLY on the editable-file-loaded path; every other outcome (no file yet, not
editable, load failed) leaves its own sentence there. So the handler adds "Updated."
only when the message is empty after the reload, never clobbering an error/no-file
message.

## Tests

- **docs/browser-checks/render-reassign-update-3050.js** (new): drives the real page
  against a real fixture agent and the real `loadInstructions` handler, headless.
  Mocks ONLY the per-agent instructions endpoint (v1 -> v2, with a controllable
  delay) to stand in for the file changing on disk between opening the box and
  pressing Update. Asserts: the note names the action, the old "Reopen this agent"
  wording is gone, the Update button and the separate loader element (the Sweep loader
  .spin-sweep, NOT the .kspin mark) exist; the load-bearing reload arm (press Update ->
  box reloads v2, note + loader clear, "Updated." shown), with a CONTROL pinning stale
  v1 before the click so the post-click v2 proves the reload (not the initial load);
  focus lands on the result status line; the agent-switch race (switch to a second
  agent mid-reload clears the loader); and the same-agent-reopen race (reopen the SAME
  agent mid-reload fires no false "Updated." from the superseded reload). Verified
  14/14 green, and RED-capable on the load-bearing arms: reverting the wording reds the
  wording arms, removing the openDetail reset reds the switch arm, and removing the
  INSTR_LOAD token guard reds the same-agent-reopen arm.
- Wired into `tools/browser-checks.sh` (the self-booting loop), indexed in the
  browser-checks README, and `EXPECTED_SITES` in browser-checks-reason-grep.test.js
  bumped 109 -> 110 for the new chk() emit site. Browser-check meta-tests
  (wired / selectors / indexed / reason-grep) 18/18.

## Scope / non-goals

- Purely the detail Instructions tab note. The header restart card (`#d-instr-stale`,
  #1841/#2830) is a DIFFERENT surface and is unchanged.
- No engine change; the reload endpoint already exists.
- Full suite self-contends on this box (`node --test-concurrency=0`); validated via
  the targeted browser-check meta-tests + the headless render check + red-capability,
  per the standing fallback for this box. CI runs the full suite on GitHub's runners.
