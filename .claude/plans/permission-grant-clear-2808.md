# Plan: #2808 grant-half — one-click "Give this agent permission and clear this message"

## What finished looks like
On the agent page, when an agent is paused at a LIVE permission prompt whose parsed
menu has a clean affirmative first option (Claude's "1. Yes" / "Yes, continue"), a
single prominent gold button reading **"Give this agent permission and clear this
message"** appears above the raw option buttons. Pressing it sends that affirmative
answer to the agent's pane and the message clears itself. A non-technical user grants
in one obvious press without reading a raw menu.

## Context: what already shipped, and the exact gap
Josh filed #2808 (testing 0.6.56) with two asks: (1) truncate the code/junk wall, (2)
a one-click "Give this agent permission and clear this message" button.

- The **render slice** shipped in PR #2817: the command wall clamps to a ~3-line
  teaser with "Show full command", and a one-click **"Clear this message"** dismiss
  covers the *stranded* "Needs you" state (a leftover waiting flag, no live prompt —
  the state Josh actually hit). Clear is the complete action there.
- Josh's literal remaining ask is the **grant** for a *live* permission prompt. The
  raw affirmative option button already exists in the same box (`.qopt` in `#d-qopts`),
  but it is a raw menu label, not a plain "give permission" button. This slice adds the
  plainly-worded primary.

## Design
- Not a new engine relay. The affirmative is sent through the **same** `sendTalk(n, label)`
  path the raw option buttons use → `POST /api/agent/<name>/thread` with `{text, chose, asked}`.
  The server's **409 screen-check** refuses a pane that moved on; a placed send records the
  **answered-hold** (`TALK_ANSWERED`), which hides the box on the next paint — that is the
  "clear this message" half. No `clear-selfreport` call (that would wrongly clear a needs_you
  the agent still legitimately holds).
- **Coexists** with the raw option buttons and the stranded-state Clear (additive, #2146),
  never supersedes.

## The show/hide gate (the risky part — kept conservative)
Show the grant button ONLY when `opts` (which already carries: asking, live, not the
answered-hold, a confident 1..n menu) AND:
- `!body.answerNote` — excludes the folder-trust prompt, whose one-click action is "Trust
  & Restart" (a "grant" there would type into a dialog skip-permissions does not cover);
- `opts.length >= 2` — a real yes/no choice, not a one-option prompt;
- `opts[0]` label matches `/^\s*(?:[❯›]\s*)?(?:yes|allow|proceed|approve|continue|ok)\b/i`.
Otherwise hidden. Disabled while this person's own answer is in flight (`flying`), exactly
like the raw options (no double-answer).

## Files
- `web/index.html`: the button (in `#d-qask`, above `#d-qopts`), a spacing rule, the
  paint-gate block, and the click handler.
- `web.qask-grant-2808.test.js`: static wiring + runtime slices of the gate (shows/hides
  across affirmative/trust/non-affirmative/open/single-option/in-flight) and the click
  handler (sends opt[0] digit+label; disabled sends nothing).
- `docs/browser-checks/render-qask-grant-2808.js` (+ README row): live-paint + reachability
  + a real click, hermetic file://, at the cut — mirrors render-qask-clear-2808.js.

## Weakest premise
The raw affirmative option button already exists, so if Josh's verify of the shipped
render slice on 0.6.63 comes back satisfied, this plain button may be polish rather than a
blocker. Building it because it is Josh's literal wording and it cannot regress the slice;
Josh swaps/rejects on the screenshot. Affirmative = option 1 (grant this request), not
option 2 (don't-ask-again) — the minimal, safest grant; the raw menu keeps the stronger
option one click away.

## Verify
- Node: `web.qask-grant-2808.test.js` (11 assertions, red-capable hide cases). Sibling
  qask tests unregressed. Browser-check meta-tests green (the new id exists).
- Browser (claude-fe): drive the affirmative-menu fixture, screenshot the button, click it,
  confirm the send + box clears. Screenshot on the PR + Discord.
- Full suite via challenge-loop / create-pr.
