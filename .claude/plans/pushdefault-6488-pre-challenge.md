---
pre_challenge: true
method: challenge-loop
branch: pushdefault-6488
diff_hash: 2ad55c195324586cb9120cca661e288563a5f7de04701b1389a20c6443db84e2
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T17:44:33Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes (iteration 12: no BLOCKER, WARNING or CONVENTION; 5 NITs, all deferred with reasons)
**Total findings:** 100 (2 BLOCKERs, 35 WARNINGs, 14 CONVENTIONs, 49 NITs), counted from the lists below
**Fixed:** 70 | **Deferred:** 30 | **Asked (awaiting user):** 0

The loop did not converge quickly. Two things kept finding real defects: Settings copy for each new state, and
how far "nothing is sent while Kosmos+ is off" really reached. Each round's findings were real. Most of the late
ones were edges that the previous round's fixes had just exposed. Every fix has a mutant that fails a test.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 CONVENTIONs, 4 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] engine/phonenotify.js startDefaultOn: no backoff, a log line every tick, re-mint after a mint it could not save --> FIXED (bdb97d8e56)
- [WARNING] engine/remote.js forget: removing the computer deleted the person's off, so a reconnect turned it on --> FIXED (bdb97d8e56): phone-notify-choice.json beside remote.json
- [WARNING] needs_you email would also become a default (KOSMOS_NEEDS_YOU_EMAIL) --> DEFERRED: the flag is off in production (measured, 0 lines on the box) and stays off until the board acks; noted on kosmos#6487
- [CONVENTION] engine/phonenotify.js: two comments still said off by default --> FIXED (bdb97d8e56)
- [CONVENTION] server.phonenotify-718.test.js: wiring test by character distance --> FIXED (de5e2523c0, anchored on the listen callback)
- [CONVENTION] comment wrap ragged --> FIXED (de5e2523c0)
- [NIT] a test title claimed more than it could fail on --> FIXED (bdb97d8e56)
- [NIT] up to 5 min before the default after sign-in --> FIXED (bdb97d8e56, sign-in pokes)
- [NIT] an open Settings page can re-mint on a press --> DEFERRED: the old behaviour of a press; each press is the person's
- [NIT] "Choose below" points at nothing while off --> FIXED (bdb97d8e56)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs, 5 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] an off made before #6488 was lost if the computer was then removed --> FIXED (de5e2523c0, copied out on the first run)
- [WARNING] retry test was timing-based --> FIXED (de5e2523c0, whenIdle)
- [CONVENTION] CLAUDE.md still said off by default --> FIXED (de5e2523c0)
- [CONVENTION] comment wrap --> FIXED (de5e2523c0)
- [CONVENTION] wiring test brittle --> FIXED (de5e2523c0)
- [NIT] writeChoice did not make its folder --> FIXED (de5e2523c0)
- [NIT] turnOff kept the off even when its save failed --> FIXED (de5e2523c0)
- [NIT] no test pinned the choice file holding only {off:true} --> FIXED (de5e2523c0)
- [NIT] log label when a press joins a default mint --> DEFERRED: harmless wording in the board log
- [NIT] Settings does not refresh after the sign-in mint --> FIXED later (69704c2669)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTIONs, 3 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] backoff grew on refusals made before anything was sent --> FIXED (2f2f6385ce, notSent)
- [WARNING] the quiet path hid the real failure reason --> FIXED (2f2f6385ce, detail)
- [WARNING] not-connected copy contradicted the default --> FIXED (2f2f6385ce)
- [WARNING] no test for turning off or setting a sub-switch during a default mint --> FIXED (2f2f6385ce)
- [CONVENTION] a throw in the scheduler handler ended the schedule --> FIXED (2f2f6385ce)
- [NIT] a failed removal of the kept off is the safe direction --> FIXED (2f2f6385ce, comment)
- [NIT] the kept off belongs to the computer, not the account --> FIXED (2f2f6385ce, comment)
- [NIT] an earlier off removed on an older version cannot be recovered --> DEFERRED: no record exists; stated on the card

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] sign-in did not reset a long wait --> FIXED (4476df5cf3, poke)
- [WARNING] Settings promised "turns on by itself" to a person who turned it off --> FIXED (4476df5cf3, offByChoice)
- [WARNING] connected and not on yet showed no words --> FIXED (4476df5cf3)
- [WARNING] a bad mint stopped the schedule for the session --> FIXED (4476df5cf3, longest wait instead)
- [CONVENTION] wiring test by text --> DEFERRED: matches how this file pins wiring; loosened later
- [CONVENTION] scheduler doc sat above the consts --> FIXED (4476df5cf3)
- [NIT] choiceFile comment incomplete --> FIXED (4476df5cf3)
- [NIT] quiet belongs to the first caller --> DEFERRED: the press still gets its sentence
- [NIT] removal during a mint could save a stale token --> FIXED (4476df5cf3, re-check before saving)
- [NIT] a test comment was wrong --> FIXED (4476df5cf3)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTIONs, 4 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] no way to say off before the default turns it on --> DEFERRED: a new board control; Josh ruled on by default; the person turns it off after (on the card)
- [WARNING] Settings never repainted after a background turn-on --> FIXED (69704c2669, 30 s look and visibilitychange)
- [WARNING] "turns on by itself" forever with a tunnel too old for mac-request --> DEFERRED: tools/lib/connector-verbs.sh refuses a bundle without mac-request while this is open
- [WARNING] the off-by-choice sentence was empty, so its checks were vacuous --> FIXED (69704c2669)
- [CONVENTION] a stopped schedule stayed registered --> FIXED (69704c2669)
- [NIT] removal-guard comment described an order forget does not produce --> FIXED (69704c2669)
- [NIT] runs could pile up after a minted failure --> DEFERRED: pokes only come from a person connecting; rare and bounded
- [NIT] log label --> DEFERRED (as iteration 2)
- [NIT] held-mint poll bound too low under load --> FIXED (69704c2669, 30 s)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] an hour-long outage could leave a computer off for hours --> FIXED (1816872de8, 30 min cap)
- [WARNING] a corrupt state file's off was lost on a reconnect --> FIXED (1816872de8), later narrowed to positive evidence (7d736fd2a2)
- [NIT] docs/phone-push-go-live.md said off by default --> FIXED (1816872de8)
- [NIT] log label --> DEFERRED (as iteration 2)
- [NIT] the 30 s look stopped while a press was in flight --> FIXED (1816872de8)
- [NIT] status reads two files per look --> DEFERRED: local reads every 30 s, cheap
- [NIT] masterChoice reads the file twice --> DEFERRED: same

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTIONs, 4 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] no keep-off before connecting --> DEFERRED (as iteration 5)
- [WARNING] Settings promised it turns on when the default can never succeed --> FIXED (d4b59ba826, defaultBecause)
- [WARNING] the default minted for a computer whose person switched Kosmos+ off --> FIXED (d4b59ba826)
- [WARNING] a failed read stopped the 30 s look and hid the section --> FIXED (d4b59ba826)
- [CONVENTION] the minted comment overclaimed --> FIXED (d4b59ba826)
- [NIT] a look in flight can paint over a press --> DEFERRED: the press's own paint wins
- [NIT] log label --> DEFERRED (as iteration 2)
- [NIT] looks run while nobody is looking --> FIXED later (f4b987184d)
- [NIT] a notifyId alone is evidence of an earlier turn-on --> FIXED (d4b59ba826)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [BLOCKER] happened() kept sending to Kosmos+ after the person switched it off --> FIXED (7d736fd2a2, plusLive in the send path and in status.connected)
- [WARNING] one bad read of the state file became a permanent off --> FIXED (7d736fd2a2, copy only positive evidence)
- [WARNING] a bad mint waited 6 hours --> FIXED (7d736fd2a2, 1 hour)
- [NIT] defaultBecause stale between ticks --> DEFERRED: refreshed on the next tick and on every connect poke
- [NIT] held-mint test polls in real time --> DEFERRED: bounded, gated, passes under load

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 5 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [BLOCKER] a press on Turn on minted while Kosmos+ was switched off --> FIXED (f4b987184d, plusLive in doTurnOn)
- [WARNING] only one of four connect paths poked the default --> FIXED (f4b987184d)
- [WARNING] the poke starts a signed call inside the sign-in window --> DEFERRED: accepted and written beside the poke (a Remove waits for one call)
- [WARNING] setKind made an unreadable file a permanent off --> FIXED (f4b987184d)
- [WARNING] the 30 s look ran on every board forever --> FIXED (f4b987184d, only while connected)
- [CONVENTION] plusLive's doc sat on the wrong function --> FIXED (f4b987184d)
- [CONVENTION] route comment said off by default --> FIXED (f4b987184d)
- [NIT] dead null guard --> FIXED (f4b987184d)
- [NIT] two reasons lacked a capital or full stop --> FIXED (f4b987184d)
- [NIT] not-connected words wrong when signed in but off --> FIXED (f4b987184d)
- [NIT] wiring test by distance --> FIXED (f4b987184d, anchored per handler)
- [NIT] visibility look ignores kindBusy --> DEFERRED: the toggle's own paint wins

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTIONs, 4 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] setKind over an unreadable file then let the default turn it on --> FIXED (603b07dacf, refuse and leave the file)
- [WARNING] a startup failure doubled the wait --> FIXED (603b07dacf, startup counts as a change; 15 min cap)
- [WARNING] the message for signed in but switched off said "connect" --> FIXED (603b07dacf)
- [CONVENTION] the same comment pasted four times --> FIXED (603b07dacf, phoneDefaultAfterConnect)
- [NIT] overlapping pokes after a failure --> DEFERRED (as iteration 5)
- [NIT] a fresh notifyId per failed retry --> DEFERRED: nothing is saved until success; harmless
- [NIT] the look never backs off --> DEFERRED: local and cheap
- [NIT] "Off. Press Turn on to turn it on." reads awkwardly --> DEFERRED: wording, Mona's catalog lane

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [WARNING] Settings stale after connecting in the same page --> FIXED (b086eed3eb, 2 min look while not connected)
- [WARNING] the real schedule and pokes ran inside test files that call start() --> FIXED (b086eed3eb)
- [WARNING] an unreadable kept off read as never touched --> FIXED (b086eed3eb)
- [NIT] a busy refusal showed "could not be reached" --> FIXED (b086eed3eb)
- [NIT] a lowercase save failure in Settings --> FIXED (b086eed3eb)
- [NIT] not-connected words when only switched off --> DEFERRED: status would need a second connection field; the press message is exact
- [NIT] offByChoice comment --> FIXED (b086eed3eb)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured (no 6c-bis blame lookup was run; many late findings were edges exposed by the previous round, per the summary)
- [NIT] up to 2 min stale after switching Kosmos+ on elsewhere in the page --> DEFERRED: bounded, and the connect poke has already turned it on
- [NIT] "Try again in a minute" overpromises on the default path --> DEFERRED: wording follow-up with Mona's catalog
- [NIT] quiet hides a joined press's log line --> DEFERRED (as iteration 4)
- [NIT] a lost mint answer re-mints on the next retry --> DEFERRED: nothing saved, bounded by the backoff
- [NIT] long poll ceilings in tests --> DEFERRED: bounded
**Converged**: no new actionable findings.

### Final validation
- Full suite (yarn test, tools/run-tests.sh): passed on b086eed3eb (queued-heavy turn, END rc=0 12:40 CDT): node 21983 tests, 21685 pass, 0 fail, 0 cancelled, 298 skipped; shell-shard 1/1 all 252 passed
- Neighbouring files, run every round: 786/786 including server.test.js.
- Browser check docs/browser-checks/render-push-718.js, headless on a sandbox board: 38/38. A control that broke one sentence failed it.
- Both browser-check gates (#1720, #2518) pass.
