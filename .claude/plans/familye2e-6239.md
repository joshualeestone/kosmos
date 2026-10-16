# familye2e-6239: #6239 slice 2, seen working end to end (local, never production)

tools/family-e2e-6239.js runs a local debug coordinator and relay and two boards (P, a parent's computer; K, the
child's), reusing tools/fed-own-e2e.js's (#4693) helpers, and walks the family join as people do it: web sign-up,
board sign-in, P allows the parent's browser, operator org-create --kind family, the parent's join code from the
console, K's preview (family words, no company), a refused join without the words screen (the control), the join with
them, the board saying family, the coordinator's audit row, the spent code's neutral refusal, and the leave.

## Decided
- Local, not production: the #4693 harness already proves boards against a local coordinator, so no prod org, no
  second device and no operator step on the live box. Splinter was told (21:1x).
- A tool, not a test in the suite: it needs three relay debug binaries and runs minutes (as fed-own-e2e.js).

## Result (2026-10-15 23:0x CDT, relay main 416f8a05 built on the external SSD)
- VERDICT PASS, 21/21: the console refuses the parent's browser until P allows it (control), P allows it by the code
  its sign-up showed, org-create --kind family, the parent's join code, K's preview (family, family words, not joined),
  the refused join without the words screen (control), the join with it, K's board says family, the audit row
  ("words shown on the board's screen (the board's word)"), the spent code's neutral refusal, the leave.
- NEGATIVE CONTROL: the same run with org-create --kind company: 15/21, failing exactly the six family checks
  (kind, family words, the unseen-words refusal, the join, K's kind, the audit detail); its consent hash is the
  company's pinned 68fb6404...1151.
- Harness fixes on the way: org-create logs to stdout beside the id (parsed by line); the coordinator replaces the
  browser's offered device id (#5422), so P's row is found by the sign-up's match code; /api/org names the org only to
  the screen (#5531 review 12), so the GET carries the screen's headers.

## Found, not this branch's
- P's /api/remote/devices/allow answered {ok, acked, allowed: true} for a device id the coordinator does not hold
  (the browser's own offered id, replaced at sign-in). Nothing is granted to a real device, but the answer says one was.
  Filed as kosmos#6286 (the coordinator side answers 404 correctly; the board misreports).

## Round 1 (opus) fixes
- A guarded step that does not run can no longer pass: the run ends with "every check ran (21)", red when one is
  skipped (shown: step 8 forced off, 20 ran, VERDICT FAIL).
- The not-joined controls need a 200 and enrolled === false (an error answer no longer passes them); the spent-code
  refusal must say something; the family words are checked in their text, not the JSON keys.
- An invite call that only throws reports its cause, not a TypeError; no 60 s wait when there is no session.
- The code copied from fed-own-e2e.js that this run never calls is gone (20 declarations, the pane recorder and the
  room helpers); the watchdog budget and the board-count comment describe this run.
- tools.browser-checks-quiet-4253.test.js holds this file's boards to the three dead phone-home addresses too (red
  when one is changed).
- Rerun: VERDICT PASS 22/22.
- Kept: the default binary dir (as fed-own-e2e.js, with its usage line); the plan's file name (most plans here have
  no timestamp).

## Round 2 (sonnet) fixes
- Step 10 is discriminating: the spent code must answer org_code_used with the board's own used-code sentence
  (engine/orgenroll SAY), not just any words without "company" (K is enrolled then, so "already a member" was
  possible).
- Step 11 runs only after K joined, and the family's audit log must gain a "left" row (the coordinator's side).
- Orphaned comments from the trim removed or moved; EXPECTED_CHECKS says to bump it with each new check (now 22).
- Not done here: the shared helper module (#6287). fed-own-e2e.js runs on load, so sharing means re-proving #4693 too.
- Rerun: VERDICT PASS 23/23.

## Round 3 (opus) fixes
- Step 4b's Allow check says only that the route answered (it answers allowed even for an id nobody holds, #6286);
  step 6 carries the claim that the Allow took.
- Step 10 expects the board's own choice for a family (a family's sentence where it has one, else the shared one),
  so a family used-code sentence added later does not red a correct board.
- Step 8's comment no longer claims an unasserted "not spent" (step 9's join with the same code shows it); the invite
  retry reports the last throw rather than a stale answer; the GET without screen headers says why.
- Rerun: VERDICT PASS 23/23.
