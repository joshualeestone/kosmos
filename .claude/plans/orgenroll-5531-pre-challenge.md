---
pre_challenge: true
method: challenge-loop
branch: orgenroll-5531
diff_hash: 0f6f7415b658f55a167f29026328fdcff143c867032dce5ff8e959f36794275a
validation: passed (Mortals full suite at d16e1d479, hash 0f6f7415b658; full browser checks at c05134e89, the same diff)
subdir_audit: passed
timestamp: 2026-10-08T13:33:31Z
iterations: 40
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 40, each a fresh blind reviewer, alternating Opus (odd) and Sonnet (even).
**Converged:** Yes, at iteration 40 (Sonnet): no new BLOCKER, WARNING or CONVENTION (its one CONVENTION asked for a stale 'seven' that a grep with a control showed is not there). The loop converged first at 16 and again at 24; the full validations then found real reds whose fixes reopened it, and iterations 25 to 39 found real gaps in the uncertain-join, undo and leave paths, most on lines this loop's own fixes wrote (SELF). Iteration 37 found a BLOCKER (a lost answer could record the wrong company), reproduced and fixed.
**Total findings (ledger lines):** iterations 1 to 16: 0 BLOCKERs, 46 WARNINGs, 6 CONVENTIONs. Iterations 17 to 40: 1 BLOCKER (B37, fixed) and the WARNINGs W17 to W39 (each fixed, except W20 deferred with a reason), duplicates and declined items as marked, 1 CONVENTION fixed (C39). Full ledger below.
**Self-generated:** 10 findings were on lines an earlier fix of this loop wrote (marked SELF below).
**Validation:** engine and server suites, render-orgenroll-5531.js O1 to O12, both browser-check gates, the machine and logstamp pins; full suite on Mortals and FULL browser checks at the head named above.

