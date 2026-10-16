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

## First result (historical: the 21-check version, 2026-10-15 23:0x CDT; the current figures are in the latest round below)
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
- Kept: the default binary dir (superseded in round 8: now required); the plan's file name (most plans here have
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

## Round 8 (sonnet) fixes
- FEDPROOF_BIN_DIR is required (raised in rounds 1, 4, 6 and 8): no default path, and a run without it stops before
  making anything, with the build line (shown: rc 2).
- The not-joined reads in steps 7 and 11 go as the screen, as step 9's does.
- The watchdog, signal and uncaught-error failures carry a label.
- Kept (round 4): the step 4b control matches the refusal's words (it has no code field).
- Rerun: VERDICT PASS 23/23.

## Round 9 (opus) fixes
- The stale comment about a default bin dir is gone; the watchdog budget counts the two audit polls (465 s).
- "Stale" now means exactly what an older binary prints for an unknown flag: its org-create usage line, which has no
  --kind (read from relay main before #398). Shown with stand-ins: that line says predates relay#398; a config error
  says the check could not run. (My first attempt, "says nothing about a kind", called a config error stale: caught by
  rerunning round 6's arm.)
- A pending row without a device_id fails step 4b as a check, not a TypeError; the file is 755 like fed-own-e2e.js.
- tools.browser-checks-quiet-4253.test.js finds every harness by its boardEnv, with a check that both known proofs
  are found.
- Rerun: VERDICT PASS 23/23; the quiet guard 7/7.

## Round 10 (sonnet) fixes
- The "every check ran" line names the steps that never ran (the company negative control now reads "19 ran; never
  ran: step 11").
- Step 9's detail points back at step 8 when the join is refused for a spent ticket or code (they share both).
- Deduplicated: the step 4b wording control (round 4), the copied helpers (#6287). NITs kept: the port range shared
  with fed-own-e2e.js (picked free at use), the family-words check by text (the negative control pins the hash).
- Rerun: VERDICT PASS 23/23; negative control VERDICT FAIL 13/20.

## Round 11 (opus) fixes
- The three synchronous child calls (the preflight, dev-cert, org-create) each have a 30 s timeout with SIGKILL: a
  timer cannot fire while one blocks, so the watchdog could not bound them. Shown with a stand-in that hangs: the run
  ends at 30 s with a failure.
- Steps 9 and 11 need exactly one "joined" and one "left" row in the family's log (org-create writes org_created, not
  joined), so a parent's row could never be read as K's; step 11's poll reports a throw or an error answer.
- The preflight passes PATH only when set; node:dns is required at the top.
- Kept (NITs): the hand-written step list beside EXPECTED_CHECKS (both say to update with a new step); the quiet
  guard's discovery by text.
- Rerun: VERDICT PASS 23/23.

## Round 12 (sonnet) fixes
- Ports from 28000-28999, not fed-own-e2e.js's 27000s, so the two harnesses can run at once.
- Step 10 names a missing or renamed SAY.org_code_used and fails as a check, not a harness crash.
- Deduplicated: the step 4b wording control (round 4), the copied helpers (#6287); NITs kept as in rounds 10 and 11.
- Rerun: VERDICT PASS 23/23.

## Round 13 (opus) fixes
- Step 6 runs only once step 5 made the family, and step 10 only once step 9 spent the code, so one failure is not
  reported twice; the end line names what was skipped. Negative control now: VERDICT FAIL 12/19, the six family checks
  red and "never ran: step 10, step 11".
- The orgenroll require in step 10 is guarded too; the leave poll clears an earlier error on each attempt; the
  missing-bin-dir line goes to stderr; step 10's company clause says it pins the constant.
- Kept (NIT): round numbers in comments (the copied helpers use the same style; each carries its reason).
- Rerun: VERDICT PASS 23/23.

## Round 14 (sonnet) fixes
- One table (STEP_CHECKS) gives each step's check count: EXPECTED_CHECKS is its sum, and the end line names a step that
  never ran and a step whose own count is off (shown: step 8 set to 2 reads "counts off: step 8 1/2").
- Step 4 requires the sign-up's match code, and 4b matches only a real one (undefined would match a codeless row).
- Kept (NITs): the preflight's dependence on the refusal's words (it prints the binary's output when it does not
  match); the fedproof names and copied helpers (#6287); round numbers in comments.
- Rerun: VERDICT PASS 23/23; negative control VERDICT FAIL 12/19.

## Round 15 (opus) fixes
- The end check passes only when the total, every step's own count and the never-ran list all agree (two offsetting
  miscounts can no longer read PASS); its comment points at STEP_CHECKS, not the derived total.
- relay dev-cert's failure carries its stderr, as the preflight and org-create do.
- The quiet guard says it scans tools/ only, and its slice failure names the startBoard anchor.
- Rerun: VERDICT PASS 23/23; the quiet guard 7/7.

## Round 16 (sonnet) fixes
- The family words are pinned by hash, not one word: step 9 requires the accepted words' hash in the audit row to
  differ from the company's pinned 68fb6404...1151 (the board's preview answer carries no hash, so step 7 keeps its
  text check and says step 9 pins it). Negative control: step 9 red on exactly that hash.
- The orphan sweep's comment states its limit (a board never names the sandbox; boards stop through the started list).
- The step 4b control's detail says when a 403 failed on wording; the join code is redacted from step 6's detail.
- Deduplicated: round numbers in comments, the copied helpers (#6287).
- Rerun: VERDICT PASS 23/23; negative control VERDICT FAIL 12/19.

## Round 17 (opus) fixes
- Step 8 says it is the BOARD's gate: a board that sends the words cannot reach the coordinator's gate behind it,
  which kosmos-relay's api test kosmos6239_a_family_joins_only_from_a_board_that_showed_its_words covers.
- Step 10's label claims only the board's own sentence (the "no company" clause tested a constant).
- The preflight reports a binary that exits 0 for a nonsense kind as that, not as "could not run".
- Decided, not changed: COMPANY_CONSENT_HASH stays a pinned copy of relay's value. Rejected: deriving it in the run
  (a second admin account and a company join, about doubling the harness). Weakest premise: that a change to the
  company words is noticed. Relay's own pinned test changes then, and the constant's comment says to change it with
  it and how to see a stale one (the --kind company control).
- Rerun: VERDICT PASS 23/23.

## Round 18 (sonnet) fixes
- The preflight tells a killed or timed-out binary from one that exited 0 (round 17's message called a timeout
  "exited 0"): shown, a hang reads "(killed by SIGKILL, after 30 s)".
- The end line names the first red when steps are missing or miscounted, so a cascade reads as one (negative control:
  "never ran: step 10, step 11; first red: step 7 ..."); one stepOf helper parses labels.
- Step 8's comment states the coupling with step 9 (shared ticket and code) and where to look first.
- Recorded, not proven: a child that forks and keeps the stdio pipes open could hold execFileSync past its timeout
  (the hang stand-in was a single process).
- Deduplicated: STEP_CHECKS by hand (round 14), the copied helpers (#6287), the pinned company hash (round 17), round
  numbers in comments, the quiet guard's discovery by text.
- Rerun: VERDICT PASS 23/23.

## Round 19 (opus): converged (zero BLOCKERs, WARNINGs or CONVENTIONs; NITs only)
- Kept (NITs): the match code printed in steps 4 and 4b (a pairing hint, unlike the join code, which can join an org);
  the exit-0 preflight branch keeps a fixed sentence; raw wait and port literals (each with its reason at the site);
  the plan's file name.
