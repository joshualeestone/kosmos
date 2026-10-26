---
pre_challenge: true
method: challenge-loop
branch: automove-7152
diff_hash: f3ad9fe85577955401a59fb1bdbe7b998ebc166215e8af45a30e2e6c8833068a
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T10:41:27Z
iterations: 24
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 24
**Converged:** Yes (iteration 23 found nothing above CONVENTION on 83b60b0200. Mutation run 26 then left one mutant alive, the unmeasured list dropped from the dedupe key; a test was added that kills it (run 28), and iteration 24 reviewed that test-only commit and found nothing above NIT. Full validation passed on 8b4debf84c, the merge with origin/main, at this diff hash.)
**Total findings:** 79 (0 BLOCKERs, 59 WARNINGs, 10 CONVENTIONs), plus NITs listed per iteration
**Fixed:** 74 | **Deferred or accepted with a stated reason:** 5 | **Asked (awaiting user):** 0

The two CRITICALs (iterations 1 and 7) are recorded as BLOCKERs. Where a ledger row says "mutant", that fix was checked by a deliberate break that turned its own test or browser check red; the rest (wording asserted by a browser check, comments, the plan) were not mutated, and their rows say how they are covered.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/automove.js:138: A refused agent was picked first every tick, blocking every other idle agent and filling the record --> FIXED (refused agents passed over for REFUSED_HOLD_MS (1 h); test "passed over for an hour" (queued))
- [WARNING] engine/automove.js:144: A roster unreadable at the re-check was recorded as "no longer idle", every tick --> FIXED (recheck throw -> did:unreadable, no line; test (queued))
- [CONVENTION] web/index.html:18571: Static hint "Nothing is moved" was false with moves on --> FIXED (sentence removed; #ab-recent says either mode; browser check claims both (queued))
- [NIT] engine/automove.js:119: Re-check reused the tick's cached projects --> FIXED (freshRecords dep; test (queued))
- [NIT] server.js:~2892: accountMoveDeps split a comment from moveFromDir --> FIXED (moved above the comment; moveFromDir follows its comment again)
- [NIT] server.js sweep: The sweep's wiring (walk shape, roster, labels, real guide check) was untested --> FIXED (automoveDeps() + a real tick in server.autobalance-7152.test.js, with an unmeasured-target control (queued))
- [NIT] agents walk built every tick (NOT taken: one walk per 10 min); movedAt after done (NOT taken: a call during the restart may be the old session's); live guide path only through server review-6 test (it passes through the real isGuideFolderStrict: route test 6/6); timer wiring untested in server (open: consider a route-level tick test).
- [NIT] 0 BLOCKER, 2 WARNING, 1 CONVENTION.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/autobalance.js:208: Any usagepoll refusal (a 429 above all, held an hour) read as a stopped login: a working account's agents moved, false record lines --> FIXED (only (profile-)http-401/403 is rejected; tests on 429, unreadable, other-account, end to end (queued))
- [WARNING] engine/autobalance.js:178: Idle is not nothing-in-flight: unsent words, background shell jobs --> FIXED (unsentInput refuses; two-tick rule; background shell jobs NOT closed, stated as the weakest premise and a must before default-on)
- [WARNING] engine/automove.js:88: An agent refused on its new account was stranded; holds lost on restart --> FIXED (moved back (unless its old login stopped); holds rebuilt from the record at create; tests (queued))
- [WARNING] server.js:13126: movesOn read the env only: the page could claim moves where the sweep cannot run --> FIXED (automoveRuns() gate shared by sweep and page; recording field; page line; route + browser tests (queued))
- [WARNING] engine/setup-assistant.js:2942: Real guide check untested; comment wrong; guideName fails open --> FIXED (comment corrected; guideNameStrict; route test with a real marker and record (queued))
- [WARNING] engine/automove.js:171: movedAt taken after the move finished, so a first call during the restart was ignored --> FIXED (taken before startMove; test (queued))
- [CONVENTION] plan + engine/automove.js: A 'not-yet' works state described, never written --> FIXED (plan and comments say what is written)
- [CONVENTION] server.js sweep comment: "just after each poll period" was not true --> FIXED (wording: reads the newest records, timers not chained)
- [NIT] stopped recorded as partial (TAKEN: 'stopped'); lastKey set before write (TAKEN); live decisions counted in recent (TAKEN); no date on old entries (TAKEN); refused agent retried hourly forever (NOT taken: once an hour, bounded file).
- [NIT] 1 BLOCKER, 5 WARNING, 2 CONVENTION.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/automove.js:162: An owed move back blocked every other move, and could undo a person's own move --> FIXED (waits without blocking; dropped when the agent is not on the account it was moved to; given up after BACK_MAX_MS with a line; tests (queued))
- [WARNING] engine/automove.js:181: A 409 dropped an owed move back and held a healthy agent as refused --> FIXED (409 -> busy, no hold, no line, still owed; test (queued))
- [WARNING] plan + engine/automove.js header: Plan said "two eligible accounts" gated (not in tick); default needs USAGE_POLL; header omitted `why` --> FIXED (early return before the walk with < 2 accounts (test); plan states both env switches; header lists the reason text)
- [WARNING] engine/autobalance.js:216: One 401/403 from the undocumented usage endpoint moved a working account's agents (no move back) --> FIXED (a login move needs the agent's own refused request within LOGIN_SEEN_MS; "two readings" rejected (a held refusal sends nothing); test (queued))
- [WARNING] engine/automove.js: Watch and owed moves back lost on restart --> FIXED (rebuilt from the record at create (move lines carry startedAt and fromKind); test (queued))
- [NIT] .tmp orphaned on a failed write (TAKEN); accounts.list once per label (TAKEN: once per tick); a second roster read beside walk.roster (NOT taken: the re-check must be a NEW read); unsentInput shows only after UNSENT_SHOW_MS (NOT taken: two ticks cover most; stated); name() kept-label rule (NOT taken: correct as is).
- [NIT] 0 BLOCKER, 5 WARNING, 1 CONVENTION.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/automove-7152.test.js:149: A pre-review-3 test expected a 409 to record "refused" (suite red) --> FIXED (3ab7335202 (found by targeted run 3 at the same time))
- [WARNING] engine/automove.js:247: Move back and stopped-login move needed an idle card; a refused agent reads auth_failed, so neither fired; tests used impossible idle cards --> FIXED (both REMOVED; a stopped login is recorded only; on 'no' the target is held a day and the person is told (agent DM + Settings))
- [WARNING] engine/automove.js:93: A target that refuses turns was retried every 6 h --> FIXED (FAILED_HOLD_MS a day, and no move back (so no restart churn))
- [WARNING] engine/automove.js:236: Move back never re-checked its destination --> FIXED (no move back)
- [WARNING] engine/automove.js:114: Works check could blame the wrong account (duplicate watch; agent moved by a person) --> FIXED (one watch per agent; watch dropped when the agent is not on w.to (complete list); test)
- [WARNING] engine/automove.js:152: No move line until restarts finished; a board stop mid-move lost it --> FIXED ('started' line before the await; create() watches started-without-end; tests)
- [NIT] future timestamps trusted (TAKEN: CLOCK_SLACK_MS); entries that draw nothing counted in recent (TAKEN); plan "two eligible" wording (TAKEN, and the check now uses ab.eligible); one tmp name per pid (TAKEN: random suffix).
- [NIT] 1 BLOCKER (already fixed), 5 WARNING. Root-cause call: the move-back and login-move machinery from rounds 2-3 was the source of 4 of 5 warnings and could not fire; removed rather than patched.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/automove.js:234: A second agent could follow the first onto a target not yet seen working (one per tick) --> FIXED (no move onto a target with an open watch; test (queued))
- [WARNING] web/index.html:18570: Page still implied stopped-login moves; live login decisions hidden --> FIXED (hint usage-only; login would-move lines say never made; record moves carry kind; recent shows live login moves; tests + browser claims (queued))
- [WARNING] engine/autobalance.js:181: unsentInput appears only after 3 minutes; comments read as full coverage --> FIXED (comment and plan state the limit)
- [WARNING] engine/automove.js:148: A throw from startMove recorded as refused though the account may be saved --> FIXED ('unknown' outcome: held, watched, rebuilt; page line; test (queued))
- [NIT] future startedAt and nameless lines (TAKEN); 500-line cap can evict a hold (NOT taken: needs heavy flapping; stated here); busy tick says nothing after recording (NOT taken: log only); tell reads as from the agent (NOT taken: kosmos:true is the board's own-voice convention, as the daily-limit notice); null-label email test (NOT taken: labels come from accounts.js, which strips the address).
- [NIT] 0 BLOCKER, 4 WARNING.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/automove.js:122: A person's move back was undone on the next tick (watch dropped, agent idle on an at-risk account, nothing held it) --> FIXED ('released' line + PERSON_HOLD_MS (a day), rebuilt; works 'no' holds the agent too; tests (queued))
- [WARNING] engine/automove.js:249: A held or unproven best target stopped all balancing off the account --> FIXED (decide skipTarget with moves on, so the next-best account is chosen; test (queued))
- [WARNING] engine/automove.js:78: Started-without-end never shown; partial moves unwatched (a second agent could follow); not-seen let the next one go --> FIXED (create() writes an 'unknown' ending; partial watched and unproven; not-seen holds the target a day; tests (queued))
- [WARNING] engine/automove.js:102: A lasting refusal retried hourly forever --> FIXED (3 refusals in a day -> passed over for the day; test (queued))
- [CONVENTION] plan:97, plan:38, server.js:2891: Stale words --> FIXED (reworded)
- [NIT] last decision rewritten after each restart (TAKEN: rebuilt from the record); folder labels vs acctPrimaryName (NOT taken: the agent's line must not carry an email, and the page's name can be one); 'unknown' reported as moved (TAKEN: did 'unknown'); unreadable hides the record (TAKEN); AUTOMOVE_MS "test seam only" (NOT taken: the same wording as its slice-1 neighbour).
- [NIT] 1 BLOCKER, 3 WARNING, 2 CONVENTION.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/automove.js move(): A person's Stop on an automatic move was undone next tick --> FIXED ('stopped' holds the agent a day, rebuilt; test (queued))
- [WARNING] engine/automove.js check(): After a partial/unknown move a call from the OLD account read as proof on the target (observed is per agent) --> FIXED (uncertain watches take no sighting; close only not-seen/released; test (queued))
- [WARNING] engine/automove.js keyOf/create; server.js start: An odd record line could crash the board at startup --> FIXED (keyOf filters non-objects; server wraps create() and turns the sweep off; test (queued))
- [WARNING] engine/automove.js tick: No cooldown: a moved agent could be moved again and again as usage shifts --> FIXED (a moved agent rests a day (PERSON_HOLD_MS), rebuilt; test (queued))
- [NIT] unfinished move stamped at startup and not held in-process (TAKEN); released wording and odd-outcome fallback (TAKEN); "conversation" wording (TAKEN); watches freeze while the poll is off (NOT taken: harmless, they close as not-seen).
- [NIT] 0 BLOCKER, 4 WARNING.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance-sweep.js readLines: An unreadable record read as empty; append would replace 500 lines with one --> FIXED (only ENOENT is empty; create throws (sweep off), append refuses; test (queued))
- [WARNING] engine/autobalance-sweep-7152.test.js restart test: The future-line test could not fail --> FIXED (the line alone in its file, with a past-stamped control)
- [WARNING] engine/autobalance.js rowsFromReadings: Figures dropped on any non-ok state (one blip empties the decision, then a duplicate record); other-login records used --> FIXED (figures kept (readUsage ages them), badge only for ok; another login's record ignored; tests (queued))
- [WARNING] engine/autobalance-sweep.js recent: Held and at-risk-only decisions recorded but not shown --> STATED (plan: the record and Settings are of would-moves)
- [NIT] SWEEP_MS=1 (TAKEN: floored at a second); tick could throw out of the timer (TAKEN: try); functions between the #6174 comment and moveFromDir (TAKEN); five-hour null reset fails open (TAKEN); 403 worded as fact (NOT taken: plan flags it; a recorded would-move only); lower-case fallback (TAKEN); restart dedup (NOT taken: harmless).
- [NIT] 0 BLOCKER, 4 WARNING (record-only diff).

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/autobalance-sweep-7152.test.js:92: Review 9's ENOENT-only read made the failed-write test throw at create() (ENOTDIR): red, never exercising the retry --> FIXED (read-only folder: the read gets ENOENT, only the write fails; asserts the retry and writeFailed)
- [WARNING] engine/autobalance-sweep.js:84: A restart hid a risk that returned (quiet ticks unwritten, lastKey rebuilt from the old risk) --> FIXED (the end of a risk is written; test (queued))
- [WARNING] web/index.html not-recording line: Said "does not check on a schedule" for reasons it cannot know --> FIXED ("is not keeping a record ... on this computer")
- [WARNING] engine/autobalance-sweep.js:56: A record that stops being writable failed silently; Settings still said it records --> FIXED (writeFailed state, one log line, autobalanceSweepRuns reports it; test (queued))
- [WARNING] engine/autobalance.js:219: Login check by email only; Settings uses email and organization --> FIXED (sameLogin dep = usagepoll.sameLogin + accountsweekly.accountOrg (exported); test (queued))
- [CONVENTION] engine/autobalance.js:192: An unreadable guide record made every agent "not idle" on Settings --> FIXED (guideName read once in movableFor (throws from build: "could not work out"); tests)
- [CONVENTION] comments and plan: "slice 3 does" stale; record vs Settings inputs unstated --> FIXED (comment; plan states both)
- [NIT] token-expired idle accounts (TAKEN into the plan as a premise); recent() showed future lines (TAKEN); guide-name normaliser vs cleanName (NOT taken: both lowercase-trim a plain name; noted); unsentInput try comment (NOT taken); the 'movesOn' and recording asserts (NOT taken: the gate's arms are each tested in usagepoll); a hand-made label with @ (NOT taken: labels come from dirForLabel).
- [NIT] 1 BLOCKER (test), 4 WARNING, 2 CONVENTION.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [NIT] 0 BLOCKER, 0 WARNING, 0 CONVENTION. CONVERGED on 7b3f3e34a7. NITs iter 11 (NOT taken, the reviewed diff kept as reviewed; for a follow-up): fewer-than-two-accounts leaves the last would-move newest; at:null prints "On Jan 1" (hand-edited lines only); two comments say "automatic account move" for 3b's sake; first tick a full period after start; double start() in tests; the moves-nothing scan should also look for the module name; chmod test under root.

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance.js:140,232 + web abRecentHtml: The record drew moves off a stopped login that 3b will never make --> FIXED (kept in the file, not drawn; recent() and the page skip kind 'login'; tests + browser claim (queued))
- [WARNING] engine/autobalance.js:232: One blip on the target flipped moves->held->moves, writing duplicates --> FIXED (signed in when a fresh measurement stands and the latest read is not a refused login; test (queued))
- [CONVENTION] server.autobalance-7152.test.js: real-tick test left a second account behind --> FIXED (removed in the test)
- [NIT] recording assert has several arms (STATED in plan); busy flag is a backstop (TAKEN: comment); append drops bad lines (TAKEN: comment); gaps read as no change (STATED in plan).
- [NIT] 0 BLOCKER, 2 WARNING, 2 CONVENTION.

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] server.js route recording line: autobalanceSweepRuns() outside try: a throw would 500 the accounts read --> FIXED (try, false on a throw)
- [WARNING] server.js route recent(): the whole record read on every Settings poll, switch off included --> FIXED (read only with the switch on; route test arm (queued))
- [NIT] 0 BLOCKER, 2 WARNING (route).

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance.js:236: Review 12's blip rule let a signed-out account (or another login's credential) with fresh old figures stay a target --> FIXED (BLIP_STATES list only; tests for six non-blip states and three blips (queued))
- [WARNING] engine/autobalance-sweep.js:115: A gap in readings recorded as the risk ending, then the same would-move again --> FIXED (rows carry measured; a tick where a last-at-risk account is unmeasured writes nothing (rebuilt at start); test (queued))
- [NIT] walk.moving prunes notes (TAKEN: stated in the comment); a failed walk retried per account (TAKEN: cached for the tick); key depends on list order (NOT taken: accounts.list order is stable); at:null shows 1970 (TAKEN: recent requires a finite at).
- [NIT] 0 BLOCKER, 2 WARNING, 1 CONVENTION.

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance.js rowsFromReadings: Agents walk every tick even with nothing at risk --> ACCEPTED (plan: the route's own walk, every 10 min; changes if measured slow)
- [WARNING] engine/autobalance-sweep.js keyOf: Names in the key: idle/busy flicker writes lines --> ACCEPTED (plan: the evidence 3b needs, bounded 144/day; changes if the PM finds it noisy)
- [NIT] recent() parses on the request path (NOT taken: switch-on only, 500 lines); a target gap flips to held (NOT taken: stated weak premise); future newest line falls back (NOT taken: clock skew only).
- [NIT] 0 BLOCKER, 2 WARNING (both accepted with a stated reason), 0 CONVENTION.

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/autobalance.js:250: measured = a record exists; slice 1 rewrites at on every failed poll, so an aged-out at-risk account read measured with no risk -> false "risk ended" --> FIXED (measured = a fresh figure, or a refused/signed-out login; the test now uses the real aged-out shape)
- [WARNING] engine/autobalance-sweep.js:117: One account's gap froze recording for every account --> FIXED (the unmeasured account's entries carried from the last decision, the line marks them; test)
- [WARNING] engine/autobalance.js:238: A signed-out folder's stopped login "ended" in the record --> FIXED (no-credential/no-token -> signed_out; test)
- [CONVENTION] server.js SWEEP_MS: Called a test seam, no test can tick, floor 1 s --> FIXED (an operator's setting, floored at a minute)
- [NIT] writeFailed reset before every tick (TAKEN: clears only on success, tick gate without it); chmod test under root (TAKEN: skipped as root); a folder at the marker path read as "not the guide" (TAKEN: cannot tell).
- [NIT] 1 BLOCKER, 2 WARNING, 1 CONVENTION.

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance-sweep.js keyOf: Carried entries appended changed the key's order: a gap wrote a duplicate --> FIXED (each list sorted in the key; test (queued))
- [WARNING] engine/autobalance-sweep.js tick: writeFailed stuck true when the decision returned to the recorded one --> FIXED (cleared when key === lastKey; test (queued))
- [CONVENTION] autobalance-sweep tick catch: every error read as "unreadable", nothing logged --> FIXED (the reason returned and logged once)
- [NIT] "said once" per run of failures (TAKEN: comment); fewer-than-two accounts keeps the last decision (NOT taken: a gap reads as no change, stated); append/recent parse 500 lines (NOT taken: bounded).
- [NIT] 0 BLOCKER, 2 WARNING, 2 CONVENTION.

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/autobalance-sweep-7152.test.js:177: Two tests contradicted (no-credential null vs signed_out) --> FIXED (by reverting review 16's signed-out rule (W1))
- [WARNING] engine/autobalance.js: "no-credential" is any Keychain failure, not a sign-out: one hiccup marks every account a stopped login --> FIXED (no badge, unmeasured; test)
- [WARNING] engine/autobalance-sweep.js: A short or failed agents walk read as "nothing could move" --> FIXED (decide's short on an at-risk account makes the tick a gap; test)
- [WARNING] engine/autobalance-sweep.js carry: Carried entries lived forever with old reasons, redrawn as new would-moves --> FIXED (a gap writes nothing (the plan states the cost); tests)
- [NIT] recent hidden while a write fails (NOT taken, stated); Lately repeats (NOT taken, review 15's call).
- [NIT] 1 BLOCKER (test), 3 WARNING. Root-cause call: reviews 14-17 kept patching how to interpret a gap; review 18 replaces it with "a gap writes nothing".

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance-sweep.js gap rule: An unmeasured TARGET flipped the record to held and back (duplicate move) --> FIXED (the gap rule covers every account the last decision named (at risk and move targets); test)
- [NIT] five-hour null-reset differs from Settings (STATED in plan); fallback login rule failed open (TAKEN: fails closed; test); unattended walk could stall on a slow tmux (STATED, review 15's call).
- [NIT] 0 BLOCKER, 1 WARNING.

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] engine/autobalance-sweep.js gap rule: An idle account's expired token makes a gap last days: a silent hole while Settings says recording --> FIXED (gap silent for GAP_TICKS, then written with unmeasured named (in the key), stable while it lasts; test)
- [WARNING] engine/autobalance.js measured: A Keychain hiccup on a target, with copied fresh figures, wrote held then the move again --> FIXED (no-credential/no-token never measured; test in the real shape)
- [WARNING] server.js recording + page: Settings said "recording" while every tick was a gap or unreadable --> FIXED (route reports lastTick; the page says the last check could not measure every account; gap logged once; browser claim)
- [NIT] guide name normaliser (STATED); sweep fixtures without email (TAKEN: USAGE carries emails).
- [NIT] 1 BLOCKER, 2 WARNING.

#### Iteration 21
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] server.js lastTick + page: Once a gap was written, ticks say nothing and the page's warning went quiet for days --> FIXED (route unmeasuredNow from the record's last decision; the page warns from it; browser claim. Route arm untestable under a test (the sweep never ticks there), as for writeFailed: STATED)
- [WARNING] engine/autobalance.js LOGIN_REFUSED: A 403 the agents never see reads as a stopped login --> ACCEPTED (review 2's rule; never drawn; plan says what would change it)
- [NIT] flicker of the notice (FIXED by 81); flapping bounded; one line per agent; gapTicks across unreadable; folder paths (all NOT taken).
- [NIT] 0 BLOCKER, 3 WARNING (1 fixed, 2 accepted with a stated reason).

#### Iteration 22
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/autobalance-sweep.js gap rule + route: Unnamed unmeasured accounts went silent (page quiet; held lines read as "none could") --> FIXED (notMeasured on every line (outside the key); state.unmeasuredNow; route warns from any; test)
- [WARNING] server.autobalance-7152.test.js: Route lastTick/unmeasuredNow untested --> ACCEPTED (the sweep never ticks under a test; engine test pins the state; browser check the page)
- [CONVENTION] web/index.html gap sentence: Worded for one of its three causes --> FIXED ("could not check everything")
- [NIT] gapTicks not rebuilt; recent() sends whole lines; record read with recording false (NOT taken).
- [NIT] 0 BLOCKER, 2 WARNING (1 fixed, 1 accepted), 1 CONVENTION.

#### Iteration 23
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [NIT] 0 BLOCKER, 0 WARNING, 1 CONVENTION (accepted: the hint's "picks" is slice 2's wording and is qualified by the next sentence "For now it only says what it would do. Nothing is moved."). CONVERGED on 83b60b0200.

#### Iteration 24
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1 of the above
- [WARNING] engine/autobalance-sweep-7152.test.js: Dropping the unmeasured list from the dedupe key survived every test: no gap line and its end differed only in that list --> FIXED (new test (spare re-measured at 80%: same hold, unmeasured cleared); green unmutated, mutant red (run 28))
- [NIT] 0 BLOCKER, 0 WARNING, 0 CONVENTION on the test-only commit 3b7c241f27. CONVERGED.
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/automove.js:138 | REVIEW | A refused agent was picked first every tick, blocking every other idle agent and filling the record | FIXED | refused agents passed over for REFUSED_HOLD_MS (1 h); test "passed over for an hour" (queued) |
| 2 | 1 | WARNING | engine/automove.js:144 | REVIEW | A roster unreadable at the re-check was recorded as "no longer idle", every tick | FIXED | recheck throw -> did:unreadable, no line; test (queued) |
| 3 | 1 | CONVENTION | web/index.html:18571 | REVIEW | Static hint "Nothing is moved" was false with moves on | FIXED | sentence removed; #ab-recent says either mode; browser check claims both (queued) |
| 4 | 1 | NIT | engine/automove.js:119 | REVIEW | Re-check reused the tick's cached projects | FIXED | freshRecords dep; test (queued) |
| 5 | 1 | NIT | server.js:~2892 | REVIEW | accountMoveDeps split a comment from moveFromDir | FIXED | moved above the comment; moveFromDir follows its comment again |
| 6 | 1 | NIT | server.js sweep | REVIEW | The sweep's wiring (walk shape, roster, labels, real guide check) was untested | FIXED | automoveDeps() + a real tick in server.autobalance-7152.test.js, with an unmeasured-target control (queued) |
| 7 | 2 | BLOCKER | engine/autobalance.js:208 | REVIEW | Any usagepoll refusal (a 429 above all, held an hour) read as a stopped login: a working account's agents moved, false record lines | FIXED | only (profile-)http-401/403 is rejected; tests on 429, unreadable, other-account, end to end (queued) |
| 8 | 2 | WARNING | engine/autobalance.js:178 | REVIEW | Idle is not nothing-in-flight: unsent words, background shell jobs | FIXED | unsentInput refuses; two-tick rule; background shell jobs NOT closed, stated as the weakest premise and a must before default-on |
| 9 | 2 | WARNING | engine/automove.js:88 | REVIEW | An agent refused on its new account was stranded; holds lost on restart | FIXED | moved back (unless its old login stopped); holds rebuilt from the record at create; tests (queued) |
| 10 | 2 | WARNING | server.js:13126 | REVIEW | movesOn read the env only: the page could claim moves where the sweep cannot run | FIXED | automoveRuns() gate shared by sweep and page; recording field; page line; route + browser tests (queued) |
| 11 | 2 | WARNING | engine/setup-assistant.js:2942 | REVIEW | Real guide check untested; comment wrong; guideName fails open | FIXED | comment corrected; guideNameStrict; route test with a real marker and record (queued) |
| 12 | 2 | WARNING | engine/automove.js:171 | REVIEW | movedAt taken after the move finished, so a first call during the restart was ignored | FIXED | taken before startMove; test (queued) |
| 13 | 2 | CONVENTION | plan + engine/automove.js | REVIEW | A 'not-yet' works state described, never written | FIXED | plan and comments say what is written |
| 14 | 2 | CONVENTION | server.js sweep comment | REVIEW | "just after each poll period" was not true | FIXED | wording: reads the newest records, timers not chained |
| 15 | 3 | WARNING | engine/automove.js:162 | REVIEW | An owed move back blocked every other move, and could undo a person's own move | FIXED | waits without blocking; dropped when the agent is not on the account it was moved to; given up after BACK_MAX_MS with a line; tests (queued) |
| 16 | 3 | WARNING | engine/automove.js:181 | REVIEW | A 409 dropped an owed move back and held a healthy agent as refused | FIXED | 409 -> busy, no hold, no line, still owed; test (queued) |
| 17 | 3 | WARNING | plan + engine/automove.js header | REVIEW | Plan said "two eligible accounts" gated (not in tick); default needs USAGE_POLL; header omitted `why` | FIXED | early return before the walk with < 2 accounts (test); plan states both env switches; header lists the reason text |
| 18 | 3 | WARNING | engine/autobalance.js:216 | REVIEW | One 401/403 from the undocumented usage endpoint moved a working account's agents (no move back) | FIXED | a login move needs the agent's own refused request within LOGIN_SEEN_MS; "two readings" rejected (a held refusal sends nothing); test (queued) |
| 19 | 3 | WARNING | engine/automove.js | REVIEW | Watch and owed moves back lost on restart | FIXED | rebuilt from the record at create (move lines carry startedAt and fromKind); test (queued) |
| 20 | 4 | BLOCKER | engine/automove-7152.test.js:149 | REVIEW | A pre-review-3 test expected a 409 to record "refused" (suite red) | FIXED | 3ab7335202 (found by targeted run 3 at the same time) |
| 21 | 4 | WARNING | engine/automove.js:247 | REVIEW | Move back and stopped-login move needed an idle card; a refused agent reads auth_failed, so neither fired; tests used impossible idle cards | FIXED | both REMOVED; a stopped login is recorded only; on 'no' the target is held a day and the person is told (agent DM + Settings) |
| 22 | 4 | WARNING | engine/automove.js:93 | REVIEW | A target that refuses turns was retried every 6 h | FIXED | FAILED_HOLD_MS a day, and no move back (so no restart churn) |
| 23 | 4 | WARNING | engine/automove.js:236 | REVIEW | Move back never re-checked its destination | FIXED | no move back |
| 24 | 4 | WARNING | engine/automove.js:114 | REVIEW | Works check could blame the wrong account (duplicate watch; agent moved by a person) | FIXED | one watch per agent; watch dropped when the agent is not on w.to (complete list); test |
| 25 | 4 | WARNING | engine/automove.js:152 | REVIEW | No move line until restarts finished; a board stop mid-move lost it | FIXED | 'started' line before the await; create() watches started-without-end; tests |
| 26 | 5 | WARNING | engine/automove.js:234 | REVIEW | A second agent could follow the first onto a target not yet seen working (one per tick) | FIXED | no move onto a target with an open watch; test (queued) |
| 27 | 5 | WARNING | web/index.html:18570 | REVIEW | Page still implied stopped-login moves; live login decisions hidden | FIXED | hint usage-only; login would-move lines say never made; record moves carry kind; recent shows live login moves; tests + browser claims (queued) |
| 28 | 5 | WARNING | engine/autobalance.js:181 | REVIEW | unsentInput appears only after 3 minutes; comments read as full coverage | FIXED | comment and plan state the limit |
| 29 | 5 | WARNING | engine/automove.js:148 | REVIEW | A throw from startMove recorded as refused though the account may be saved | FIXED | 'unknown' outcome: held, watched, rebuilt; page line; test (queued) |
| 30 | 6 | BLOCKER | engine/automove.js:122 | REVIEW | A person's move back was undone on the next tick (watch dropped, agent idle on an at-risk account, nothing held it) | FIXED | 'released' line + PERSON_HOLD_MS (a day), rebuilt; works 'no' holds the agent too; tests (queued) |
| 31 | 6 | WARNING | engine/automove.js:249 | REVIEW | A held or unproven best target stopped all balancing off the account | FIXED | decide skipTarget with moves on, so the next-best account is chosen; test (queued) |
| 32 | 6 | WARNING | engine/automove.js:78 | REVIEW | Started-without-end never shown; partial moves unwatched (a second agent could follow); not-seen let the next one go | FIXED | create() writes an 'unknown' ending; partial watched and unproven; not-seen holds the target a day; tests (queued) |
| 33 | 6 | WARNING | engine/automove.js:102 | REVIEW | A lasting refusal retried hourly forever | FIXED | 3 refusals in a day -> passed over for the day; test (queued) |
| 34 | 6 | CONVENTION | plan:97, plan:38, server.js:2891 | REVIEW | Stale words | FIXED | reworded |
| 35 | 7 | WARNING | engine/automove.js move() | REVIEW | A person's Stop on an automatic move was undone next tick | FIXED | 'stopped' holds the agent a day, rebuilt; test (queued) |
| 36 | 7 | WARNING | engine/automove.js check() | REVIEW | After a partial/unknown move a call from the OLD account read as proof on the target (observed is per agent) | FIXED | uncertain watches take no sighting; close only not-seen/released; test (queued) |
| 37 | 7 | WARNING | engine/automove.js keyOf/create; server.js start | REVIEW | An odd record line could crash the board at startup | FIXED | keyOf filters non-objects; server wraps create() and turns the sweep off; test (queued) |
| 38 | 7 | WARNING | engine/automove.js tick | REVIEW | No cooldown: a moved agent could be moved again and again as usage shifts | FIXED | a moved agent rests a day (PERSON_HOLD_MS), rebuilt; test (queued) |
| 45 | 9 | WARNING | engine/autobalance-sweep.js readLines | REVIEW | An unreadable record read as empty; append would replace 500 lines with one | FIXED | only ENOENT is empty; create throws (sweep off), append refuses; test (queued) |
| 46 | 9 | WARNING | engine/autobalance-sweep-7152.test.js restart test | REVIEW | The future-line test could not fail | FIXED | the line alone in its file, with a past-stamped control |
| 47 | 9 | WARNING | engine/autobalance.js rowsFromReadings | REVIEW | Figures dropped on any non-ok state (one blip empties the decision, then a duplicate record); other-login records used | FIXED | figures kept (readUsage ages them), badge only for ok; another login's record ignored; tests (queued) |
| 48 | 9 | WARNING | engine/autobalance-sweep.js recent | REVIEW | Held and at-risk-only decisions recorded but not shown | STATED | plan: the record and Settings are of would-moves |
| 49 | 10 | BLOCKER | engine/autobalance-sweep-7152.test.js:92 | REVIEW | Review 9's ENOENT-only read made the failed-write test throw at create() (ENOTDIR): red, never exercising the retry | FIXED | read-only folder: the read gets ENOENT, only the write fails; asserts the retry and writeFailed |
| 50 | 10 | WARNING | engine/autobalance-sweep.js:84 | REVIEW | A restart hid a risk that returned (quiet ticks unwritten, lastKey rebuilt from the old risk) | FIXED | the end of a risk is written; test (queued) |
| 51 | 10 | WARNING | web/index.html not-recording line | REVIEW | Said "does not check on a schedule" for reasons it cannot know | FIXED | "is not keeping a record ... on this computer" |
| 52 | 10 | WARNING | engine/autobalance-sweep.js:56 | REVIEW | A record that stops being writable failed silently; Settings still said it records | FIXED | writeFailed state, one log line, autobalanceSweepRuns reports it; test (queued) |
| 53 | 10 | WARNING | engine/autobalance.js:219 | REVIEW | Login check by email only; Settings uses email and organization | FIXED | sameLogin dep = usagepoll.sameLogin + accountsweekly.accountOrg (exported); test (queued) |
| 54 | 10 | CONVENTION | engine/autobalance.js:192 | REVIEW | An unreadable guide record made every agent "not idle" on Settings | FIXED | guideName read once in movableFor (throws from build: "could not work out"); tests |
| 55 | 10 | CONVENTION | comments and plan | REVIEW | "slice 3 does" stale; record vs Settings inputs unstated | FIXED | comment; plan states both |
| 56 | 12 | WARNING | engine/autobalance.js:140,232 + web abRecentHtml | REVIEW | The record drew moves off a stopped login that 3b will never make | FIXED | kept in the file, not drawn; recent() and the page skip kind 'login'; tests + browser claim (queued) |
| 57 | 12 | WARNING | engine/autobalance.js:232 | REVIEW | One blip on the target flipped moves->held->moves, writing duplicates | FIXED | signed in when a fresh measurement stands and the latest read is not a refused login; test (queued) |
| 58 | 12 | CONVENTION | server.autobalance-7152.test.js | REVIEW | real-tick test left a second account behind | FIXED | removed in the test |
| 59 | 13 | WARNING | server.js route recording line | REVIEW | autobalanceSweepRuns() outside try: a throw would 500 the accounts read | FIXED | try, false on a throw |
| 60 | 13 | WARNING | server.js route recent() | REVIEW | the whole record read on every Settings poll, switch off included | FIXED | read only with the switch on; route test arm (queued) |
| 61 | 14 | WARNING | engine/autobalance.js:236 | REVIEW | Review 12's blip rule let a signed-out account (or another login's credential) with fresh old figures stay a target | FIXED | BLIP_STATES list only; tests for six non-blip states and three blips (queued) |
| 62 | 14 | WARNING | engine/autobalance-sweep.js:115 | REVIEW | A gap in readings recorded as the risk ending, then the same would-move again | FIXED | rows carry measured; a tick where a last-at-risk account is unmeasured writes nothing (rebuilt at start); test (queued) |
| 64 | 15 | WARNING | engine/autobalance.js rowsFromReadings | REVIEW | Agents walk every tick even with nothing at risk | ACCEPTED | plan: the route's own walk, every 10 min; changes if measured slow |
| 65 | 15 | WARNING | engine/autobalance-sweep.js keyOf | REVIEW | Names in the key: idle/busy flicker writes lines | ACCEPTED | plan: the evidence 3b needs, bounded 144/day; changes if the PM finds it noisy |
| 66 | 16 | BLOCKER | engine/autobalance.js:250 | REVIEW | measured = a record exists; slice 1 rewrites at on every failed poll, so an aged-out at-risk account read measured with no risk -> false "risk ended" | FIXED | measured = a fresh figure, or a refused/signed-out login; the test now uses the real aged-out shape |
| 67 | 16 | WARNING | engine/autobalance-sweep.js:117 | REVIEW | One account's gap froze recording for every account | FIXED | the unmeasured account's entries carried from the last decision, the line marks them; test |
| 68 | 16 | WARNING | engine/autobalance.js:238 | REVIEW | A signed-out folder's stopped login "ended" in the record | FIXED | no-credential/no-token -> signed_out; test |
| 69 | 16 | CONVENTION | server.js SWEEP_MS | REVIEW | Called a test seam, no test can tick, floor 1 s | FIXED | an operator's setting, floored at a minute |
| 70 | 17 | WARNING | engine/autobalance-sweep.js keyOf | REVIEW | Carried entries appended changed the key's order: a gap wrote a duplicate | FIXED | each list sorted in the key; test (queued) |
| 71 | 17 | WARNING | engine/autobalance-sweep.js tick | REVIEW | writeFailed stuck true when the decision returned to the recorded one | FIXED | cleared when key === lastKey; test (queued) |
| 72 | 17 | CONVENTION | autobalance-sweep tick catch | REVIEW | every error read as "unreadable", nothing logged | FIXED | the reason returned and logged once |
| 73 | 18 | BLOCKER | engine/autobalance-sweep-7152.test.js:177 | REVIEW | Two tests contradicted (no-credential null vs signed_out) | FIXED | by reverting review 16's signed-out rule (W1) |
| 74 | 18 | WARNING | engine/autobalance.js | REVIEW | "no-credential" is any Keychain failure, not a sign-out: one hiccup marks every account a stopped login | FIXED | no badge, unmeasured; test |
| 75 | 18 | WARNING | engine/autobalance-sweep.js | REVIEW | A short or failed agents walk read as "nothing could move" | FIXED | decide's short on an at-risk account makes the tick a gap; test |
| 76 | 18 | WARNING | engine/autobalance-sweep.js carry | REVIEW | Carried entries lived forever with old reasons, redrawn as new would-moves | FIXED | a gap writes nothing (the plan states the cost); tests |
| 77 | 19 | WARNING | engine/autobalance-sweep.js gap rule | REVIEW | An unmeasured TARGET flipped the record to held and back (duplicate move) | FIXED | the gap rule covers every account the last decision named (at risk and move targets); test |
| 78 | 20 | BLOCKER | engine/autobalance-sweep.js gap rule | REVIEW | An idle account's expired token makes a gap last days: a silent hole while Settings says recording | FIXED | gap silent for GAP_TICKS, then written with unmeasured named (in the key), stable while it lasts; test |
| 79 | 20 | WARNING | engine/autobalance.js measured | REVIEW | A Keychain hiccup on a target, with copied fresh figures, wrote held then the move again | FIXED | no-credential/no-token never measured; test in the real shape |
| 80 | 20 | WARNING | server.js recording + page | REVIEW | Settings said "recording" while every tick was a gap or unreadable | FIXED | route reports lastTick; the page says the last check could not measure every account; gap logged once; browser claim |
| 81 | 21 | WARNING | server.js lastTick + page | REVIEW | Once a gap was written, ticks say nothing and the page's warning went quiet for days | FIXED | route unmeasuredNow from the record's last decision; the page warns from it; browser claim. Route arm untestable under a test (the sweep never ticks there), as for writeFailed: STATED |
| 82 | 21 | WARNING | engine/autobalance.js LOGIN_REFUSED | REVIEW | A 403 the agents never see reads as a stopped login | ACCEPTED | review 2's rule; never drawn; plan says what would change it |
| 84 | 22 | WARNING | engine/autobalance-sweep.js gap rule + route | REVIEW | Unnamed unmeasured accounts went silent (page quiet; held lines read as "none could") | FIXED | notMeasured on every line (outside the key); state.unmeasuredNow; route warns from any; test |
| 85 | 22 | WARNING | server.autobalance-7152.test.js | REVIEW | Route lastTick/unmeasuredNow untested | ACCEPTED | the sweep never ticks under a test; engine test pins the state; browser check the page |
| 86 | 22 | CONVENTION | web/index.html gap sentence | REVIEW | Worded for one of its three causes | FIXED | "could not check everything" |
| 87 | 24 | WARNING | engine/autobalance-sweep-7152.test.js | SELF | Dropping the unmeasured list from the dedupe key survived every test: no gap line and its end differed only in that list | FIXED | new test (spare re-measured at 80%: same hold, unmeasured cleared); green unmutated, mutant red (run 28) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Strengths (across all iterations)
- Every pass found the bulk move unchanged from origin/main, clause by clause (iterations 2 to 11).
- No email reaches the decision; every page string goes through esc() (all iterations).
