# kosmos#7212 slice 2: warn the person after 30 minutes of failed deliveries, whatever the cause

## Why slice 2 changed shape (evidence 2026-10-27, card comment 6443080731)
Josh's 0.7.70 report: an agent on his laptop has had every delivery fail since 2026-10-20 (room posts held, 236
community reminders undelivered) with its input box EMPTY, and the 0.7.69 stuck-input recovery logged zero recoveries
for anyone. Slice 1 keys its 30-minute line on `heldWhy === 'input'` (text in the box), so it is silent on this case by
construction. A warning keyed on any one cause misses the next cause. The ask: warn after 30 min of failed deliveries,
whatever the cause.

## Design
1. **One recorder at the choke point.** `chat.deliver`, `deliverAsync`, `deliverAutomatic` and `deliverAutomaticAsync`
   are where every sender ends (a person's send, room posts, community reminders, nudges, the limit-queue flush) and
   where every hold verdict returns (menu, limit, signin, quota, input). A small module (`engine/deliverystreak.js`)
   notes each verdict per session:
   - PLACED ends the streak.
   - COULD_NOT (held or not) starts it or extends it, with the verdict's reason (`heldBy`, `because`).
   - `busy: true` (another line still being placed in the same window) is not counted: the pane was busy, not stuck.
   - UNCONFIRMED does not end a streak and does start one: only PLACED is seen to land (decided 08:30, see below).
2. **The warning:** a streak whose first failure is >= 30 min old, with at least 3 failures in it, is said to the
   person once per streak and again each day it lasts (slice 1's resay rule): a board notice and a line on the card,
   "no message has been seen to reach it for N min", plus the most recent reason as what Kosmos *saw*, never as a
   verdict. One press: open the agent's terminal / restart it.
3. **Not doubled with what the card already says:** a streak made only of usage-limit holds while the card shows the
   limit is not warned (the card already tells the truth and the limit queue already reports it). Every other mix is.
4. State is in memory, on the board. A board restart re-arms the 30-minute clock: a week-long stall is warned 30 min
   after a restart rather than at once. Stated, not fixed here.

## Decided, and why
- Choke point over per-sender counters: one fact in one place, and it covers senders added later.
- 3 failures as well as 30 min: one refused line followed by silence is not a stall.
- UNCONFIRMED counts toward a stall: the report does not say which verdict the stalled agent's lines got, and leaving
  UNCONFIRMED out would be silent if they were typed with the Enter swallowed.

- The card carries the stall only while it reads idle or working (status.deliveryStallOf). A stopped agent refuses
  lines by design; needs_you, a sign-in or a limit already say themselves.
- It joins both needs-the-person rules (engine needsPerson, page agentNeedsAttention), so it reaches the Issue filter
  and the phone's Today. The phone reason is 'other' ("Kosmos needs you to look at it."): a dedicated code needs a Swift
  change (ios/Kosmos/TodayLogic.swift), offered as a follow-up, not built here. The iPhone app already maps an unknown
  code to 'other'.
- The card's WORD stays the state word (Idle / Working), as own_bound does; the sentence says why. A new word ("Not
  getting messages") is a page design call (stateCopyOf + cardlabel.labelOf), offered, not built.
- Project member rows do not carry deliveryStall (projects.js builds them field by field), so a stall does not light a
  project's Issue pill. Stated; own_bound shows how to add it if wanted.
- The reason words live once, in engine/deliverystreak.js WHY_WORDS, and ride on the card (`words`).

## Design (Mona Lisa's review, #7212 comment, 2026-10-27 10:58)
- The pill reads **Messages stuck** with the issue triangle, in place of Idle or Working, on the grid tile, the list
  row and the agent page; the tile gets the `.acard.attn` edge (cardStOf), so the Issue count and the cards agree.
  The phone's word (engine cardlabel.labelOf) is the same, kept equal by cardlabel-5959's parity list.
- The sentence: "No message has reached <name> for about N. <reason>. Open it to see what it shows, or restart it."
- Built instead of the plan's "one press" button and "board notice": the pill and the issue edge ARE the notice, and
  the card already opens the agent page, where restart lives. No new button.

## Round 1 (blind review) changes
- A card reading stopped or restarting, and the offline row, start the streak over: lines refused while it was down
  are not a stall of the agent that comes back.
- A refusal of the message itself (`contentRefused`: empty, too long, a bad attachment name) never counts.
- The board log says a stall only for a card that carries one (one rule with the card).

## Round 2 and 3 changes
- A stall is said only while failures are still arriving (the newest within FRESH_MS, 2 h).
- The minute sweep (deliverystreak.settleFor) starts over the streak of a card reading a state that says itself
  (stopped, restarting, needs_you, needs_trust, rate_limited, auth_failed, connection_lost, blocked), so the agent back
  at idle is not stalled by what happened meanwhile. Not 'unknown'. The card field's getter changes nothing: a read
  stays a read. A state shorter than a minute can slip between two sweeps (stated).
- Shared-quota holds join usage-limit holds as a planned pause when the card shows it.
- The last sentence is the engine's per reason (NEXT_WORDS): a restart does not help a sign-in, a limit or a quota.
- The #6436 retry that presses a line left unsent notes PLACED when it confirms.

## Untested, said in the PR
- server.js: the board-log line, the sweep's settleFor and sweep calls, and the offline row's null.
- engine/chat.js pressRememberedNow's PLACED note: the function needs a tmux pane and has no direct test anywhere.

## Built (local, branch heldwarn2-7212; merge hold on)
4ad318dfc5 engine recorder + wiring; 9b850fa6ef golden card re-capture; 621502920e card field gate, needsPerson,
page sentence; 672b1bfe0a offline row + paneless card carry deliveryStall null (web.not-running went 14 red
without it), with the Browser-check trailer. engine/heldwarn2-7212.test.js 14 tests; 10 mutants each red.
Full node suite on 672b1bfe0a: 24341 pass, 1 fail, and that one is main's own DST red (#7353, red on main 53091c239
under America/Chicago, green under UTC). Both page gates (#1720, surface) rc 0 locally.
Still to do before the PR: design shots (/design-shots) of the card sentence.

## Weakest premise
That a 30-minute run with nothing PLACED is a stall. A sender whose lines really land but always come back UNCONFIRMED
(a Windows channel that is always unsure) would be warned. The warning says "not seen to reach it", which is true there
too, so the cost is a true but unwelcome line, not a false one.

## What would change it
A record showing the stalled agent's verdicts were PLACED (then it is landing and not being acted on: a different bug,
the agent's own process, and this warning is the wrong tool).

## Order
After the EU/US perf test (Splinter 08:41). Page work needs design shots (`/design-shots`).
