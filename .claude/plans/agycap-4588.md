# #4588 ask 3: a cap on how many Gemini (Antigravity) agents work at once

Card: joshualeestone/kosmos#4588 (a user's team, six Gemini agents on one Google AI Ultra account, locking each other
out on the shared quota). Parts A and B and the card line are served in 0.7.17. This is the card's third ask, "Offer an
option to cap how many can run heavy work at once", which their team does by hand. Design posted on the card before
building (12:1x CDT 10-02).

## Change
- `engine/agycap-setting.js`: the stored choice, `{ maxWorking }` in the data root, closed set 0 (no limit, the
  default), 1, 2, 3, 4. Absent reads no limit; a corrupt or out-of-set file also reads no limit (ok false), because a
  bad file must not hold every automatic message.
- `engine/agyquota.js`:
  - `heldForCap`: while `max` of our antigravity agents are working, an automatic line to another one waits, re-checked
    after CAP_RECHECK_MS (60 s). A line to an agent that is already working is not held. A Claude agent is not held and
    does not count. A pane that is not ours does not count. The quota-hold brake (AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF=1)
    lifts it too, and an unreadable setting holds nothing.
  - `heldForAgy` = the quota hold, then the cap.
- Every caller that asked `heldForQuota` "may this agent be sent automatic work now" asks `heldForAgy`:
  - assigner
  - roomhold
  - server's auto-retell ready check
  - the recommender
  - the reply nudge
  - chat.deliverAutomatic(Async)
  The assigner's givePart refusal names which hold applies.
- Routes: GET/PUT `/api/agycap-setting`. The PUT is screen-only (isViaScreen), since an agent lifting its own cap is
  what it exists to stop.
- Settings > Automation: a "Gemini agents at once" box below the Prompter, a select (No limit, 1 agent, 2 to 4
  agents). It follows the status-control contract: hidden until the read lands, and a failed read says so.

## Decisions
- **Default off:** a cap slows a team; the pause and hold already stop the pile-up after a lockout. That is the stated
  reason Josh's "on by default" rule asks for.
- **A person's own message is never held** (chat.deliver is not gated).
- **Rejected:**
  - holding a person's messages
  - pausing or killing working agents (loses work)
  - per-agent priority (not asked)

Weakest premise: that holding automatic lines (room posts, the assigner, nudges) is what reduces concurrent heavy
work. Agents the person drives directly by hand are not capped. What would change my mind: a report that the lockouts
happen while the person is messaging all of them directly.

## Tests
- engine/agycap-setting.test.js (6): default, the set, round trip, refusals write nothing, a bad file reads no limit.
- engine/agycap-gate-4588.test.js (8), with real fleet cards:
  - held at the cap
  - not held under it or with no limit
  - an already-working target is not held
  - Claude agents are not held and not counted
  - panes that are not ours are not counted
  - the brake lifts it, and an unreadable setting holds nothing
  - heldForAgy's order
- engine/agyhold-deliver-4588.test.js: deliverAutomatic at the cap is COULD_NOT plus held with the cap reason, and no
  process runs.
- server.agycap-4588.test.js (5):
  - GET defaults
  - a PUT from the screen round-trips
  - a PUT from a process gets 403 and the value stays
  - an out-of-set value gets 400 and the value stays
- web.settings-nav.test.js, and docs/browser-checks/render-prompter-label-1843.js on screen in both themes:
  - the new heading sits in the section order
  - the choices read No limit, 1 agent, 2 to 4 agents
  - the default is No limit
  - choosing 2 saves it

## Review 1 (opus) and what changed
- **BLOCKER, a burst was not capped:** a card reads `working` only after the next report, so a fan-out from one
  roster let every idle agent through. Now an automatic line reserves its agent at the gate (CAP_STARTS), before the
  first await, so a parallel fan-out sees it. The reservation counts as working for CAP_START_MS (3 min), or until the
  card says so, and a delivery that reached nothing gives it back. Tested: two parallel sends at cap 1 give exactly
  one held, and dropping the reservation reds it.
- **The resume sweep was uncapped:** at the cap it now skips without spending a try, and a resume that reached the
  pane reserves its slot. Removing the gate reds it.
- **A cap-held plain post to an idle member was never retried:** while a cap is set, flushReleased no longer applies
  the #4624 idle-plain skip, so those posts flush when the cap allows. The no-cap control keeps the old rule.
- **The page and API said "the quota is out" for a cap hold:** the verdict now carries `heldBy: 'quota' | 'cap'`, and
  `recordedBecause` and wakeHeldLine name the cap. The reply-nudge and recommender log lines name both holds.
- **UI:**
  - `ok:false` shows "We could not read the saved limit, so no limit applies."
  - A failed save repaints the stored value even while the select has focus.
  - The visible label is the select's accessible name (the extra aria-label is gone).
- Four source pins in server.agyhold-4588.test.js and replynudge-4951.test.js now name heldForAgy, and the givePart
  pin also checks heldForCap before assignPart.

## Review 2 (sonnet) and what changed
- **BLOCKER, the Assigner's fan-out was not capped:** givePart tells through chat.deliver (not deliverAutomatic), so
  it never reserved. It now reserves right after its cap check, and gives the slot back if assignPart fails or the tell
  reaches nothing. Tested with two gives back to back at cap 1 (the second is held before assignPart), plus a control
  where a failed tell keeps no reservation. Dropping the reservation reds it.
- **Corrected claims:**
  - A reservation counts for CAP_START_MS and is not ended early when the agent finishes. The Settings copy now says
    "while that many are working, counting each one it just started for a few minutes".
  - isViaScreen is advisory, and the route comment says so.
- Nothing is reserved while the cap is off.
- The room-hold comment now names the behaviour change for every held post while a cap is set.
