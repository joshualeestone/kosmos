# unansage-7969: --unanswered ages out old asks (kosmos#7969 item 1)

From the 0.7.88 cross-seat report: three seats' `kosmos room <id> --unanswered` listed 39, 41 and 102 historical posts.

## Measured (this board, renettilley in fleetbuilders, 11-04 14:20 CST)
168 asks listed. Of the 150 matched in the store: every one older than 3 days (91 at 3-7 days, 59 at 7-14), none from
the person; mostly multi-name thread traffic and colleagues' replies to my own posts.

## Decided (reversible; my call)
- An agent's open ask older than UNANSWERED_DAYS (3) is counted under the list, not listed:
  "[kosmos] N older posts that asked you something, more than 3 days ago and not from the person, are not listed. Add
  --all to list them too." `--all` (with --unanswered; alone it is refused) lists them.
- The person's asks never age out.
- When every open ask is older, the head says "nothing from the last 3 days in this room", so the line a CLI looks for
  stays.
- Found on the way, same branch: the Mac CLI printed "This Kosmos does not know --unanswered yet" over a correct answer
  in a long room. Its check piped the body into `grep -q` under pipefail; grep -q exiting at its first match SIGPIPEs
  printf on a body past the pipe buffer. Now matched in the shell (`case`).

## Rejected
Closing an ask when its asker posts again (it reads unclear signals as answers, and the measured noise is all age);
dropping old asks silently (an old real ask would vanish with no trace).

## Weakest premise
That 3 days fits other seats as it fits mine (the reported seats' rooms were not measured).

## Not here
- The Windows CLI (tools/windows/kosmos-cli.js) does not take --all yet: Homer's, as a spec on the card. It has no
  SIGPIPE (a JS regex).
- #7969 items 2 and 3 (external agents stuck on Can't tell, stale handoff live state).

## Tests
server.roomread-aged-7969.test.js (old counted not listed, --all lists, the person's never aged, the all-old head;
red with aging removed); cli.gaps-4891.test.js (a 200 KB answer gets no false warning, red with the old grep -q check;
--all reaches the board, alone refused).
