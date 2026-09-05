# Plan: #2020 STEPS 1 and 2 - restore the two telemetry opt-out controls (NOT flip defaults)

## Scope (Splinter's routing, 2026-09-03 11:00 CDT)

Josh 09-03: notify + ping should be "on, and they can turn it off". That needs the
opt-out controls he removed 08-26. The card splits into three steps:
- **STEP 1 (BUILD): restore the two Settings/create opt-out controls.** Reversible,
  nothing leaves any machine.
- **STEP 2 (BUILD): draft the disclosure copy, honestly.** Josh swaps wording later.
- **STEP 3 (HELD FOR JOSH): flip the defaults to ON.** The irreversible half (data
  leaving a customer's machine). NOT in this branch.

## What actually exists vs what was removed

The BACKENDS are intact:
- `engine/notify.js`: setting module (read()/setOn, default off, send gated on
  `if (!read().on) return`). Route `/api/notify-setting` GET/PUT exists (server.js:3361).
- `engine/ping.js`: setting module (read().on default false, setOn). Route
  `/api/ping-setting` GET/PUT exists (server.js:3164).

What 08-26 removed was the UI CONTROLS (web/index.html only):
- `2ac1c50f` removed the two Settings > Updates notify rows: markup
  (notify-row / notify-msg / tell-row), both paint functions, both refreshers, both
  click handlers, both addEventListener bindings, both call sites.
- `b35343e7` removed the ping create-tell control (create-tell / create-tell-note /
  create-tell-wrap + "Let the Kosmos team know you created an agent") and turned the
  send off in the same change.

## STEP 1 build

Restore the removed UI controls, wired to the EXISTING routes, WITHOUT changing the
defaults (both stay off; step 3 flips them, held). Restore from the removal diffs but
adapt to the file's current shape (the page has evolved since 08-26).

### 🛑 THREE STATES, NOT TWO (Splinter, 2026-09-03 11:10 - #2047 is the same bug on the existing rows)

The toggles read their state over /api/notify-setting + /api/ping-setting. On a 403
board the GET is gated (server.js:1583 gates EVERY /api/*), so the page never learns
the value. The naive paint - AND THE ORIGINAL REMOVED CODE I am restoring - draws the
switch OFF in that case. For a TELEMETRY OPT-OUT that is the worst bug: a switch that
falsely reads OFF tells the user "I am not sending anything" while the engine may be
sending (its pref file is absent -> engine reads ON). A privacy control that lies in
the reassuring direction is exactly what the 08-26 removal existed to prevent.

⇒ BUILD IT BETTER THAN THE ORIGINAL: the paint must render ON / OFF / COULD-NOT-READ.
Treat as COULD-NOT-READ (paintSwitch null + "we could not read this setting") whenever
the read failed - `!response.ok` (403/500) OR the body's `ok === false` (engine could
not read the pref). Only a 200 with a real `on` draws ON/OFF. The original refreshTell
just `.json()`'d the response without checking `response.ok`, so a JSON 403 body drew
OFF - reintroduce that and it is the #2047 bug on the privacy rows.

TEST THE THIRD ARM with a 403 fixture, plus a 200 arm as the control proving the real
value still renders. An assertion that only ever sees a readable board cannot fail on
this.

## STEP 2 build

Draft honest disclosure copy for each control (what is sent, to whom, that it is
off until turned on). Josh swaps the wording.

## Guard tests - UPDATE, do not weaken (Splinter's explicit trap)

> SUPERSEDED for the PING (2026-09-05, branch createping-2020): Josh ruled the
> created-agent ping back ON (#2020/#2013, "we need that back in for sure", "I've
> never said flip it off"). The "default is still off / ping.read().on === false"
> statements below were correct while step 3 was held; the ping guard now asserts
> the control PRESENT **and** ping.read().on === true (default+control together).
> The notify default stays OFF - its step-3 flip is a separate, still-held ruling.

`notify.test.js:114` pins the notify rows ABSENT; `ping.test.js:~182-203` pins the
ping control ABSENT **and** `ping.read().on === false`. Both check control+default
TOGETHER because "control gone + default ON" is strictly worse. Restoring the
controls flips the ABSENT half to PRESENT; I update them to assert the control is
PRESENT **and the default is still off** (ping.read().on === false, notify gated).
I do NOT assert on-by-default (that is step 3, held), and I do NOT edit them to
permit an uncontrolled on-by-default send.

## Traps (from Splinter + the card), recorded so I do not repeat them

- 🛑 Do NOT flip the defaults to ON (step 3, held for Josh). Nothing in this branch
  makes a send default on.
- 🛑 Do NOT dissolve the conflict with the autoupdate "decorative switch" story: the
  08-26 removals were GENUINE telemetry opt-outs, a DIFFERENT row from the
  autoupdate.js "could not move" switch. The conflict is real; only the default flip
  is held.
- 🛑 Do NOT weaken the guard assertions; update them to control-present + default-off.

## Verification

- Restored controls exercised by a committed headless browser check (docs/browser-checks,
  via ~/work/pw-runtime, sandboxed board): the two controls render in Settings/create,
  toggling one persists via the PUT and reads back via GET, and the default is off.
- #1720 trailer / browser-check evidence for the web/ change.
- Guard tests updated to control-present + default-off; full engine + web suites green.

## Not in scope

Step 3 (default ON) and the final disclosure wording are Josh's. The `msg` measurement
(other card) is unrelated.
