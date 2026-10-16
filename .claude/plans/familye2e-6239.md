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

## Result (first run 2026-10-15 23:0x CDT, relay main 416f8a05 built on the external SSD; current figures under Round 5)
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

## Round 4 (sonnet) fixes
- A preflight refuses a coordinator binary that predates the family kind (it must name "--kind is company or family"
  for a nonsense kind), with the rebuild line; shown against a stand-in old binary (refused, VERDICT FAIL 0/1).
- The watchdog names the last check reached; an org-create miss no longer prints CLI log lines as its detail.
- Kept, said at the site: the step 4b control matches the coordinator's refusal by its words (that answer has no code
  field). Kept (NITs): the fedproof* names and the copied helpers (#6287).
- Rerun: VERDICT PASS 23/23.

## Round 5 (opus) fixes
- The binaries' existence is checked before the family-kind preflight, so a missing bin dir says "missing or not
  executable ... (set FEDPROOF_BIN_DIR)", not "stale" (shown). The preflight's data dir is created first.
- Step 11 polls the audit log for the "left" row (a leave can be confirmed a moment later).
- Current figures, re-measured on this version: VERDICT PASS 23/23. NEGATIVE CONTROL (--kind company): VERDICT FAIL
  13/20, failing the six family checks; the company's join is taken at step 8 (no words screen needed), so step 9
  cannot join, step 11 is skipped, and "every check ran" fails at 19 of 22 too.

## Round 6 (sonnet) fixes
- The preflight calls a binary stale only when it does not know --kind; any other failure is reported as itself with
  its output (both arms shown with stand-in binaries: "unknown command" says predates relay#398; a config error says
  the check could not run and prints it).
- Step 9 polls the audit log for its "joined" row, as step 11 does for "left".
- Deduplicated: the default bin dir (rounds 1 and 4, kept as fed-own-e2e.js), the copied helpers (#6287).
- Rerun: VERDICT PASS 23/23.

## Round 7 (opus) fixes
- Step 10 expects the shared used-code sentence: a refused preview names no org to the board, and orgenroll's
  preview calls sayFor with no kind. Round 3's "family sentence where it has one" modelled a choice the preview does
  not make (corrected).
- Step 9's audit read reports a throw as its cause (no TypeError); both audit polls say why they poll (the coordinator
  writes the row before answering; a confirmed leave answers ok, a pending one answers pending).
- Step 7 checks the previewed org is the one step 5 made (its slug); the binaries check reads runners once; a
  redundant clause in the stale test dropped.
- Rerun: VERDICT PASS 23/23.
