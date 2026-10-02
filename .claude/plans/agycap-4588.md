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
