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
- engine/agycap-gate-4588.test.js (12, after reviews 1 and 3 added the reservation, resume-sweep and brake arms),
  with real fleet cards:
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

## Review 3 (opus) and what changed
- **An active reservation is no longer refreshed.** A refresh let an idle agent that keeps getting lines hold the slot
  for good, and a later failed line released the first reservation, which had reached the agent. The window now runs
  from the first start. Tested, and putting the refresh back reds it. Nothing is reserved under the brake.
- **Sends that follow the person's own click skip the cap** (`{ cap: false }`): the restart pickup and the wake hello,
  including the team-create step's hellos. The quota hold still applies. Tested at chat level, with a source pin that
  exactly these two pass it.
- **Not covered by the cap, by decision:** sends an agent makes itself:
  - a task message to the task's assignees
  - a part one agent gives another (givePart's process branch)
  - membership lines

  Refusing an agent's own deliberate action is a different product call from holding Kosmos's own automatic senders.
  The Settings copy is narrowed to say "its own automatic messages, room posts and the tasks it hands out".

  Weakest premise, added: in a team, agents giving each other work directly bypasses the cap. What would change my
  mind: lockouts in a team that works mostly by agent-to-agent task messages.
- givePart releases its slot when the give changed nothing. The flush log says "after the quota hold or the Gemini
  limit". The browser check confirms its restore to No limit before the next theme.

## Review 4 (sonnet) and what changed
- **A delivery that throws now gives its cap slot back** (deliverAutomatic and the async twin release in a catch,
  then rethrow). Pinned in source, because deliver() is chat.js's own internal function and a stub cannot reach it.
- **The Settings copy says held messages "can arrive late".**
- **The room-hold cap test checks the idle member is told once:** the next retry types nothing.
- **Noted in comments:**
  - the connection-heal line is not capped, for the same reason it is not quota-held
  - wakeHeldLine's cap branch and recordedBecause's cap text are defensive (both callers send with { cap: false })
- **Accepted as the opt-in's trade-off, documented:**
  - agents that depend on each other can wait on a held one
  - a reservation lasts its few minutes even when the agent finishes sooner
  - held agents are not ordered

## Review 5 (opus) and what changed
- **The auto-retell's fan-out:** due() asked ready() for every member before any retell went out, so a retell earlier
  in the same pass (which reserves a slot) left a later member held after its one retell was spent. autoretell's
  sweepOnce now asks ready() again just before each retell (with due()'s own rule), and a member no longer ready is
  skipped without being marked acted. Tested (engine/autoretell.test.js); removing the recheck reds it.
- **Fixes:**
  - The Settings copy says a restart or new team you start "is not held by this limit" (the quota can still hold it).
  - givePart releases its slot if the tell throws.
  - The resume's reservation gets the sweep's env.
  - The firstreply and agentnudge log lines say which hold.
- **Not changed, decided:** a line to an agent that is already working still reserves it. That line becomes its next
  turn, so counting it is the conservative side.

## Review 6 (sonnet) and what changed
- **W1, an async rejection leaks the slot:** measured, not real today. heardBy turns a rejected tell into a failed
  verdict, so finish runs, takes the part back and releases the slot. The new test pins that (a rejecting deliverAsync:
  the give fails, no slot is kept), and removing the release in finish reds it. A rejection handler stays as a
  defensive guard, with a comment saying it is one.
- **W2, the cap changes non-Gemini timing:** not so. flushReleased skips every card isAgy refuses before the cap rule.
  The comment now says so.
- **W3:** a comment on why the resume sweep's head-of-line stop is safe with a single cap count.
- Deferred, already recorded: reserving a working target (review 5); the defensive cap branches in wakeHeldLine and
  recordedBecause (review 4); the source pin for the throw path (review 4).
