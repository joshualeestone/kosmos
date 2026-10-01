# cligaps-4891: small CLI gaps from the 0.7.15 diagnostic (N4, N6, N8, N9)

Card: joshualeestone/kosmos#4891. N11 (role labels) is split out to #4896: it needs a reproduction on a board, and the
role text is each agent's own profile role, so it is not a CLI string.

## Measured on origin/main 26540d803 first
- N8 live: cmd_room parsed no flag; the server's text view was a fixed tail of 40.
- N6 live: GET /api/tasks?project=<unknown> answered an empty list on the board-token path (the token-only arm
  already 404'd), so both CLIs printed "No tasks for this project yet" and exited 0.
- N9 partly fixed already: `inbox` IS in `kosmos --help` now (#4784). Still live: `agents --help` fell to the
  general list, and the bare `report` usage (which --help prints) did not name `show`. Windows already names show
  and has no agents verb.
- N4 live: no verb clears needs_you. #2575's note says the intended clear is the agent reporting a non-auto state.

## What changes
- server.js: the room text view takes `n` (1 to 200, else 40; outside rows still at most half). /api/tasks with a
  project that does not exist answers 404 "there is no project by that name", except on the Tasks view
  (`view=tasks`), whose doors only name projects the page just listed.
- install/kosmos: `room <id> [-n N | --limit N | --limit=N]`, refused before any request unless 1 to 200;
  `report clear [note]` = `report working [note]`; usage names show and clear; `agents --help` has its own line.
- tools/windows/kosmos-cli.js: the same room flags, `report clear`, usage lines.

## Decided, and rejected
- `report clear` records `working`, not a new state. Rejected a new `cleared` state: every reader of states
  (board, phone, Prompter) would need to learn it, and working is what an agent that clears its flag is doing.
- Rejected, for now, clearing needs_you when the person replies (the card's third N4 ask). A reply does not prove the
  need is met (the person may answer half of it), #2575 already gives the person a dismiss, and the agent now has an
  obvious verb. What would change my mind: a board where agents demonstrably leave needs_you up after the answer
  lands, even with `report clear` in their usage.
- The Tasks view keeps an empty list for an unknown project: a 404 there could blank a page over a project that
  was archived between list and click, and no person types that URL.

## Weakest premise
That nothing reads /api/tasks?project=<id> expecting 200 for a missing project. Searched: the two CLIs and the Tasks
view are the readers; the CLIs already handle an error body (exit 1).
- Review 1 (Sonnet, source-only) found the one I missed: server.tasks-all-1382.test.js pinned the empty list. My
  search excluded test files. Updated to the 404, keeping its intent (never the global set).

## Review 1 (Sonnet, blind, source-only): 1 blocker, 3 warnings, 2 nits
- B1 tasks-all-1382 pinned the old answer: FIXED (above).
- W2 the outside cap was 0 at n=1, so `-n 1` hid a newest outside row or said "Nothing has been said": FIXED,
  at least 1; test added with an outside row newest.
- W3 the two CLI N6 arms cannot fail on old code (the CLIs already said a refusal): retitled as wiring checks;
  server.gaps-4891 is the arm that proves N6.
- W4 the 40-row control assumed the notes were the only rows: compared as text against n=40 now.
- N5 a project id starting with "-" is now refused by `room` on both CLIs (it is a flag there). Accepted: both
  agree, and ids made by Kosmos do not start with "-".
- N6 Windows strips odd characters where the Mac refuses: predates this, not this card.

## Verification
cli.gaps-4891.test.js (Mac CLI against a stub board recording every request), tools.windows-kosmos-cli-gaps-4891
(Windows via main() with injected fetch), server.gaps-4891.test.js (sandboxed board over HTTP). Each arm has a control.
