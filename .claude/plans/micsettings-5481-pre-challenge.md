---
pre_challenge: true
method: challenge-loop
branch: micsettings-5481
diff_hash: 6e4db406c7869d0738f931020ad3732121b5add682dcd1fd4b13a89144a919c7
validation: passed (local full suite on Mortals at a15e6775f, hash 6e4db406c786; FULL browser checks passed at a15e6775f)
subdir_audit: passed
timestamp: 2026-10-07T19:08:31Z
iterations: 22
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 22 blind reviews, alternating Opus (odd) and Sonnet (even).
**Converged:** Yes, at iteration 22 (Sonnet): its findings were a duplicate of ledger 30 (the real-Mac round trip is unmeasured), a behaviour description it said breaks nothing, and duplicate NITs.
**Total findings:** 2 BLOCKERs, 57 WARNINGs, 1 CONVENTION, plus NITs.
**Fixed:** 44 | **Deferred:** 12 (each with its reason below) | **Duplicates:** 3 | **Asked (awaiting user):** 0

The two BLOCKERs:
- Iteration 1: a speech refusal never restarted the mic, because the mic had never been asked. Fixed with readyToStart.
- Iteration 9: a restart made while the page still read hidden was cancelled by its own watcher. Fixed: the restart now waits for visibilitychange. Two mutations each turn the test red.

Every guard added in the loop has a mutation that turns it red (listed per iteration below).