Deferred with reasons, not fixed:
- (7) person-only rests on isViaScreen, the board's check for every person-only setting (refuses an agent token, trusts browser headers). Cross-site pages are refused by crossSiteWrite before every route (pinned by a server test).
- (16) the block hides while the computer is not connected: measured, an unconnected computer cannot sign, so nothing is sent.
- (33) preview is not serialized with enroll/leave/refresh: it only reads.
- (30) a FULL copy of the data folder carries the Kosmos+ key, so the company cannot tell it from the real computer; stated plainly in code and plan. The hardware fingerprint that fixes it is agreed with the coordinator owner for E0.3 (#5532, contract v1.5).
- (26, board side done) the consent hash is kept locally; sending it waits on contract v1.4 deploying with E0.8.

## Ledger (verbatim, iteration by iteration)

#### Iteration 1 (Opus) on 71f28d1ed
- [WARNING] (1) leave() cleared the record before the request and nothing reconciled it (last admin silently un-enrolled; offline left a stale coordinator enrollment). FIXED 2d7b0a5b1 (restore on org_last_admin; pending leave retried; mutation reddens).
- [WARNING] (2) company name and consent lines unbounded and unscrubbed (bidi overrides, zero-width). FIXED 2d7b0a5b1 (externalname, length and count caps).
- [WARNING] (3) codeOf took the first org_* token (org_id would win). FIXED 2d7b0a5b1 (public codes only; mutation reddens).
- [CONVENTION] (4) plan stale (v1.2, OPEN line, O1 to O6). FIXED 2d7b0a5b1.
- [NIT] throttle on failed reads (FIXED); terminal enroll code leaves a dead consent (FIXED); move-path role wording (DEFERRED: cosmetic, the move line names no role); README row lacks O7 (FIXED).
#### Iteration 2 (Sonnet) on 2d7b0a5b1
- [WARNING] (5) enroll never cleared a pending leave: the next pass un-enrolled a re-joined person. SELF (iter-1 fix). FIXED (mutation reddens).
- [WARNING] (6) no sequencing between enroll, leave and refresh. FIXED (one at a time; test rewritten to the harmful order after the first version did not pin it).
- [WARNING] (7) person-only rests on isViaScreen. DEFERRED (house check for every person-only setting; noted in the plan).
- [NIT] doubled leave wording (harmless); org_already_member not in the reset list (the engine retries it). DEFERRED.
#### Iteration 3 (Opus) on 9d8a874e2
- [WARNING] (8) a pending leave retried and refused as last admin cannot restore (record already cleared): enrollment lost locally for good. TO FIX: keep the pre-leave record inside the pending file; restore from it. FIXED 08f2cd813 (mutation reddens).
- [WARNING] (9) the pending-leave sentence never shows (raw `because` wins). TO FIX: pending uses the friendly sentence. FIXED 08f2cd813 (pinned).
- [WARNING] (10) the member move needs no secret; with isViaScreen's weakness a local process could move the work enrollment onto a personal world. TO FIX: a short-lived ticket issued by /api/org/preview to the screen, required by /api/org/enroll (route-level). FIXED 08f2cd813 (server test; mutation reddens).
- [WARNING] (11) isEnrolledHere can be a day stale (removed, moved, disconnected). TO DOCUMENT in the plan for E0.3/E0.6: necessary, not sufficient; the coordinator must refuse reports from a world it no longer names. DOCUMENTED in the plan (08f2cd813).
- [NIT] enroll response carries world (strip in server); worldId mints on a GET (read-only variant for the gate); temp name per pid (random suffix); Not now / Check code clickable while busy (disable). ALL FIXED 08f2cd813.
#### Iteration 4 (Sonnet) on 08f2cd813
- [WARNING] (12) an unknown failure showed the raw tunnel line (spawn error carries the connector path, so the home folder). FIXED 975f753ae (fixed sentence; raw to log; mutation reddens).
- [WARNING] (13) the fallback text was not cleaned or bounded. FIXED 975f753ae (same fix: the page never sees it; the log line is externalName-cleaned to LINE_MAX).
- [NIT] GET /api/org readable by agents (DECIDED: intentional, commented); org id sent to the page (FIXED: name and slug only).
#### Iteration 5 (Opus) on 975f753ae
- [WARNING] (14) the ticket was not bound to what was previewed (code A's ticket joined with code B). SELF (iter-3 fix). FIXED (ticket carries the code; mutation reddens).
- [WARNING] (15) no test showed a real ticket accepted; a refuse-everything check passed. FIXED (accepting arm via stubbed remote; single use; mutation reddens).
- [NIT] org id still in preview/enroll answers (FIXED, mutation reddens); refresh because not via sayFor (FIXED); pending leave retried forever (DECIDED: correct, documented).
#### Iteration 6 (Sonnet) on 9ed7b99eb
- [WARNING] (16) block (and Leave) hidden while the remote is not connected, "still reporting". DEFERRED: measured, a computer not connected cannot sign (remote.js macRequest refuses), so nothing reports while hidden.
- [WARNING] dup of (11): stale record after removal while offline. Coordinator now refuses server-side (org_not_enrolled, #5532 contract).
- [WARNING] (17) agents read role and enrolledAt from GET /api/org. FIXED (name and slug only for an agent token; mutation reddens).
- [WARNING] dup of (7): isViaScreen as the only person check.
- [NIT] temp file left on a failed rename; enrollment temp name not unique (FIXED); pending file holds ids (comment added).
- [CONVENTION] raw line to the log (DECIDED: local log only; documented).
#### Iteration 7 (Opus) on f9d376dee
- [WARNING] (18) the ticket was spent before a passing enroll failure; every later Join refused with no way back. SELF (iter-3/5 ticket). FIXED 7abea35e3 (ticket kept on a no-code failure; refusal carries org_ticket; page returns to the code field; mutations redden).
- [WARNING] (19) one odd status answer ended the enrollment for good, silently. FIXED 7abea35e3 (stop only on a clear answer; stoppedFor shown, O8; mutations redden).
- [NIT] GET split on presentedAgentToken not isViaScreen (FIXED); leave not gated to the work Kosmos (FIXED, mutation reddens); world id reused after a confirmed leave (FIXED, mutation reddens).
- [CONVENTION] check/README said { code, accepted: true } (FIXED).
#### Iteration 8 (Sonnet) on 7abea35e3
- [WARNING] (20) the world id was retired on a leave but not when refresh stops. SELF (iter-7 claim). FIXED (retired on every end; mutation reddens).
- [WARNING] (21) a stopped world could send leave and end a membership that now belongs to another world. SELF (iter-7 gate). FIXED (local clear only, nothing sent; mutation reddens).
- [WARNING] dup of (7): isViaScreen.
- [WARNING] (22) a raw failure line could carry the join code into the log. FIXED (redacted; test echoes the body; mutation reddens).
- [NIT] Not now wording vs the hint (FIXED); agents read company name (dup, decided).
#### Iteration 9 (Opus) on d5f15f9a2
- [WARNING] (23) the stopped note came back on every visit with no way to clear it. SELF (iter-7). FIXED (shown once, then cleared; mutation reddens).
- [WARNING] (24) org_bad_world ("Try again") spent the ticket; org_not_accepted left a dead consent. SELF (iter-7 restore rule). FIXED (mutation reddens).
- [CONVENTION] leave comment stale after iter 8 (FIXED); retire-id wording overclaimed unlinkability (CORRECTED in code comment and plan).
- [NIT] unreadable local id read as a clear answer (FIXED, mutation reddens); redaction case-sensitive (FIXED, mutation reddens); one ticket per process (DECIDED); body over 4096 misdescribed (FIXED); plan name lacks timestamp (DECIDED: the hook needs <branch>.md).
#### Iteration 10 (Sonnet) on 88c055dcc
- [WARNING] (25) leave from a copied data folder ends the real membership (account-level leave, local gate passes on the copy). FIXED (status first; mutation reddens).
- [WARNING] (26) acceptance not tied to the consent words shown. FIXED board side (consentHash kept; 3 mutations redden); coordinator field asked of Pete (v1.4).
- [WARNING] dups: copied-folder gate (11), agents read company (decided), isViaScreen (7), raw log line (local, measured).
- [NIT] "stay in the engine" wording (FIXED); "never: other Kosmoses" wording (no change: other worlds send nothing, so the company cannot see them); one ticket per process (dup, decided).
#### Iteration 11 (Opus) on 3d1202cc7
- [WARNING] (27) a local-only leave said "You left" while the membership went on. SELF (iter-10). FIXED (O9; mutation reddens).
- [WARNING] (28) leave's notHere kept the world id that refresh retires for the same answer; two derivations drifted. SELF (iter-10). FIXED (statusVerdict shared; retire; mutation reddens).
- [NIT] ticket restore could overwrite a newer screen's ticket (FIXED, race test, mutation reddens); ORG_TICKET comment shape (FIXED).
- [CONVENTION] raw time literals (FIXED: ORG_TICKET_MS, ORG_REFRESH_MS); CLAUDE.md Where to Find Things row (FIXED).
#### Iteration 12 (Sonnet) on a0a6341d8
- [WARNING] (29) a join the company accepted but this Kosmos could not record left a silent enrollment. FIXED (undone at once or pending; mutation reddens).
- [WARNING] dup (agents read company; decided in 4 and 6): now CLOSED, agents get enrolled only (mutation reddens).
- [WARNING] dup of (7) isViaScreen: comment softened to what it enforces.
- [WARNING] dup of (22) log: also redacts long hex ids now (mutation reddens).
- [NIT] re-join linkable wording (covered by the retire comment); enroll answer spread (FIXED: allow-list, mutation reddens).
#### Iteration 13 (Opus) on 08a1d9494
- [WARNING] (30) a full copy of the data folder carries the Kosmos+ key, so thisComputer cannot tell it apart; comments overclaimed. CORRECTED (comments + plan; asked Pete what thisComputer keys on).
- [WARNING] (31) the write-failure undo ended a MOVE's membership and always said "undone". SELF (iter-12). FIXED (move not undone; honest per-case words; 2 mutations redden).
- [WARNING] (32) "Checking a code sends only the code" overstated (signed by the Kosmos+ identity). FIXED (hint, Not now, O3).
- [WARNING] (33) preview not serialized. DEFERRED (read-only).
- [NIT] HEAD used up the stopped note (FIXED, mutation reddens); test name contradicted body (FIXED); log scrub missed emails (FIXED).
- [CONVENTION] header named only the opaque id (FIXED).
#### Iteration 14 (Sonnet) on d83c564b4
- [WARNING] (34) an empty "never" list hid the exclusions before Join. FIXED (fixed local line; O10; mutation reddens).
- [WARNING] dup of (26): consent hash not sent (known gap until v1.4 deploys).
- [WARNING] (35) cross-site page could POST leave. NOT A DEFECT: measured crossSiteWrite refuses before every route; pinned by a server test (guard disabled -> red).
- [WARNING] (36) a record with its id file gone asked the company forever. FIXED (stale: cleared, nothing sent; unreadable stays unclear; mutation reddens).
- [NIT] log keeps org text (local only, bounded; dup of 22); agents learn the boolean (noted in plan).
#### Iteration 15 (Opus) on 2333e457d
- CONVERGED: no new BLOCKER, WARNING or CONVENTION.
- [NIT] stopped note used up unseen behind another line (FIXED, O8, mutation reddens); org_already_member at Join moved on first-join words (FIXED, mutation reddens); doubled never line in the shot fixture (FIXED; Pete asked); log keeps company text (not taken: local, decided).
#### Iteration 16 (Sonnet) on 3357a6c64
- CONVERGED: no new BLOCKER, WARNING or CONVENTION after dedup.
- [WARNING] dup of (22): a dashed UUID in a raw line reaches the local log (local only; not taken).
- [WARNING] dup (review 14 note): agents learn the enrolled yes/no.
- [WARNING] dup of (7): isViaScreen; suggests a card for a screen-only mechanism (#4491) before backups ride on enrollment.
- [NIT] hint does not name the Kosmos+ computer identity (the account is named); plain !== on the ticket (loopback, not exploitable).
#### Iteration 17 (Opus) on c678010ed
- [WARNING] (W17) unrecorded join + failed undo + last-admin refusal forgot the enrollment. FIXED (rebuild from status; keep pending if unwritable; both arms pinned).
- [NIT] blue check weakened to painted-white: FIXED (:not(#plus-org-code)). [NIT] lowercase fragments on the page: FIXED. [NIT] retire title overstated: FIXED. [NIT] here() mints an id (DECLINED: here() is called only after a join wrote one). [NIT] ticket-restore comment vs generation (DECLINED: bound to its code and 10 min; comment kept).
#### Iteration 18 (Sonnet) on 2d98d868b
- [WARNING] (W18) local-only leave kept the id; a later pass re-adopted with no consent. FIXED (retire id; test with surviving id; mutation reddens; first test version was blind, rewritten).
- [NIT] stopped note cleared before delivery (DECLINED, documented once); org id in local log (DECLINED, local); page trusts own state a minute (fine). [CONVENTION] plan file name without timestamp (DECLINED: hook matches; repo plans use the branch name).
#### Iteration 19 (Opus) on dc1f67567
- [WARNING] (W19a) answer-less enroll said nothing joined. FIXED (status once; recorded/nothing/unknown; pinned).
- [WARNING] (W19b) unconfirmed first join not undone. FIXED (undoFirstJoin; move exempt; pinned).
- [WARNING] (W19c) page Leave dropped the joined view on any refusal. FIXED (ok/pending only; O11 both arms; pinned).
- [NIT] review-18 test is engine-level (true; route refuses that state, a race reaches it); unreadable id deleted on local-only leave (reachable only by that race); codeOf order (no real line carries both); org_other_org with pending leave (DECLINED, rare); branch base behind main (FULL bc re-runs at the head).
#### Iteration 20 (Sonnet) on 61c6f21ef
- [WARNING] refresh re-adopts with no local record: DUP of W18 decision (kept, consentHash-less record keeps rollup dormant).
- [WARNING] (W20) one board-wide consent ticket. DEFERRED, decided (fails closed with a clear sentence; plan records it).
- [NIT] direct writes for pending/stopped (harmless; existence is what counts); queue comment; plan name; stopped-note race (rare, one notice).
#### Iteration 21 (Opus) on 59cba53cf
- [WARNING] (W21a) a pending undo of an unconfirmed first join was never sent. FIXED (undo flag; pinned).
- [WARNING] (W21b) a refused pending leave silently resumed reporting. FIXED (one-time note engine/server/page; 4 mutations red).
- [NIT] undone keeps ticket: message says code used up (FIXED). [NIT] local-only branch reachable by a race only (noted in plan r19). [NIT] move wording FIXED.
#### Iteration 22 (Sonnet) on 6c0ca07d1
- [WARNING] (W22) missing-id clear stopped silently. FIXED (stopped note; pinned).
- [WARNING] refresh re-adopt: DUP (W18/W20 decision). [NIT] one ticket: DUP (W20). [NIT] preview pauses status reads (harmless); codeOf regex per call (negligible).
#### Iteration 23 (Opus) on 9c01f9d96
- [WARNING] (W23a) pending undo could end a membership moved to another Kosmos. SELF (r21). FIXED (namesThisWorld; pinned).
- [WARNING] (W23b) undo refused as last admin rebuilt a record for a world not here. SELF (r17/r21). FIXED (rebuild only on here; pinned).
- [WARNING] (W23c) timed-out first join bound elsewhere said nothing joined. SELF (r19). FIXED (undoFirstJoin; pinned).
- [NIT] undone keeps ticket: FIXED (org_code_used; pinned). [NIT] retried local-only leave leaves no note: DECLINED (nit; noted in plan).
#### Iteration 24 (Sonnet) on eea78467d
- [WARNING] one board-wide ticket: DUP (W20, deferred; plan records it). [WARNING] note cleared on read: DUP (r18 NIT, declined: said once by design).
- [NIT] plan top sections stale: FIXED. [NIT] enroll comment orphaned: FIXED. [NIT] refresh sayFor without secret (no code there); page shows nothing on a failed read (kept).
- ZERO NEW B/W/C -> CONVERGED at iteration 24.
#### Full validation at 382daa91e (after convergence)
- Mortals: tools/test-connector-verbs.sh red (a new mac-request caller). FIXED (re-decided; 27/27).
- FULL bc: render-fields red on #plus-org-code (the wizard's off-ground artifact). FIXED (skipped by name; covered by blue-1615 and signin-3478).
#### Iteration 25 (Opus) on e165f67d1
- [WARNING] (W25a) unknown join kept nothing to follow up. SELF (r19). FIXED (join-unknown marker settled on the next pass; pinned).
- [WARNING] (W25b) ticket restored after an outcome that may have spent the code. FIXED (codes org_join_unknown / org_undo_pending; O14).
- [NIT] page joined-key on org; world id left after a refused join; daily log line (kept). [CONVENTION] plan name: DUP (decided r9).
#### Iteration 26 (Sonnet) on 8ddf08e35
- [WARNING] (W26) 'this screen will show what it learns' vs a daily follow-up. FIXED (2-minute check while the marker exists; sentence says a few minutes; pinned).
- [NIT] undo refused as last admin after an unknown join, no note (kept, narrow); direct marker writes (kept); inline requires (kept).
#### Iteration 27 (Opus) on 32ddda335
- [WARNING] (W27a) a refusal before sending treated as unknown. FIXED (notSent from remote.js and signed; pinned).
- [WARNING] (W27b) a status read straight after a timeout closed the question. SELF (r19/25). FIXED (every unconfirmed timeout is unknown; pinned).
- [WARNING] (W27c) leave-refused note for an undo. SELF (r21). FIXED (!undo; pinned).
- [WARNING] (W27d) 'a re-adopted record never reports' enforced nowhere. FIXED (mayReport; pinned).
- [NIT] marker beside a record (FIXED); lowercase data-folder sentence (FIXED); settled-not-bound shows nothing (kept); source pin on start() (kept, codebase pattern).
#### Iteration 28 (Sonnet) on d35f931c5
- [WARNING] (W28a) consentHash carried onto another world's record. FIXED (same world only; pinned).
- [WARNING] (W28b) 'no world enrolled' undone though another computer's join may be landing. SELF (r23). FIXED (this world's id only; pinned).
- [NIT] re-adopted shows as joined (kept for E0.3); no Leave while unknown (consistent); stopped note once (by design).
#### Iteration 29 (Opus) on 1856baba4
- [WARNING] (W29a) the follow-up could settle seconds after the timeout. SELF (r26/27). FIXED (SETTLE_AFTER_MS age gate; pinned).
- [WARNING] (W29b) 'this screen will show what it learns' only true for joined. FIXED (sentence promises only that).
- [NIT] busy check before clearing the message (FIXED); marker never expires (FIXED: fast follow-up capped at a day).
#### Iteration 30 (Sonnet) on 8b5a92b3d
- [WARNING] (W30) unreadable marker time never settled, polled forever. SELF (r29). FIXED (counts as old; fast poll skips it; pinned).
- [NIT] stranded comments (FIXED); preview status failure unlogged; failed read waits a minute (kept).
#### Iteration 31 (Opus) on ba6b38c9a
- [WARNING] (W31) an undo refused as last admin rebuilt the record without the accepted consent (stuck Kosmos). SELF (r21-28). FIXED (pending undo keeps the hash; undo-worded one-time note; pinned engine + O12).
- [NIT] stale message on state flip (FIXED); Leave confirmation left open (FIXED); unreachable local-only branch (noted); late join after 2 min (recorded under Not done).
#### Iteration 32 (Sonnet) on 02242f210
- [WARNING] (W32a) restart between clearing the record and writing the pending leave lost the leave. FIXED (marker first; pinned).
- [WARNING] (W32b) a non-string code reached the ticket compare. FIXED (refused first; pinned on message; ticket harm not measured).
- [NIT] poll-after-Join race (self-heals); CODES word boundary (safe direction). [CONVENTION] inline route block (file style, kept).
#### Iteration 33 (Opus) on 94e6bc62d
- [WARNING] (W33a) one unanswered retry dropped the undo's consent hash (REPRODUCED). SELF (r31). FIXED (setLeavePending keeps the existing hash; pinned with the exact sequence).
- [WARNING] (W33b) 'reports to it' shown when mayReport is false. FIXED (GET reporting; note wording; O12c).
- [NIT] undo success retires the id (FIXED); future marker time (FIXED, pinned); connector comment (FIXED).
#### Iteration 34 (Sonnet) on 95f03b3f6
- [WARNING] (W34) 'until you accept its words' promised an unreachable path; joined view silent on not reporting. FIXED (honest wording; joined view line; O12c; the accept-again action recorded as a follow-up).
- [NIT] hash carried forward too widely (FIXED: undo only); settle failure re-arms at (kept, cosmetic); local-only branch leaves a marker (kept, harmless). [CONVENTION] isViaScreen strength (documented).
#### Iteration 35 (Opus) on d75dc0732
- [WARNING] (W35) an older pending leave ended a newer unknown join that had landed (REPRODUCED). SELF (r25). FIXED (settle the newer unknown join first; old leave dropped when it landed; pinned).
- [NIT] torn marker writes (FIXED: writeWhole for all four); mayReport double read (kept); no lasting unknown/pending sign on the page (kept).
#### Iteration 36 (Sonnet) on c45aed84f
- [WARNING] (W36) a join marker outlived its retired world id and kept polling. SELF (r25). FIXED (retireWorldId drops it; pinned).
- [NIT] codeOf on a code-shaped join code (kept); settle-undo overwrites old pending record (kept); join sets state without reporting (fine).
#### Iteration 37 (Opus) on cd6cde228
- [BLOCKER] (B37) a lost answer for company B, seen through a pending leave from A, recorded A on B's consent and dropped the leave (REPRODUCED). SELF (r19-35). FIXED (orgId carried ticket -> enroll -> marker; 'here' only for that company; engine + route pinned).
- [WARNING] (W37) four places still named isEnrolledHere the sender gate. FIXED (mayReport everywhere).
- [NIT] fast follow-up with an older marker; double leave attempt in one pass (kept).
#### Iteration 38 (Sonnet) on bf1160b3f
- [WARNING] (W38) the other-company settle had no age gate. SELF (r37). FIXED (SETTLE_AFTER_MS applies; pinned both ways).
- [NIT] leave route vs local-only branch (kept); comment placement (kept); test-only exports (kept).
#### Iteration 39 (Opus) on 5f33ae276
- [WARNING] (W39) the direct-answer path recorded another company's yes under the accepted consent. FIXED (otherOrg -> no-confirm; pinned with a control).
- [CONVENTION] (C39) plan top section described review 24. FIXED.
- [NIT] move-failure sentences (FIXED); two age computations (FIXED: one); README row stale (FIXED).
#### Iteration 40 (Sonnet) on c05134e89
- [CONVENTION] a stale 'seven' in test-connector-verbs.sh: none found (grep -i seven: 0 lines; control 'the eight': 1). Nothing to fix.
- [NIT] hash carry-forward invariant in two places; missing org.id falls through (safe) (kept, recorded).
- ZERO NEW B/W/C -> CONVERGED at iteration 40.
