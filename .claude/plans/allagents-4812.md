# allagents-4812: the Agents view lists the agents of all your computers (board half)

Card: joshualeestone/kosmos#4812. Design: card comment 5923101367 (option A, browser-side). Relay half:
kosmos-relay `siblingcors-4812` (a computer answers `GET /api/status` to a LISTED sibling origin of its own
account, with CORS and its board token, only for a browser it already lets in).

## What this changes
- No engine change. (An earlier version passed the coordinator's `last_seen` through; review 1 showed it is
  refreshed only daily or on a reconnect, the page stopped showing it, and review 2 had the dead field removed.)
- `web/index.html`: a section below the agent cards, "Your other computers", one group per OTHER computer:
  - Read by THIS BROWSER from `https://<address>/api/status` with `credentials: 'include'`, never by the board.
    The card's rule: each computer decides who reads it. A browser that computer has not let in gets its
    gate's answer, and the group says so, with no agents.
  - Only on a page served from this computer's own Kosmos+ address (`location.hostname` equals the row marked
    `this`, over https). Anywhere else (the app's 127.0.0.1 board, a LAN address) the browser cannot read a
    sibling at all, so the section is absent and the view is today's.
  - Cards are READ-ONLY and separate from `LAST`. Every button on today's cards acts on THIS board's engine;
    putting another computer's agents in `LAST` would let Restart or Remove act on the wrong computer. Each card
    is a link that opens the agent on its own computer: `https://<address>/?agent=<sessionName>` (the existing
    deep link). Marked with the computer's name.
  - Sorted through today's sort (`sortAgents`, `AGENT_SORT`), projects empty. The rows carry only sessionName,
    name and state, so in practice that is name order, or Needs you first.
  - Unreachable (network error, timeout, 5xx): the last list this browser read from it, greyed, with the time
    THIS PAGE last read it. Never read here: "Not connected." with no time.
  - A list read longer ago than two rounds (the section was off screen) shows greyed with "Reading its
    agents...", and a read starts at once when the grid comes back on screen.
  - Repaints are per group and only when what the group shows changed; a note's time words are written in place.
  - "This computer only" checkbox, remembered per browser (`kosmos.agents.thisOnly`), hides the section.
  - Reads: computers every 60 s (the route probes each computer), each other computer's status every 15 s,
    each read cut at 10 s and the computers route at 30 s (OA_COMPUTERS_LIMIT_MS), only while the tab is visible and the grid is on screen.

## Decided, and rejected
- Rejected merging into `LAST`/the main grid: wrong-computer actions (above). The cost: other computers' agents
  sit in their own groups, not interleaved by the sort.
- Rejected a board-side read (board signs, asks siblings): a new computer-reads-computer trust path the card
  forbids (design option B).
- Rejected showing the section in the app's 127.0.0.1 board with a "sign in" link per computer: the page cannot
  read them from there whatever the person does. The app loading its own Kosmos+ address is the separate piece.

- GRID AND LIST (REVERSED 2026-10-02, Baron): the section shows under whichever agents view is on screen, the
  grid or the list (oaHost), and not under the org chart. The browser check at 320px showed why grid-only was
  wrong: a phone through Kosmos+ has NO grid view (#4823 shows the list instead), so the section never appeared
  on a phone, the case this card mostly exists for. The plan had named this exact reversal ("render the same
  section under #alist"). Org chart still excluded (a hierarchy, which another computer's agents do not join).
- (superseded) GRID ONLY (review 2, W3): the section shows under the card grid, so in the tab view with the Agents layout on
  list or org it is hidden and nothing is read. Chosen because the list and the chart are this board's own
  structures (rows with actions, a hierarchy) and another computer's agents have neither; a section under each
  is three placements to keep in step. Weakest premise: that list-layout people will switch to the grid to see
  other computers; nothing tells them to. What would change it: Josh or a tester asking where the other
  computers went in the list. Reversible: render the same section under #alist.

## Weakest premise
That `/api/status` from another computer can be rendered safely. It is that computer's own data, but this page
treats it as untrusted: every string goes in through textContent, every URL is built from the coordinator's
validated address (computerAddressOk) and an encoded sessionName, never from the answer.

## Tests
- web unit (lifted functions): eligibility (own address over https only; 127.0.0.1, http, another computer's
  address refused), classification (200 json with agents = ok; 401/403 or non-json = not let in; throw/abort/5xx =
  unreachable), a stale list kept and greyed on unreachable, dropped on not-let-in, link building (encoded, from
  the address not the answer), textContent only (an agent named `<img onerror>` stays text).
- browser check: the section with two fake siblings (one ok, one unreachable with a kept list), light/dark,
  desktop/phone; absent on 127.0.0.1.

## Review 1 (opus, blind, 2026-10-01 20:40): 0 blockers, 6 warnings, 3 nits. TO DO (next session), in this order
1. web/index.html ~18096/~43172: in the CONSOLIDATED layout `placeAgentsPanel` moves only grid+orgview, so `#oa-wrap`
   renders as a full-width band and oaRound reads every sibling every 15 s unseen. Add `oa-wrap` to the relocated ids
   (and the restore), add a consolidated arm to render-allagents-4812.js.
2. web/index.html ~27226: sibling rows go through this board's `sortAgents` (role mode calls `.trim()` on `a.role`), so a
   malformed sibling answer throws inside oaPaint, now called from boardApplyVisibility. Project rows in `oaAgentsOf`
   to {sessionName, name, state} coerced to strings (or try/catch the oaPaint calls).
3. web/index.html ~27240: oaPaint rebuilds all groups twice per round, losing keyboard/screen-reader focus. Skip the
   repaint when a computer's state is unchanged (or keep focus).
4. web/index.html ~27173: "last seen N ago" uses the coordinator's last_seen (refreshed only daily/on reconnect).
   Prefer the browser's own last good read (OA_SEEN), else word it without precision.
5. web.allagents-4812.test.js: assert the fetch's exact options (GET, credentials include, NO headers, NO body). The
   browser check's no-preflight guard cannot fail in Chromium (Playwright answers intercepted preflights itself); prove
   any browser arm red by adding a header once, or drop the claim.
6. render-allagents-4812.js:13: the comment claims routed answers prove the credentialed CORS shape; Playwright's
   route.fulfill injects the CORS pair. Fix the comment (only the relay's own tests cover the shape).
NITs: /api/remote/computers polled every 60 s even when "This computer only" or no siblings; "Open" link shown for an
offline computer while its first read is pending (updating ignored); a catch comment overstates freshness.

### Review 1 taken (2026-10-01, 2592b3ab1)
All six warnings fixed: oa-wrap relocates with the grid (and oaGridShown checks hidden holders, so nothing is read
while unseen); oaAgentsOf projects to {sessionName, name, state} strings; oaPaint skips the rebuild when oaPaintKey is
unchanged (focus kept); the not-connected note uses this page's own last good read, never the coordinator lastSeen;
the unit test asserts the request's exact options (no headers, no body); the browser check's CORS comment is
corrected and its preflight row relabelled as not a guard. New browser arm S4 (consolidated). Nits NOT taken:
the 60 s computers poll while "This computer only" is on, and the Open link during a first pending read.

### Review 2 taken (opus, blind, 2026-10-01 21:17): 0 blockers, 3 warnings, 7 nits
W1 per-group keys without time words (oaGroupKey), notes updated in place; W2 stale lists greyed (oaStale, 30 s)
and a read at once when the grid comes back; W3 grid-only recorded above as a decision. Nits taken: dead lastSeen
field removed; catch comment says the probe can be a minute old; a round asked for mid-round runs after it
(OA_AGAIN); the key uses a fixed agent order; the sort claim corrected; S4 waits out OA_BUSY and asserts
oaGridShown directly; the computers fetch is cut (10 s then; 30 s since review 3). Review 1's third nit (catch comment) is the one taken here.
Unit 13/13; 7 sabotages RED-OK (time words in key, never stale, unsorted key, stale not greyed, projection,
gridShown, fetch headers).

### Review 3 taken (opus, blind, 2026-10-01 21:23): 0 blockers, 4 warnings, 4 nits
W1 oaPaint is now unit-tested against a fake DOM (an unchanged round keeps every group; only the changed group is
replaced; focus goes back to the same agent; a note's time words change in place; a read starts on return even
before the computers are known); S4 no longer calls oaRound by hand and stops the 15 s tick, so it needs the
read-on-return. W2 oaReplaceGroup gives focus back to the same agent's card (data-session) or the Open link.
W3 oaPaint runs on visibilitychange and at the start of each round, so a list gone stale while hidden is greyed
before the computers route answers. W4 the computers fetch is cut at 30 s (OA_COMPUTERS_LIMIT_MS), above the
route's own worst case. Nits taken: OA_AGAIN only from the "This computer only" untick; read-on-return no longer
needs the computers list; S4 checks its own wait; the key comment states the same-name tie. fake-dom gains
replaceWith. Unit 17/17; 6 more sabotages RED-OK (no in-place note, always rebuild, no focus restore, no read on
return, return needs computers, replace every group).

### Review 4 taken (opus, blind, 2026-10-01 21:28): 0 blockers, 2 warnings, 4 nits
W1 the sibling reads run beside the computers refresh from the list already known (never behind it), so a 24 s
route cannot age a list past OA_STALE_MS or stall every computer; a unit test ties OA_STALE_MS above a round plus
a read cut. W2 focus falls back card, then Open, then the group (tabIndex -1), and the full rebuild (a computer
added, removed or renamed) restores focus by address. Nits taken: fake-dom drops focus from removed nodes, refuses
focus on what a browser would, guards replaceWith; tests for the busy gate, the Open fallback, the rebuild path;
read-on-return waits for oaStart (OA_TIMER) and https; reads re-check oaGridShown, so a round that began on screen
reads nothing once the grid has gone. Unit 22/22 (+3 sibling fake-dom suites green); 5 more sabotages RED-OK.

### Review 5 taken (opus, blind, 2026-10-01 21:33): 0 blockers, 2 warnings, 7 nits
W1 the computers refresh is its own guarded promise (oaRefreshComputers, OA_REFRESHING): a round awaits only its
reads (the first round alone waits for the list), so a hung route neither holds OA_BUSY nor drops ticks. Driven by
unit tests of oaRound itself with a fetch that never answers (2 s test timeout, so a regression fails, not hangs).
W2 the per-group path needs the same computers in the same places (by address), else a full rebuild; focus goes
back by address, or to the section title (tabindex -1) when that computer is gone. Nits taken: the re-check
comment says it matters on the first round; focus on a group stays on the group (the unused open flag removed);
OA_SEEN forgets computers off the list; fake-dom refuses focus when disabled, on a link with no href, or under a
hidden ancestor (and says what it does not model); a test renamed; the source-regex check replaced by driven
tests. Unit 26/26 (+3 sibling fake-dom suites green); 6 more sabotages RED (one by exit code: a timed-out test is
counted "cancelled", not "fail", so read the rc, not the fail line).

### Review 6 (opus, blind, 2026-10-01 21:40): 0 blockers, 0 warnings, 5 nits, all taken
A read that lands after a refresh dropped its computer is not kept (tested, sabotage red by rc); each group paints
as its own read lands; the rebuild comment says a same-address rename is a per-group change; fake-dom says it does
not model detached nodes; a dead stub removed. Unit 27/27.

### Review 7 (opus, blind, whole diff, 2026-10-01 21:44): 0 blockers, 1 warning, 6 nits, all taken
W: painting each group as its own read lands is now tested (pizzarama held open, agent1s must show first;
sabotage red). Nits: a throwing per-read paint cannot end the round early; the write-back guard has no typeof
escape (the test sandboxes declare OA_COMPUTERS); the write-back test renamed "read:" (it drives oaReadOne, not a
round); README row no longer promises a last-seen time; the sort control repaints the other computers' groups at
once (NOT unit-tested: the handler lives in the page's global change listener); OA_MAX_AGENTS = 500 cards per
other computer (tested). Unit 29/29; 3 sabotages red by rc.

### Review 8 (opus, blind, whole diff, 2026-10-01 21:47): 0 blockers, 1 warning, 2 nits, all taken
W: a 200 whose body is cut off (this page's time limit, a dropped connection) was read as the gate ("not let in"),
erasing the kept list and asking for a sign-in; now only a body that fails to PARSE (SyntaxError) is the gate, and
anything else is no answer (tested both arms, sabotages red). Nits: a read this page aborted itself is "out", not
"did not let this page read" (NOT unit-tested: the abort is internal to oaReadOne's 10 s timer); a greyed list from
a refusing computer says when this page last read it (tested). Unit 31/31.

### Review 9 (opus, blind, whole diff, 2026-10-01 21:52): 0 blockers, 1 warning, 2 nits, all taken
W: a failure AFTER the headers came through (a dropped body) on an online computer read as a refusal; oaReadOne
now records that the headers arrived and reads any later failure as not connected (the test now asserts 'out' on
an online computer with a TypeError body; the old test only asserted "not notin", which a 'blocked' regression
passed). Nits: the computers route is asked at most once a minute even while no list is known (tested); the
read-on-return comment no longer claims oaStart waits out first run (it does not; reads under the first-run cover
show nothing and reach only this account's computers, so no wait was added). Unit 32/32; 2 sabotages red.

### Review 10 (opus, blind, whole diff, 2026-10-01 21:57): 0 blockers, 0 warnings, 1 nit, taken. CONVERGED.
The 'blocked' words no longer read as a refusal the person can clear by signing in: "is online, but its agents
cannot be read from here yet. It may need the latest Kosmos." (an older connector is the usual cause). Unit 32/32.
Loop converged at iteration 10. Remaining before the PR: bc-4812 (browser check + 2 sabotages), full validation,
proof file; the PR opens only after the relay half (kosmos-relay siblingcors-4812) is merged.

## Mortals full validation (d30b03c85, 02:59): 3 guard reds, all fixed 07:25 after a rebase onto main ec62319c7
- browser-checks-reason-grep: the check's chk() FAIL line is a new emit site -> EXPECTED_SITES 231 -> 232 (measured).
- fixture-discipline: 26 hand-built cards in web.allagents-4812.test.js -> a card(name, over) helper over real
  test-support/fleet cards (sandboxed env); hostile remote values are fields set on a real card; the 2000-agent cap test
  renames one real card by assignment; the three-field row output is asserted as keys + [sessionName, name, state]
  triples, not as a hand-built object.
- web.consolidated-980: #oa-wrap made the body's 40th direct child; the consolidated grid reserved 39 pre-rail rows.
  Did the documented five-site renumbering: repeat(39 -> 40, auto); #rail-agents 40 -> 41, #alist 41 -> 42, #rail-me
  42 -> 43, #panel-projects 40 -> 41 / span 3; pins updated in web.consolidated-980 / -867 and web.rhythm-1303a.
  Rejected: moving #oa-wrap inside another body child (every `body.consolidated > #grid`-style selector assumes the
  grid and its neighbours are body children; placeAgentsPanel already moves all three into the agents panel there).
Focused, green: web.allagents-4812 32/32, fixture-discipline 20/20, reason-grep 5/5, consolidated-980 13/13,
consolidated-867 7/7, rhythm-1303a 6/6. STILL OPEN: the #oa-only click hang in the browser check (both engines).

## Review (opus, blind, 2026-10-02 15:38, GRID AND LIST + fake-dom): 1 BLOCKER, taken (e27fb4ca)
B: in the consolidated layout #alist is the left RAIL, shown on every consolidated tab, so oaHost() took it, pulled
#oa-wrap out of #panel-cons-agents into the body grid and polled the other computers on every tab (review 1's W1
back). FIXED: when body.consolidated, only #grid counts. fake-dom gets document.body with classList; a unit test
(consolidated: rail shown, grid hidden -> null; grid shown -> grid; tab layout -> alist) goes red with the condition
removed (measured). README names S4/S5. NITs: oaGridShown's comment reworded (name kept).
Measured after: unit 35/35 + the other fake-dom suites; browser check run 5: 58 PASS / 0 FAIL in both engines, both
sabotages red.

## Review (sonnet, blind, 2026-10-02 17:58, the rail fix): CONVERGED
Fix complete (showTab toggles body.consolidated before placeAgentsPanel/boardApplyVisibility; a saved 'list' layout
still shows #grid in the consolidated Agents view; org hides it and the section with it). LEFT NIT: rename oaGridShown.

## Rebase onto main (18:01): EXPECTED_SITES 233 (main: #4930 + #4885) -> 234 with this branch's site.