Not measured, and stated in the plan (the card stays open for these):
- ask 1 (refused with no prompt on Josh's Mac) is not reproduced; the app now logs each permission answer with its duration;
- the real round trip through System Settings (whether the status changes without a relaunch);
- whether the two pane anchors open the exact pane on the shipped macOS. The app logs each return from Settings.

### Per-Iteration Breakdown

#### Iteration 1 (Opus) on 5bbee6cee:
- [BLOCKER] (1) main.swift recheck: speech refusal leaves mic never asked; bothAllowed never true. FIXED 70fb07b09 (readyToStart).
- [WARNING] (2) index.html offer: refusal not announced to SR. FIXED 70fb07b09 (live line kept, .vh).
- [WARNING] (3) index.html field mic pill covers text. FIXED 70fb07b09 (short label + padding, V6e).
- [WARNING] (4) main.swift: native allowed path untested. FIXED 1d3ca1efd (allowedEvent pure + 3 rows).
- [NIT] settingsId separate (FIXED 70fb07b09); awaitingAllow not cleared on X (cleared on start, FIXED in part); pill on view change (FIXED 1d3ca1efd); placeholder only white-space checked (DEFERRED: computed style is what the engine applies; V6d plus the shot).
#### Iteration 2 (Sonnet) on ced8d80aa:
- [WARNING] (5) index.html allowed restarts in a moved view. FIXED 1d3ca1efd (voiceWhere compare; mutation reddens).
- [WARNING] (6) main.swift awaitingAllow stays armed after X. DEFERRED: a stray allowed carries the old settingsId and the page drops it (VOICE_SETTINGS.btn null / id mismatch, tested "allowed for another visit"); a fresh start clears it.
- [WARNING] (7) test: native emit id untested. DUP of 4, FIXED 1d3ca1efd.
- [NIT] stale doc line (FIXED 1d3ca1efd); px padding (DEFERRED: px scales with page zoom; V6e measures it); plan silent on awaitingAllow (FIXED plan updated).
#### Iteration 3 (Opus) on 1d3ca1efd:
- [WARNING] (8) index.html .vh on the shared message line hides other messages. FIXED 39e282f95 (pill's own role=alert span).
- [WARNING] (9) both denied: pill stuck on the Speech pane. FIXED 39e282f95 (settings-next; selftest row; mutation reddens).
- [WARNING] (10) awaitingAllow never expires. FIXED 39e282f95 (ends on first didBecomeActive). Supersedes the deferral of 6.
- [WARNING] (11) where captured at offer, not press. FIXED 39e282f95 (mutation reddens).
- [NIT] focus assertion pins an unreachable state (FIXED: focus move removed); V6d checks computed white-space only (DEFERRED, as iter 1); plan missing V6e (FIXED).
#### Iteration 4 (Sonnet) on 39e282f95:
- [WARNING] (12) first-return expiry ends a visit on an unrelated reactivation. FIXED (visitOnReturn: open while unchanged, 10 min cap).
- [WARNING] (13) settings op unthrottled. FIXED (once a second; selftest row).
- [WARNING] (14) speech still off, mic changed: nothing. DEFERRED: by design, the pill still points at Speech, which is what is still off; noted.
- [NIT] null id accepted (FIXED, mutation reddens); detached btn lingers (DEFERRED: body.contains guards it); plan name convention (DEFERRED: matches the hook's invariant).
#### Iteration 5 (Opus) on c96818845:
- [WARNING] (15) a Mic visit closes on an unrelated return (settings-next not keyed on pane). FIXED (pane recorded; row).
- [WARNING] (16) double press splits the visit id between page and app. FIXED (one id per pill; mutation reddens).
- [WARNING] (17) voiceWhere's page-hidden part may lag the app's return. FIXED (place match drops it, asks layout; mutation reddens).
- [NIT] restricted mic left on a pill (FIXED: refused event); pill not tied to view (DEFERRED: by the review-3 design, press-time place); negative interval doc (FIXED).
#### Iteration 6 (Sonnet) on 99de1b6ee:
- [WARNING] (18) focus lost when the pill replaces a focused mic. FIXED (conditional focus to the label; mutation reddens). Reverses iter 3's NIT removal, now pinned.
- [WARNING] (19) id split across two pills within a second. FIXED (app records the latest visit on every press; only opening is limited).
- [WARNING] (20) emit id precedence untested. FIXED (stampId pure + 2 rows; pin on the call).
- [NIT] focus ring colour (DEFERRED: same ring as .micbtn, 2px offset over the page background); review-log comments (DEFERRED: the file's own convention, e.g. "#4409 (review 2)"); plan "not reproduced" (FIXED).
#### Iteration 7 (Opus) on 693f63f82:
- [WARNING] (21) settings-next not announced. FIXED (fresh alert; mutation reddens).
- [WARNING] (22) focus lost when the pill goes without a restart. FIXED (back to the mic; mutation reddens).
- [WARNING] (23) page/app version skew: a pill an older running app cannot serve. FIXED (settings: true on refusals; control + mutation).
- [NIT] id length cap (FIXED); negative-interval row (FIXED); speech restricted on return (FIXED, row); 124px comment (FIXED).
#### Iteration 8 (Sonnet) on 40f94d06f:
- [WARNING] (24) flag on every refusal reads as "offer the pill". FIXED (renamed canOpenSettings, documented as a capability).
- [WARNING] (25) no test that a cleared visit's late allowed does nothing. FIXED (test added).
- [WARNING] (26) the app's visit is not closed on clear. DEFERRED: the page refuses the stale id (tested), the visit ends at 10 min; an extra op adds surface for no behaviour.
- [WARNING] (27) older page + newer app: the restricted reasons fall back to the generic error line. DEFERRED: page and binary update together; the page reloads with the update; the fallback is a true sentence.
- [NIT] magic 124px (documented), tooltip title (fine), rate-limited press re-points the visit (commented).
#### Iteration 9 (Opus) on 475db165d:
- [BLOCKER] (28) restart while hidden is cancelled by the watcher. FIXED (wait for visibilitychange; two mutations redden).
- [WARNING] (29) the hidden test never ran the watcher. FIXED (word + ticks after restart).
- [WARNING] (30) the real-Mac round trip is unmeasured. DEFERRED (cannot be done headless: needs a person to flip a TCC switch); recorded in the plan and on the card.
- [NIT] settings op accepted at any time (FIXED: settingsAccepted); place split fragile (FIXED: voiceWhere steady).
#### Iteration 10 (Sonnet) on ef7161824:
- [WARNING] (31) placeholder rule global. DEFERRED: .cinput is exactly the four composers (d-say, d-term-say, pj-post, pj-say) plus asp-say, the scope Splinter ruled ("at any width"); V6d checks the computed nowrap, the shots show it.
- [WARNING] (32) settings message keys unpinned. FIXED (pins both sides; key rename reddens).
- [WARNING] (33) lastRefusal overwritten by non-denials. DEFERRED: every refusal follows a start, and a start clears the pill first, so no pill outlives a later refusal.
- [WARNING] (34) round trip unmeasured. DUP of 30 (deferred, in the plan; card stays open for the behaviour).
- [CONVENTION] review-round comments. FIXED (30 added lines reworded, older lines untouched).
- [NIT] 124px (dup), plan file name (DEFERRED: the hook's name).
#### Iteration 11 (Opus) on 30d129b4c:
- [WARNING] (35) the deferred restart's listener never expires. FIXED (60 s, dropped by clear; two mutations redden).
- [WARNING] (36) focus lost on the restart branch. FIXED (mutation reddens).
- [WARNING] (37) app-to-page names unpinned. FIXED (both sides).
- [NIT] field pill survives a dialog close (DEFERRED: X or a new start clears it; reopening shows the same box's pill, and allowed restarts only at the pressed place); no pill over a disabled box (FIXED); refresh-on-press comment (FIXED); hostCancel resets (FIXED).
#### Iteration 12 (Sonnet) on 310e64839 (local; GitHub pushes failing repo-wide from ~10:05):
- [WARNING] (38) hostCancel reset breaks hide/minimise. SELF (my iter-11 change). FIXED (pageGone; rows).
- [WARNING] (39) the shared DM pill hides the mic in other chats. FIXED (watch clears on view change; mutation reddens). Supersedes iter 3's "pressed in another chat" design.
- [WARNING] (40) card must stay open. DUP of 30.
- [NIT] settings-next id set at press (DEFERRED: the app only sends after a press); statusName overloads (DEFERRED: Swift overloads by type, the log lines read fine).
#### Iteration 13 (Opus) on 26ba5eb9f:
- [WARNING] (41) the alert is born with its text (not announced, by this file's own rule). FIXED (filled after insertion; mutation reddens).
- [NIT] doc comments misplaced (FIXED); inherited-name lookups (FIXED, Object.hasOwn); placeholder render unmeasured (DEFERRED as before); X does not tell the app (DEFERRED: the id check is tested, the visit ends at 10 min).
#### Iteration 14 (Sonnet) on 0c3584a36:
- [WARNING] (42) lastRefusal survives a successful begin. FIXED.
- [WARNING] (43) refused accepts any VOICE_SAYS key. FIXED (restricted only; mutation reddens).
- [WARNING] (44) a resize or a box going disabled drops the pill, untested. DEFERRED: by the place rule the mic itself is hidden or unusable there; the agent-switch case is the tested member of the same rule.
- [WARNING] (45) V6e does not check the field mic hidden. FIXED.
- [NIT] empty id (FIXED); observer comment (DEFERRED); 124px (dup).
#### Iteration 15 (Opus) on 755c147ea:
- [WARNING] (46) the native guards' wiring is untested. FIXED (source pins; dropping the guard reddens).
- [WARNING] (47) a never-asked mic is offered a pane with no switch. FIXED (mic-unanswered; row; control).
- [NIT] comment placement (FIXED); padding scope (FIXED); focus on watcher clear (FIXED); pane not tied to the denial (DEFERRED: both panes whitelisted, rate-limited).
#### Iteration 16 (Sonnet) on 5a8f3af83:
- [WARNING] (48) plan row count stale. FIXED.
- [WARNING] (49) X does not tell the app. DUP of 26 (DEFERRED; now stated in the plan with the reason).
- [WARNING] (50) unanswered refusals get no directions; not named in the plan. FIXED (named in Not measured).
- [NIT] shadowed hadFocus (FIXED); settings-next pane read at click (no change).
#### Iteration 17 (Opus) on 5e8570535:
- [WARNING] (51) the focus hand-off test pins an unreachable state (stub box never takes focus). FIXED (realistic stub; hand-off removed; caret-stays assertion).
- [WARNING] (52) the Settings return writes no log. FIXED (logLine with statuses, pane, age, outcome).
- [NIT] comment/plan say X drops the wait (FIXED); X steals the caret from a mouse user (FIXED; mutation reddens); body.contains false arm untested (DEFERRED).
#### Iteration 18 (Sonnet) on 4f1a42f69:
- [WARNING] (53) a rate-limited press is invisible. FIXED (logged).
- [WARNING] (54) boundary pins are whitespace-exact source matches. DEFERRED: the file's established pin style (the hostCancel and emit pins); a reformat reds them, the safe direction; the pure rows cover the logic.
- [NIT] late grant race (FIXED); settings-next place comment (FIXED).
#### Iteration 19 (Opus) on 8ce9ca01b:
- [WARNING] (55) pane anchors unverified on the shipped macOS. DEFERRED to first use (cannot be measured headless); named in the plan's Not measured.
- [NIT] plan X sentence (FIXED); pane not paired with the denial (FIXED, rows); rate-limited press records an unopened pane (FIXED); Guide pill full label in a narrow panel (FIXED, short label); Object.hasOwn (FIXED).
#### Iteration 20 (Sonnet) on 3b0eb422d:
- [WARNING] (56) a swallowed press leaves a stale pane. SELF (iter 19). FIXED (pane = the page's latest ask).
- [WARNING] (57) stateful wiring untested together. FIXED in part (observer pin added; refuse/guard/pageGone pins exist); the full sequence needs the app running, DEFERRED as in 30.
- [NIT] per-pill interval (DEFERRED: one, bounded, cleared on every exit the pill has); speechRefusal default (FIXED comment); V6 bundle (DEFERRED: the JSON dump names the failing part).
#### Iteration 21 (Opus) on 3bba40db2:
- [WARNING] (58) V6d checks declared style, not rendering. DEFERRED: no DOM API exposes a placeholder's layout; the design shots show it one line in Chromium, and a WebKit shot is the remaining look.
- [WARNING] (59) auto-start unmeasured. DUP of 30.
- [NIT] focus ring invisible on the pill (FIXED); wait listener without a timer (FIXED); pane on a swallowed press (no change, documented).
#### Iteration 22 (Sonnet) on 666d644af:
- [WARNING] restart unmeasured + fallback idea: DUP of 30 (a fallback cannot help if a relaunch is needed). W settings op ordering: describes behaviour, "nothing breaks": not a defect. NITs: DUP.
CONVERGED at iteration 22: zero NEW findings after dedup.
58 (update 11:50): LOOKED: a WebKit design shot (mobile-shots --engines webkit, iPhone 15 light) shows the composer placeholder on one line ending 'Write somethi...' with the ellipsis beside [X  Settings]. WebKit here is Playwright's engine, an approximation of the app's WKWebView, not Safari.

### After convergence (disclosed)

- df5d684d1 merged main (no conflicts).
- a15e6775f changes two restricted sentences from "this Mac" to "this computer", because the full suite's
  speaking-files guard (engine/machine.test.js) forbids "this Mac" in person-facing copy. The guard and the voice
  tests pass. The plan also records the WebKit look at the one-line placeholder.
