---
pre_challenge: true
method: challenge-loop
branch: ctwatch-board-6602
diff_hash: 50c1edf05b3b235b1c967c21ff28f8776c3f93dc353fda5b6c887e3879d60ffc
validation: failed (1 of 22240, pre-existing on main: kosmos#6633, reproduced on origin/main ba94839879)
subdir_audit: passed
timestamp: 2026-10-19T21:40:41Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16. **Converged:** Yes: iteration 16 raised nothing new, on 101eced8.
**Fixed:** every actionable finding of iterations 1 to 15, in one fix commit per iteration (listed below). **Asked:** 0.

**Provenance, stated plainly.** The loop ran in this agent's previous session on 2026-10-19, and its ledger did not
survive the restart. What each iteration changed is recorded in its own fix commit, listed below. Finding counts per
iteration are not reconstructed. Decisions and the weakest premises are in .claude/plans/ctwatch-board-6602.md.

**Rebase.** After convergence the branch was rebased onto origin/main, 16 commits ahead, with no conflicts. The
branch diff's patch-id is unchanged: fa3806b4 before and after.

**Validation, measured:**
- **Mortals full suite** at 73e8f134 (the rebased head), 16:24 to 16:39 CDT: 22240 tests, 21922 passed, 1 failed,
  317 skipped.
  - The one failure is engine/handoff.test.js "#6506: render prints the shared contract...". This branch does not
    touch that file.
  - The same test fails on a fresh origin/main worktree at ba94839879: 21 of 22, the same assertion. Card kosmos#6633
    already tracks it: a time-pinned test that writes its fixture at the real time.
  - So the field above says failed, with its cause, and does not say passed.
- **Browser check** render-plus-panel-3829.js on this Mac at 101eced8 (same diff): 165 PASS, 0 FAIL, 0 SKIPPED,
  including the certificate scenarios (posted on kosmos#6602).
- **Focused tests**, run by hand earlier: engine/cert-watch.test.js, web.plus-cert-watch-6602.test.js,
  windows-tests-1777 and the server.test.js route test.

### Fix commits, one per iteration
- 8ad58bf5f7 ctwatch-board-6602 -- address challenge-loop iteration 1 findings
- ee01cf0685 ctwatch-board-6602 -- address challenge-loop iteration 2 findings
- 9f14dfa5b0 ctwatch-board-6602 -- address challenge-loop iteration 3 findings
- eea931336a ctwatch-board-6602 -- address challenge-loop iteration 4 findings
- 4167d92241 ctwatch-board-6602 -- address challenge-loop iteration 5 findings
- 4796716578 ctwatch-board-6602 -- address challenge-loop iteration 6 findings
- b58fd66c35 ctwatch-board-6602 -- address challenge-loop iteration 7 findings
- cd43f24e6f ctwatch-board-6602 -- final validation: run the cert-watch test on Windows too
- 5915964032 ctwatch-board-6602 -- address challenge-loop iteration 9 findings
- 4e7d3ad46f ctwatch-board-6602 -- address challenge-loop iteration 10 findings
- 9eb25cf092 ctwatch-board-6602 -- address challenge-loop iteration 11 findings
- 70d14d14df ctwatch-board-6602 -- address challenge-loop iteration 12 findings
- aaac4871d0 ctwatch-board-6602 -- address challenge-loop iteration 13 findings
- e044248cfd ctwatch-board-6602 -- a clear dated ahead is pinned as not current
- 88700e707a ctwatch-board-6602 -- address challenge-loop iteration 14 findings (proof results in the plan)
- 73e8f134a3 ctwatch-board-6602 -- address challenge-loop iteration 15 findings

### Per-Iteration Breakdown

The reviewers' own reports, copied from the previous session's transcript (Claude Code project log b4a0cc24, 2026-10-19), with paths made repo-relative and em dashes replaced (house style). Nothing else is edited.

#### Iteration 1

Findings

[WARNING] web/index.html:52370: Switching the check off hides a standing `foreign` warning (`say` is empty whenever `cw.on !== true`, and the web test pins this behaviour). So one click on the switch dismisses a security finding, which is exactly what the plan's Decisions section rejects for a dismiss button. Keep the finding line visible while the check is off (perhaps with "the check is off" added), or note the switch as a deliberate dismiss path in the plan.

[WARNING] server.js:10533: `PUT /api/remote/cert-watch` has no `isViaScreen` gate. An agent holding a board token can turn off the computer's impersonation watch. The repo calls `isViaScreen` "the check every person-only setting uses" (server.js:10924; it is used on agycap-setting, org enroll, device allow and join confirm). A security watch's off switch belongs in that class, even though the older `PUT /api/remote` sibling is ungated. Add `if (!isViaScreen(req, body)) { sendJson(res, 403, ...) }` after the body parse, plus a 403 arm in the route test.

[WARNING] engine/cert-watch.js:46: A `damaged_report_at` report reads `unknown` and shows the generic "has not been able to confirm anything lately". The tunnel's reader contract (kosmos-relay-ctwatch-6588 crates/tunnel/src/ctwatch.rs:69-75) says to treat that field as possibly foreign. It also says the field stays set until a person has looked, and that "acknowledging it is the board's job (kosmos#6602)". This branch ships no acknowledge, so a damaged report produces a permanent line that says "lately". The person cannot clear it from the app and is never told findings may have been lost. Either give the damaged case its own wording and an acknowledge path, or record in the plan, as a known gap, that #6602 does not do the tunnel-side contract's acknowledgement.

[WARNING] web/index.html:52357: The `foreign` wording says "a certificate for this computer's address", but `state` is also forced to `foreign` when only `earlier` (a previous address's findings) is non-zero. In that case the sentence names the wrong address. Since the counts are already passed, use a variant for `foreign === 0 &amp;&amp; earlier &gt; 0` ("for an address this computer used before").

[WARNING] web.plus-cert-watch-6602.test.js:12: This file reads `web/index.html` and requires `./test-support/page` relative to the cwd. It passes only when run from the repo root (both conventions exist in the repo: 78 siblings do the same, 111 use `__dirname`). Using `path.join(__dirname, 'web/index.html')` makes it runnable by absolute path. I could not run it for this reason without `cd`.

[NIT] web/index.html:52376: The cert switch handler does not call `plusSay('')` before acting, unlike the `plus-switch` sibling (52338). An earlier error stays in `#plus-msg` after a later successful toggle. Errors also land in the shared `plus-msg` with kind `'switch'`, which sits next to the main Plus switch, not this row.

[NIT] web/index.html:11703: `#s-sec-plus .plus-cw-row:not([hidden]) { display: flex; }` is redundant. The rule above already sets flex, and the global `[hidden] { display: none !important; }` (line 594) is what actually hides the row.

[NIT] web/index.html:52366: The line's text is set while it is still `hidden`, then un-hidden in the same tick. Some screen readers do not announce a `role="status"` region whose content changed while it was hidden, so the first finding may go unannounced. Un-hiding first, then setting the text on the next frame, is more reliable.

[NIT] engine/cert-watch.js:45: The staleness boundary differs slightly from the tunnel's. JS treats exactly 40 h as still clear (`&gt; STALE_MS`), while the tunnel treats `&gt;= 2*spacing` as not verified (`&lt; 2 * CHECK_SPACING_SECS` is the verified test). JS also uses `Math.abs`, so a far-future `checked_at` reads unknown, which is a reasonable choice. Not material, but `&gt;=` would match the tunnel exactly.

[NIT] .claude/plans/ctwatch-board-6602.md:17: The plan says "the switch shows whenever the computer is set up". The code relies on `paintPlus` reaching the call only in the enrolled branch, which is true (51534 returns early). A one-line comment at the call site saying the enrolled gate is what keeps the row off an un-set-up computer would make that dependency visible.

[STRENGTH]: No report string reaches the page. `certWatchFrom` passes only the state, counts and times, and a test plants markup in `dns_names` and `error` and asserts no `&lt;` survives. The tunnel's comment explicitly warns those strings are untrusted.

[STRENGTH]: `certWatchFrom` handles the bad-file cases carefully: a file that is present but unparsable reads `unknown`, never `none`; any finding, including an earlier address's, forces `foreign` ahead of a stale or damaged `clear`; unknown states fall to `unknown`. Each case has a test with a paired arm that can return the dangerous answer (recent clear vs. 41 h clear, `failing` both directions).

[STRENGTH]: `paintPlusCertWatch` follows the sibling patterns: `typeof` guard at the `paintPlus` call so lifted page-test slices keep working, `paintSwitch` so an unread switch is never a guessed Off, the "click means what the switch showed" rule, and text rewritten only on change so the 5 s poll does not re-announce it. The browser check `render-plus-panel-3829.js` stubs `/api/remote` without `certWatch`, so the row stays hidden there and that check is unaffected. That also means no browser check or design shot covers the new row yet.

[STRENGTH]: `engine/cert-watch.test.js` passes, 9 of 9, run by absolute path. The off file is written mode 600, and the file names are pinned against the tunnel's constants with a "change both together" test.

#### Iteration 2

Findings

[WARNING] engine/cert-watch.js:49: When the tunnel's raw `state` is `foreign` but the foreign and earlier lists are empty and the overflow counts are 0 or absent, the state stays `foreign` with `foreign: 0, earlier: 0`. `plusCwSay` then picks the "an address this computer used before" sentence (it tests `cw.foreign &gt; 0`). That tells a person the wrong thing about a security warning. Either say a generic sentence when both counts are 0, or base the "earlier" branch on `cw.earlier &gt; 0`. No test covers this.

[WARNING] web/index.html:52364: `PLUS_CW_WORDS` is a top-level `const` far below `paintPlus`. Nearby code uses `var` for state `paintPlus` reads, with a comment about the temporal dead zone. Today it works, because `paintPlus` reads the constant only after its first `await fetch`. A later change that paints before that await would throw a ReferenceError, and `typeof paintPlusCertWatch === 'function'` would not catch it, since the function is hoisted but the constant is not. Use `var` as the siblings do, or move the block above `paintPlus`.

[WARNING] web/index.html:51605: The check's line and switch show whenever the computer is enrolled, even when the Plus switch is off or the tunnel is not running. The label promises a check "once a day", but the check lives in the tunnel. If the tunnel is not running, nothing is being checked, and the switch reads On with no line. The unknown state is the only signal, and `cw.state === 'unknown'` (not-run-lately) is not reachable from a never-run `none`. The plan accepts this only for the "switch always reachable" reason. I suggest at least a plan note, or label wording like "while Kosmos+ is on".

[WARNING] web/index.html:52389: The switch click handler does not stop a double click or concurrent clicks. Each click reads `aria-checked` and PUTs the desired state. A fast double click sends two correct toggles, but responses can finish out of order and `paintPlus` can repaint from a stale read. `plus-switch` has the same shape, so this is minor, but this one guards a security check.

[NIT] web/index.html:52378: A failed PUT (403 or 400) shows `plusSay(..., 'switch')` in the shared `plus-msg` slot, and `paintPlus()` runs right after. Whether that repaint clears `plus-msg` depends on existing code, and I did not trace it. A browser check on the failure path would confirm the message survives.

[NIT] web/index.html:19588: The switch button has the `hidden` attribute in markup and the row starts `hidden`. Only `paintSwitch` clears it, which is correct. When `certWatch` is absent, `paintPlusCertWatch` hides the row but leaves the switch's `aria-checked` as last painted. This is harmless because the row is hidden.

[NIT] engine/cert-watch.js:15: The 20-hour spacing is duplicated from the tunnel with only a test pinning it. The test checks the JS constants against themselves, not against the Rust source, so drift in the tunnel goes unseen. The comment says "change both together" but nothing enforces it.

[NIT] server.test.js:11609: The route test goes through `req()` to the real state-dir env override. It does not exercise the `HEAD` or cached-read path, but that is fine. It also never checks that the PUT is refused when the state dir is missing (`setCertWatchIn` returns 400). The unit test covers that, so it is only a gap in the wiring.

[CONVENTION]: I found no em dashes in the added lines. The plan file exists at `.claude/plans/ctwatch-board-6602.md`. I did not read the repo `CLAUDE.md` beyond a grep for 6602 and cert, which found nothing relevant.

[STRENGTH] engine/cert-watch.js: Only a state, counts and times leave the module, never strings from the tunnel's report. A test with an HTML payload checks this. Failure modes (an unparseable file, a damaged report, an unknown state, an old `clear`) all read `unknown` rather than clear, and the boundary at exactly two spacings is tested.

[STRENGTH] server.js:10532: The switch route is person-only through `isViaScreen`, matching its sibling routes, so an agent cannot turn the security check off. The route test checks the 403 and that no off file was written.

[STRENGTH] web/index.html:52366: A finding is still said when the check is switched off, with "The check is off." appended, so the switch cannot hide a warning. The label says what is sent and to whom. Both are tested, and all 15 tests in the two new test files pass.

#### Iteration 3

Findings

[BLOCKER] engine/cert-watch.test.js:10: This file makes about seven `fs.mkdtempSync(path.join(os.tmpdir(), 'cert-watch-'))` directories and never removes them. It also does not `require('./test-support/tmpscope')`, which `server.test.js:68` does. Under `tools/run-tests.sh`, the #4273 leak guard (`run-tests.sh` around line 620) compares the temp families left behind against `tools/test-leak-allowlist.txt`. `cert-watch-` is not on that list (grep found nothing), so the full suite should fail with `#4273 LEAK` even though all 9 tests pass when run alone. The fix is to put `require('../test-support/tmpscope');` at the top of the file, before the other requires, or to clean up each dir. The `cw-route-` dirs in `server.test.js` are already covered by that file's tmpscope.

[WARNING] engine/cert-watch.js:49: `lost` is `raw.damaged_report_at !== undefined`. If the tunnel ever writes the field as `null` (a serde `Option` without `skip_serializing_if`), every report reads `lost: true`. A clear computer would then show "An earlier report ... could not be read" all the time and never reach `clear`. Every other time field goes through `secs()`, which treats null as absent. Use the same rule here (`secs(raw.damaged_report_at) !== null`, or at least `!= null`), and add a test case with `damaged_report_at: null`. I could not check what `ctwatch.rs` actually writes because it is outside this worktree.

[WARNING] web/index.html:52370: `plusCwSay` says the `unknown` sentence whenever `cw.on === true`, and it is not told whether Kosmos+ itself is on (`r.on`). The check only runs in the tunnel. So a person who turns Kosmos+ off for more than 40 hours gets "The daily check of the public certificate logs has not been able to confirm anything lately" on an enrolled pane. That is true but alarming, and it is a direct result of their own choice; the switch label even says "While Kosmos+ is on". Consider passing `r.on` in and staying quiet about unknown or lost while Kosmos+ is off, as the plan already does for the check's own off switch. Findings should still always be said.

[WARNING] web.plus-cert-watch-6602.test.js:24: The page test takes slices of the script by text anchors and runs them in a stub world. That covers `plusCwSay` and the paint well, but no test exercises the click handler: the busy guard, `aria-checked` being read before the PUT, or the error path through `plusSay(plusWords(...))`. No browser check covers the new row either: `docs/browser-checks/render-plus-panel-3829.js` has no `plus-cw` reference. A small handler test with a stubbed `fetch`, or one line in the Plus panel browser check, would cover both.

[NIT] web/index.html:52357: The comment says `var` rather than `const` because "paintPlus reads these". `paintPlus` only reaches `PLUS_CW_WORDS` through `plusCwSay`. If it ever did run before this line, `var` would give `undefined.foreign`, a TypeError, so it gives no protection over `const`. In practice paintPlus awaits a fetch before it gets there, so there is no live problem; the comment's reasoning is just inaccurate.

[NIT] engine/cert-watch.js:44: `Math.abs(nowMs - checkedAt * 1000)` treats a `checked_at` far in the future (clock skew, or a bad write) as stale, which is the safe direction. One line in the comment saying this is deliberate would stop a later reader from "fixing" it into a one-sided check.

[NIT] engine/cert-watch.js:65: `setCertWatchIn` accepts any existing state dir, whether or not the computer is enrolled. The page only shows the switch when enrolled, so this is reachable only by a direct PUT, and that is screen-gated. It does no harm, but the "set up" wording in the refusal is looser than the `enrolled()` rule the page uses.

[NIT] .claude/plans/ctwatch-board-6602.md:34: The Proof section lists the test counts but not a full `tools/run-tests.sh` run, which is the run that would have shown the leak above.

[STRENGTH]: The design keeps third-party text off the page: the engine passes on only a state, counts and times, and a test checks that a `&lt;img onerror&gt;` payload in the report never shows up in the output. The page writes only `textContent`, never `innerHTML`.

[STRENGTH]: The new PUT route is stricter than its sibling `PUT /api/remote`. It is limited to the person's screen (`isViaScreen` with the body, 403 otherwise), so an agent cannot switch off a security check. The server test proves the refusal and checks that the off file was not written.

[STRENGTH]: The engine fails safe: a damaged, unparseable, unrecognised or old report never reads `clear`, and the exact 40-hour boundary is tested as stale. A finding is still said while the check is switched off, so the switch can never hide one.

[STRENGTH]: The change fits around existing callers: the `typeof` guard on `paintPlusCertWatch` keeps page tests that lift `paintPlus` alone working, `paintSwitch` is reused (hidden until it has a value), the line is rewritten only when it changes so screen readers do not re-read it every poll, and the user-facing copy has no em dashes.

Both new test files pass when run directly (9/9 and 6/6). I did not run the full suite, so the BLOCKER comes from reading `run-tests.sh` and the leak guard, not from an observed failure.

#### Iteration 4

Findings

[WARNING] web/index.html:51606: A finding shows only in the Settings Plus pane, and only when that pane is painted. Nothing else on the screen surfaces a foreign certificate (no badge or banner elsewhere). The plan accepts "no acknowledge" but doesn't mention this reach limit. I'd record it as a known gap or follow-up card.

[WARNING] engine/cert-watch.js:68: `setCertWatchIn(false)` writes `ct-watch-off` and the line then drops the cannot-confirm and lost sentences while the check is off, as the plan states. A person who turned the check off after a "lost earlier report" notice therefore loses that notice for good, and there is no acknowledge to clear it. The plan documents this as a known gap, so it is acceptable, but it is a weak spot in the security UX.

[NIT] engine/cert-watch.js:50: `beforeRecord` and `failing` are computed and returned but nothing in the page reads them. The tests cover them, so this is harmless, but it is surface that could drift.

[NIT] engine/cert-watch.js:75: The off file is written with a plain `writeFileSync` and `rmSync`, and the tunnel reads it concurrently. An empty file's existence is all that matters, so this is fine.

[NIT] server.js:10512: `GET /api/remote` now does two synchronous `existsSync` calls and one file read on every poll (the pane polls about every 5 seconds). The cost is trivial, but the call is not wrapped separately. `certWatchFrom` never throws, so the surrounding try/catch is not at risk.

[NIT] web/index.html:19588: The switch label is long, with a parenthetical sentence fragment ("this sends the address to Cert Spotter"). It is honest, but it may wrap awkwardly on a phone. The 10px gap and the `flex: 0 0 42px` toggle are fine. I'd check the label at phone width in the browser checks.

[STRENGTH]: The report path passes on only a state, counts and times, never a string from the third-party report. This closes the XSS and injection route, and a test proves it with a `&lt;img onerror&gt;` payload and a check that no `&lt;` reaches the answer.

[STRENGTH]: The PUT route uses `isViaScreen`, the same guard as the sibling routes (lines 5833, 5866 and others). An agent cannot switch the security check off. The route test covers the 403, the 400 on a non-boolean, the file created and removed, and restores the env var in `finally`.

[STRENGTH]: The reader rules are conservative and each has a control in the tests. A `clear` is stale at exactly 40 hours (inclusive), and a future-dated `clear` also reads `unknown`. An unparseable file, an unknown state, a damaged-report marker and any earlier-address finding are all never `clear`.

[STRENGTH]: `paintSwitch` removes `aria-checked` and hides the switch when state is unread, and the click handler refuses to act without `aria-checked`. This follows the #4080 rule, and the busy guard is tested by firing two clicks at once. The `role="status"` line is rewritten only on a change, so screen readers are not re-read every poll.

[STRENGTH]: Wording is plain, honest and has no em dashes. A finding is never hidden by switching the check off, and the "The check is off." suffix says why. The plan documents its decisions with the weakest premise named. A plan file exists at `.claude/plans/ctwatch-board-6602.md` and matches the diff.

[STRENGTH]: The page test lifts the real script slices, with re-anchor assertions so a moved anchor fails loudly rather than testing nothing. The `typeof paintPlusCertWatch === 'function'` guard keeps the existing page tests that lift `paintPlus` alone from throwing. The route test sits in `server.test.js`, which already requires `tmpscope`, so the temp-dir leak guard is covered.

I did not run the new test files.

#### Iteration 5

Findings

[WARNING] web/index.html:19581: The new line `#plus-cw-line` (role="status") stays `hidden` until it has text, and `paintPlusCertWatch` sets `textContent` and removes `hidden` in the same paint. A live region that is not in the accessibility tree when its content changes is often not announced (VoiceOver and NVDA both skip it). So the first time a `foreign` finding appears, which is the most important moment, a screen reader may say nothing. The sibling `#plus-status` avoids this by always being present and only emptying. Suggested fix: keep the `&lt;p&gt;` un-hidden, let it collapse when empty, and change only its text.

[WARNING] engine/cert-watch.js:100: If `damaged_report_at` is set, the state is forced to `unknown` and the page shows the "could not be read" sentence. The tunnel keeps that marker until the board acknowledges the lost report, and this branch ships no acknowledge. So once a report is damaged, the sentence stays on screen for good, the person can do nothing about it, and a real `clear` never shows again. The plan names this as a known gap but cites no follow-up card. File one, and link it from the plan and from the code comment, so a permanent unclearable alarm is not shipped without an owner.

[WARNING] engine/cert-watch.js:79: `secs()` only accepts positive integers. If the tunnel writes `checked_at` or `error_at` as a float or a string, every `clear` silently reads `unknown`, and the line says "has not been able to confirm anything lately" all the time. The format the board expects is backed only by this repo's own fixtures and a comment naming `ctwatch.rs`. The file-name test asks for "change both together", but nothing ties the field types or names to the tunnel. I could not check the tunnel side, because it is in a separate repo. A shared fixture, or a pinned sample of a real `ct-watch.json` copied from kosmos-relay#459, would let this fail loudly when the two drift.

[NIT] web/index.html:19583: The switch label is a `&lt;span&gt;` used through `aria-labelledby`. Clicking the label text does not flip the switch, and the switch's accessible name is the whole 130-character sentence. Consider a short name (for example "Check certificate logs daily") with the rest as `aria-describedby`.

[NIT] web/index.html:51605: The comment says not-enrolled is "what keeps the switch off a computer with no state dir". The `PLUS_SI_REGISTERING` early return also skips the paint, and the row only stays hidden because it sits inside `#plus-flow`. Naming that containment would stop a later move of the row from quietly showing it on a state1 pane.

[NIT] engine/cert-watch.js:89: The parse-failure return builds its object with the keys in a different order from the main return (`failing` before `lost`). It does no harm, but one shape built in one place would make the two branches easier to compare by eye.

[STRENGTH]: Only counts, times and a state from an allowlist come out of the third-party report. `engine/cert-watch.test.js` sends an XSS-shaped `dns_names` entry and an `error` string through and checks they never come out. The page writes everything with `textContent`.

[STRENGTH]: The PUT route matches its siblings: it uses `isViaScreen` with the same 403 wording as the other Settings switches. `server.test.js` covers both sides: it is refused without the screen header (and the off file is shown to be absent), and it works with the header.

[STRENGTH]: The tests can actually fail. The staleness test includes the exact 40-hour boundary. The click test proves the busy guard by firing two clicks before the fetch resolves (remove the guard and it fails). Each "says nothing" case is paired with a case that does speak.

[STRENGTH]: Turning the check off never hides a finding: a finding still shows, with "The check is off." added. The cannot-confirm sentences are left out while Kosmos+ is off, which is the honest choice, because the check runs in the tunnel. The decisions and their weakest premises are written down in the plan.

[STRENGTH]: `paintPlus` reaches the new code through a `typeof` guard, so the existing page tests that lift `paintPlus` alone are not affected. An older server with no `certWatch` hides both the line and the switch. No em dashes were added, and `engine/*.js` is copied into the bundle wholesale, so the new module ships.

Both new test files pass (`engine/cert-watch.test.js` 9 of 9, `web.plus-cert-watch-6602.test.js` 9 of 9). I did not run the new `server.test.js` route test, because the review limits only allowed running the two new test files.

#### Iteration 6

Findings

[WARNING] web/index.html:51608: A finding (`foreign`) shows only in the Settings Plus pane, so a person who never opens Settings never sees a possible impersonation warning. The plan documents this as a known gap (kosmos#6613). Because it is a security signal, please keep that follow-up near the top of the list. Until it ships, "no news" can mean the person never looked.

[WARNING] engine/cert-watch.js:50: Any `foreign` or `earlier_foreign` entry forces `foreign` with no way to dismiss it. The plan says there is no acknowledge button (kosmos#6613). One stale or false-positive finding, such as an old address's certificate, will therefore show a danger-coloured "someone may pose as this computer" line until the tunnel's report changes. That is acceptable for a first slice, but the wording gives the person nothing to do next.

[NIT] engine/cert-watch.js:55: `failing` is computed and tested, but nothing in the page or the routes reads it. Either use it, for example to word the `unknown` line differently when the last try failed, or drop it.

[NIT] .claude/plans/ctwatch-board-6602.md:42: The Proof section says 9 tests in each new file. I ran engine/cert-watch.test.js and it has 10, all passing. web.plus-cert-watch-6602.test.js also has 10 `test()` blocks (I did not run it). Fix the counts so the plan matches the files.

[NIT] web.plus-cert-watch-6602.test.js:48: There is a stray blank line with trailing whitespace inside the loop.

[NIT] server.js:10532: The cert-watch PUT route only checks that the state dir exists. A computer that has a state dir but is not enrolled can still write `ct-watch-off`. The UI never shows the switch in that case, so this is harmless. A one-line `remote.enrolled()` guard would make the route match the UI.

[NIT] web/index.html:19588: `#plus-status` has `aria-live="polite"` and the new line has `role="status"`. `role="status"` is already polite, so the two announcements can overlap when both change on the same poll. Not a defect, but give the new line a single live-region mechanism.

[STRENGTH]: `certWatchFrom` passes on only a state, counts and times, never a string from the report. A test confirms that an HTML payload does not reach the answer, and the page never builds markup from the report, so XSS from third-party report contents is closed.

[STRENGTH]: The reader rules fail safe. A `clear` is not current once it is two spacings old, or dated that far in the future. A damaged earlier report, a non-parsing file or an unknown state reads `unknown`. Any finding, including one for an earlier address, reads `foreign`. The exact 40 h boundary has its own test, and the tunnel's file names are pinned.

[STRENGTH]: The switch route is person-only (`isViaScreen`, 403 otherwise), so an agent cannot turn the security check off. The route test covers both the 403 and the 200, plus the 400 for a non-boolean. It restores the env var and its temp dir is covered by `tmpscope`, so the temp-dir leak guard is not triggered.

[STRENGTH]: The UI is honest about what is shown and when. A finding is still said when the check is off, with "The check is off." appended. The cannot-confirm sentences are suppressed when Kosmos+ itself is off. The switch label says what it sends and where, and none of the new copy contains an em dash.

[STRENGTH]: `paintPlus` is guarded with a `typeof` check, so page tests that lift `paintPlus` alone still work. The click handler has a busy guard, which a test drives with two simultaneous clicks. The handler does nothing while the switch state is unread, matching the `plus-switch` rule. The live region stays in the page and the text is rewritten only on a change.

#### Iteration 7

Findings

[WARNING] server.js:10532: The new switch route refuses any change that does not come from the screen (`isViaScreen`). The plan explains this as "an agent cannot turn the check off". But the route beside it, `PUT /api/remote {on:false}`, has no such check, and turning Kosmos+ off stops the tunnel, and with it the check. `plusCwSay` then hides the "cannot confirm" sentence while Kosmos+ is off, so an agent can still silence the check without touching this switch. A finding would still be shown. Either reword the plan's claim to "an agent cannot use this switch", or record the gap on kosmos#6613 alongside the other Plus-off gaps.

[WARNING] web/index.html:52363: The `foreign` sentence says someone may be able to pose as this computer, but gives no next step, and nothing outside Settings raises it. The plan states both gaps and gives them to kosmos#6613. They are still the biggest user-facing risk in this change: a security warning that only shows in a pane most people never open, and offers no action when they do. Make sure kosmos#6613 is scheduled, not just filed.

[NIT] web/index.html:52364: The earlier-address sentence reads awkwardly: "a certificate for an address this computer used before, that this computer did not ask for." Dropping the comma, or using "which this computer did not ask for", reads more cleanly.

[NIT] engine/cert-watch.js:68: `setCertWatchIn` decides "set up" by checking that the state directory exists. A computer that used Forget may still have that directory, so it would accept a switch change. This is harmless, since the page only shows the switch on an enrolled computer, but "exists" and "enrolled" are not the same test, and the refusal text says "set up".

[NIT] engine/cert-watch.js:43: A report whose `state` is `foreign` with zero counts stays `foreign` however old it is, while an old `clear` turns `unknown`. Leaning toward showing a finding is the right call for security, but no comment says it is deliberate. One line would stop a later reader from "fixing" it.

[STRENGTH]: No string from the third-party report reaches the board, only a state, counts and times. The line is written with `textContent`, and a test proves an `&lt;img onerror&gt;` payload in `dns_names` never reaches the answer. That covers the XSS risk from report contents.

[STRENGTH]: The reader follows the tunnel's rules, each pinned by a test that can fail. An old `clear` turns `unknown` in both time directions, with a test at exactly 40 hours. A damaged earlier report, a file that does not parse, or a state the board does not know are never read as clear. A sample report shaped exactly as kosmos-relay#459 writes it pins the field names and types.

[STRENGTH]: Turning the check off never hides a finding; " The check is off." is added to it instead. The click handler has a busy guard against double clicks, and a test drives two clicks while one is in flight and confirms only one request is sent.

[STRENGTH]: The switch route uses the same `isViaScreen` and 403 pattern as the other person-only Settings routes. Its test covers four cases: refused without the screen header, accepted with it, a value that is not true or false refused, and the off file written and then removed.

[STRENGTH]: The hooks into the existing page are safe. The `paintPlusCertWatch` call is guarded with `typeof`, so page tests that lift `paintPlus` alone still work. An older server with no `certWatch` hides the line and the switch. The status line always stays in the page, so its first text is announced. The temp directories in both test files are covered by `tmpscope` (server.test.js already loads it), so the suite's temp-dir leak guard is not tripped.

Both new test files pass when run on their own: engine/cert-watch.test.js 10 of 10, web.plus-cert-watch-6602.test.js 9 of 9. I did not run the full suite or a browser, as the review rules forbid. The plan file is `.claude/plans/ctwatch-board-6602.md` and the branch matches it.

#### Iteration 8

Findings

[WARNING] engine/cert-watch.js:50: A `foreign` report stays `foreign` forever, with no age limit and no acknowledge, so a stale or one-off finding keeps the danger line up until the tunnel rewrites its report. The plan records this as a deliberate gap owned by kosmos#6613. Make sure that card exists and names the "dismiss without hiding" design, because until then a person can only silence the line by switching the check off. Even then the finding still shows, with "The check is off." added.

[WARNING] server.js:10532: The new switch route is person-only, but `PUT /api/remote` (`setOn`) is not, and an agent can use it to stop the check by turning Kosmos+ off. The page then also stops saying the cannot-confirm sentences. The plan documents this, and I judge it acceptable for now. The 403 on the new route protects less than it appears to until #6613 closes the other path.

[NIT] engine/cert-watch.js:36: The tunnel can be mid-write when this reads, in which case the report does not parse and the state shows `unknown`. It repaints correctly on the next poll, so the only effect is a brief "cannot confirm" flicker. Say in the header comment that the tunnel writes the report atomically (temp file and rename), if it does. Otherwise the flicker is possible.

[NIT] engine/cert-watch.js:55: `state: 'foreign'` with empty `foreign` and `earlier` lists falls through to the "this computer did not ask for" sentence. That is acceptable, since the tunnel said foreign. The tests do not pin this case.

[NIT] web/index.html:19589: The switch label is long: "While Kosmos+ is on, check the public certificate logs for this computer's address once a day (this sends the address to Cert Spotter)". It sits in a `.fhint` span next to a 42px switch, so it will wrap on a phone. Worth a design-shots check at phone width. The text is honest and plain.

[CONVENTION]: No problems found. The plan file exists and records its decisions with their weakest premises. There are no em dashes in the added lines (grepped for the literal character and all four escape spellings). The new `server.test.js` route test makes a `mkdtemp` dir without removing it, which the run's per-run TMPDIR root in `tools/run-tests.sh` already cleans. It restores `AGENT_WORKFORCE_TUNNEL_STATE` in `finally`.

[STRENGTH]: Nothing from the third-party report reaches the page. Only a state, counts and times pass through, and the route test feeds `&lt;b&gt;x&lt;/b&gt;` as a DNS name to prove it.

[STRENGTH]: `certWatchFrom` never throws. A report that does not parse, a missing `checked_at`, a `clear` that is stale, and a `clear` dated in the future all read `unknown`, and any finding wins over staleness.

[STRENGTH]: The route follows its siblings: `isViaScreen` guard (403 on non-screen callers), a strict boolean check (400 on `"no"`), and the test covers both arms and the effect on the `ct-watch-off` file.

[STRENGTH]: The page side is careful. The live region is never hidden, so its first announcement is not lost. The line is rewritten only when its text changes, so a screen reader does not re-read it on each poll. The switch has `role="switch"`, `aria-labelledby` and `aria-checked`, and an in-flight guard stops double clicks. An older server with no `certWatch` hides the row. The `typeof paintPlusCertWatch` guard keeps the page tests that lift `paintPlus` working.

[STRENGTH]: Both new test files pass (19 of 19, run with `node --test`). The page test names its slice anchors and asserts they are found, so a refactor that moves the code fails loudly instead of testing nothing.

#### Iteration 9

Findings

[WARNING] engine/cert-watch.js:37: The `none` state never goes stale. A check that has never written a report reads `none`, and the page says nothing about it. That covers an installed tunnel that predates ct-watch, and a check that dies before its first write. It stays that way for as long as Kosmos+ is on, while the switch label promises a check "once a day". To the person this looks exactly like `clear`. `clear` goes to `unknown` after 40 h, but `none` has no matching rule. One option: when the computer has been enrolled and Kosmos+ has been on longer than about two spacings, treat a missing report as `unknown`. If the decision is to keep this, the plan should name it as a gap. Today it only says "never-run says nothing".

[WARNING] web/index.html:52361: `unknown` is announced from a single read, and the line is a `role="status"` live region repainted on every 5 s poll. So any one bad read is said aloud as "has not been able to confirm anything lately". Two cases produce such a read. (a) The tunnel's `ct-watch.json` is caught mid-write. That is harmless only if the tunnel writes by temp file and rename, which this repo cannot show. (b) Kosmos+ was off for more than 40 h and has just been turned back on: the old `clear` reads `unknown` until the tunnel's next check. Both are reasoned from source, not measured. It is worth confirming that the tunnel writes atomically, and deciding whether a just-resumed Plus should get a grace period.

[NIT] engine/cert-watch.js:69: `setCertWatchIn` writes the marker with a bare `fs.writeFileSync`. That follows a symlink at `ct-watch-off`, and it does not flush. The #5434 slices moved the repo's other marker saves to flushed writes, and `securewrite.refuseSymlinkTarget` exists for the symlink case. The real risk is small (it is an empty marker and the agents run as the same user), but it differs from its siblings.

[NIT] engine/cert-watch.js:23: `STALE_MS` copies the tunnel's `CHECK_SPACING_SECS` by hand. The test only checks it against itself (40 h), so a change on the tunnel side would not turn anything here red. The comment "change both together" is the only link.

[NIT] engine/cert-watch.js:65: `failing`, `checkedAt` and `beforeRecord` are computed and sent to the page, but no caller uses them. That is fine as groundwork for kosmos#6613, but the plan does not mention it.

[NIT] web/index.html:52396: While a switch change is in flight, nothing tells the person: the switch is not disabled and has no `aria-busy`. The `cwBusy` guard drops a second click silently, so on a slow save the switch looks unresponsive.

[NIT] web/index.html:19590: The switch's accessible name is the whole 130-character sentence, read on every focus. A short name ("Check the public certificate logs") with the rest as `aria-describedby` would be easier to hear. The text is plain and honest, and it says what is sent where.

[NIT] CLAUDE.md: There is no "where things live" row for the new `engine/cert-watch.js`, its two routes and the `#plus-cw-*` markup. Neighbouring Plus features (orgenroll, #5531) have one.

[STRENGTH]: Nothing from the third-party report can reach the page. `certWatchFrom` passes on only an allow-listed state, integer counts and floored times. A test puts `&lt;img onerror&gt;` and `&lt;b&gt;` into the report and asserts that no `&lt;` reaches the answer, and the page writes only through `textContent`. So there is no XSS path.

[STRENGTH]: The reader rules are conservative in the right direction. A finding is never aged out, and any earlier-address finding counts as `foreign`. A damaged, unparseable, unknown-state or stale-in-either-direction (including future-dated) report is never shown as `clear`. Each rule has a control arm in engine/cert-watch.test.js, including the exact 40 h boundary.

[STRENGTH]: The off switch requires the person: `isViaScreen`, so an agent token or a request without a browser's headers gets 403. The route test proves the refusal leaves no `ct-watch-off` file behind. The plan also states the remaining bypass (turning Kosmos+ off through the sibling `PUT /api/remote`) and assigns it to kosmos#6613 instead of hiding it.

[STRENGTH]: Nothing nearby regresses. Both `paintPlus` hooks are guarded with `typeof`. web.plus-stale.test.js lifts a slice that now contains the new block, and its stubs supply `addEventListener` and serve no `certWatch`, so the new code clears the line and returns. That is reasoned from its harness; I was not permitted to run it. The Windows selection entry uses the bare engine name like its siblings, windows-tests-1777 passes (23/23), engine/cert-watch.test.js passes 10/10 and web.plus-cert-watch-6602.test.js passes 9/9, all with exit 0.

[STRENGTH]: I found no em dashes in the added lines. The scan checked for the literal character, the HTML entities and the source escapes, and a control with a real em dash was caught.

#### Iteration 10

Findings

[BLOCKER] web/index.html:19580: This branch changes `web/index.html` (markup, CSS, `paintPlus`), but none of its 10 commits carries a `Browser-check:` trailer and nothing under `docs/browser-checks/` is touched. I counted both: 0 and 0. Repo convention 4 and `kosmos_browser_check_gate` in `tools/run-tests.sh` refuse such a branch. `node tools/bc-pr-select.js` also selects several existing Plus-pane checks for this diff (`render-plus-gate-1615`, `render-plus-asks-signin-4610`, `render-connect-sheet-4637`, `render-org-family-6239`, and others). Either add an assertion for the new line and switch (for example in a Plus check), or add a reasoned `Browser-check:` trailer. I could not run the gate, so this rests on reading the script.

[WARNING] web/index.html:52356: The switch handler only checks `aria-checked` and calls `paintPlus()` after the PUT. Between the click and the repaint the row still shows the old state, and the same handler runs again if the click fires while the 5 s poll repaints. `cwBusy` covers double clicks, but the page gives no pending signal. Low risk, and the sibling `plus-switch` behaves the same way.

[WARNING] engine/cert-watch.js:49: A well-formed report that says `foreign` or `unknown` and is years old keeps its state forever, because only `clear` goes stale. A finding that never ages is intended. For `unknown` it is harmless. However, `lost` has no way to clear from the board (the plan says so), so "could not be read, so something it found may have been lost" stays on screen until the state dir changes. Anyone who has seen it once is stuck with it. The plan records this, but it is a permanent user-facing nag with no exit, so I would not leave the acknowledge for later.

[WARNING] engine/cert-watch.js:36: `failing` is computed and tested, but nothing in `server.js` or the page reads it. It is dead surface on the `GET /api/remote` payload. Remove it, or use it so "has not been able to confirm anything lately" can tell a failing check from a stale one.

[WARNING] engine/cert-watch.js:57: `setCertWatchIn` uses `fs.existsSync(dir)` as "this computer is set up". The state dir can exist on a machine that is not enrolled (for example after leaving Kosmos+), so the PUT can succeed there. The page hides the row in that case, but the route does not enforce it, so the route and the comment in `paintPlus` ("keep the switch off a computer with no state dir") disagree.

[CONVENTION] .claude/plans/ctwatch-board-6602.md:1: The repo convention is `.claude/plans/&lt;branch-name&gt;-&lt;timestamp&gt;.md`. This plan has no timestamp. Other plans in the tree use the same bare form, so this is low severity, but it does not follow the written rule.

[CONVENTION] CLAUDE.md:74: "Where to Find Things" has no row for the new module (`engine/cert-watch.js`, `/api/remote/cert-watch`, `paintPlusCertWatch`). "Finishing up" asks for that table to be updated when you add a module.

[NIT] engine/remote.js:633: `require('./cert-watch')` sits in the middle of the file beside the functions that use it. The top-level requires would be the more usual place.

[NIT] server.test.js:11609: The new route test makes `cw-route-` with a bare `fs.mkdtempSync` and never removes it. `tmpscope` is required at the top of the file, so it is probably swept, but the other `cert-watch.test.js` helper relies on the same mechanism without saying so. The test also depends on the default `req` helper sending no `sec-fetch-site`, which makes the 403 arm pass. A short comment would make that explicit.

[NIT] web.plus-cert-watch-6602.test.js:27: The page tests slice the script by string anchors (`var PLUS_CW_WORDS = {`, `{ const cwSw = ...`, `/* The words of the code box (#729).`). They fail loudly with a clear message when the page moves, which is good, but the third anchor is a comment, so a harmless comment edit breaks the click test.

[NIT] web/index.html:19585: The label is long ("While Kosmos+ is on, check the public certificate logs for this computer's address once a day (this sends the address to Cert Spotter)"). It is honest and says where the address goes. A phone-width check would confirm that it wraps well beside the 42 px toggle.

[STRENGTH]: `engine/cert-watch.js` passes only a state, counts and times to the page, never a string from the report. A third party controls those strings. There is a test that checks no `&lt;` reaches the answer, and a route test with `&lt;b&gt;x&lt;/b&gt;` in the sample.

[STRENGTH]: The reader rules are conservative in the right direction. `clear` goes stale in both directions (a skewed future time also reads `unknown`), a damaged earlier report is never `clear`, and an unparseable file reads `unknown` rather than `none`. `foreign` is never aged out. The tests cover each of these, including the exact 40 h boundary.

[STRENGTH]: The off switch route is person-only (`isViaScreen`, 403 otherwise) and the route test covers both the refused arm and the accepted arm. It also checks the effect on disk, rejects a non-boolean with 400, and removes the off file when switched on again.

[STRENGTH]: The accessibility design is considered. The `role="status"` line stays in the page and is rewritten only when its text changes, so screen readers do not re-read it every poll. The switch has `role="switch"` and `aria-labelledby`, and `paintSwitch` strips `aria-checked` when no state is known. The wording is plain, has no em dashes (grep of the diff found none), and says what is sent where.

[STRENGTH]: The plan is candid about its known gaps: `none` never goes stale, no acknowledge button, and a finding shows only in Settings. Each gap names an owner (kosmos#6613). The plan's test counts (10 and 9) match the files.

#### Iteration 11

Findings

[WARNING] engine/cert-watch.test.js:254: The comment on `TUNNEL_SAMPLE` says it is the report "exactly as the tunnel writes one ... every key it writes". The base sample leaves out `damaged_report_at`, `error` and `error_at`, which are the two keys behind `lost` and `failing`. `error`/`error_at` only appear as ad-hoc additions, and `damaged_report_at` never appears in a tunnel-shaped sample at all. If kosmos-relay#459 uses a different name for either key, the "lost" and "failing" sentences silently never show, and every test here stays green. The fix: put both keys in the sample with the exact names and types from `crates/tunnel/src/ctwatch.rs`, or soften the comment. I could not check the tunnel source from this worktree.

[NIT] engine/cert-watch.js:180: A `ct-watch.json` that exists but does not parse returns `failing: true`. The page then says "has been failing lately, so it cannot confirm anything". But a damaged file is not a failing check, and the tunnel writes atomically, so a later run may be fine. Returning `failing: false` would show the plainer "has not been able to confirm anything lately" sentence, which is accurate.

[NIT] engine/cert-watch.js:215: `fs.writeFileSync(off, '', ...)` follows a symlink. If something has placed a link at `ct-watch-off`, the switch truncates whatever file it points to. The risk is low because the state dir belongs to the same user. Opening with `'wx'` or an O_NOFOLLOW/lstat check first would remove it.

[NIT] web/index.html:52404: A failed change to this switch is reported in the shared `#plus-msg` line, with the same fallback text the Kosmos+ switch uses ("we could not change that"). With two switches in the pane, the person cannot tell which one failed. Naming the certificate check in this switch's fallback text would fix that.

[NIT] web/index.html:19587: The "never hidden" reasoning for the `role="status"` line holds inside the pane, but the line sits in `#plus-flow`. On the first paint after enrolment, `#plus-flow` is un-hidden in the same tick the line gets its text, so a finding that is already there at that moment may not be announced. This edge is acceptable, but the comment states the guarantee more strongly than it is.

[STRENGTH]: The engine passes the page only a state, counts and times, never a string from the third-party report. A test pins this (`no string from the report reaches the answer`), and the server route test feeds `&lt;b&gt;x&lt;/b&gt;` through the real route.

[STRENGTH]: The switch route matches the safety rules of the routes next to it. It is person-only (`isViaScreen`, which also refuses a request carrying an agent token), and it refuses a computer that is not enrolled. The route test checks the 403, the not-set-up 400, the bad-value 400 and both writes of the off file, and confirms the off file is not created on a refused request.

[STRENGTH]: `paintPlusCertWatch` is defined after the `plus-switch` listener, and paintPlus calls it behind a `typeof` guard. So the existing page tests that lift paintPlus up to that listener (`web.plus-tab`, `web.lost-phone`, `web.allow-card`) keep working unchanged.

[STRENGTH]: The click handler follows the #4080 rule: it acts on what the switch showed, and does nothing if the switch had no value yet. It adds a busy guard and `aria-busy`, and tests drive it with two clicks at once.

[STRENGTH]: The browser check now covers the line and the switch, including a clear control, the warning colour and the request the switch sends. `bc-pr-select` picks up the new selectors, and each other browser check that matches this change has its own `Browser-check-surface:` trailer explaining why it is unaffected.

[STRENGTH]: The cert-watch test is added to the Windows `ALSO` list, which is the right list because it is read against `engine/` names. Its 0600 mode check skips on win32.

[STRENGTH]: The plan is thorough: it states the known gaps (no acknowledge, a finding shows only in Settings, `none` never goes stale, an agent can still stop the check by turning Kosmos+ off), names its weakest premise, and routes the gaps to kosmos#6613. The CLAUDE.md row is accurate. I found no em dashes in the added lines.

All three permitted tests pass: `engine/cert-watch.test.js` 10/10, `web.plus-cert-watch-6602.test.js` 9/9 and `engine/windows-tests-1777.test.js` 23/23, each exiting 0. I did not run the new `server.test.js` test or the browser check, because neither was in the allowed set.

#### Iteration 12

Findings

I ran the three allowed test files and all pass (11, 9 and 23 tests). I did not run the browser check or the full suite.

[WARNING] web/index.html:52357: The certificate-check switch can only be reached when `paintPlus` reaches the enrolled branch. A fetch failure or an older server leaves the row hidden, which is correct. But `plusCwSay` treats `plusOn !== false` as on, so `paintPlus` passes `r.on === true` and a missing `on` hides the cannot-confirm sentence. That is the safe direction, but it means an older or partial `/api/remote` reply silences "cannot confirm". Worth a one-line comment, not a code change.

[WARNING] engine/cert-watch.js:42: `none` (no report yet) never goes stale. The plan records this as a decided gap, so it is accepted. A tunnel whose check never writes a report, or whose `ct-watch.json` was deleted, looks the same as a quiet healthy one. The `unknown`-when-the-file-is-unparseable arm only fires when the file exists. This is the main honesty hole in the feature. Keep kosmos#6613 open for it.

[WARNING] server.test.js:11610: The route test changes `process.env.AGENT_WORKFORCE_TUNNEL_STATE` for the whole process. The restore is in a `finally`, which is good. It relies on this file's tests running one at a time and on `STATE_DIR()` reading the variable on each call. Both hold today (it reads on each call, at `engine/remote.js:91`). Any future concurrent test in this file that touches Plus state would race with it.

[NIT] web/index.html:52364: `PLUS_CW_WORDS.off` begins with a space and is appended by string concatenation. That works but is easy to break. Joining two sentences with an explicit separator would be sturdier.

[NIT] web/index.html:19583: Two consecutive HTML comments explain the same markup. The second carries the accessibility reasoning and the first is a summary, so they could be merged.

[NIT] engine/cert-watch.js:27: `STALE_MS` hard-codes the tunnel's 20-hour spacing. The test pins it to 40 h, but only against itself, not against the tunnel repo. The "change both together" test name says as much, so this is acknowledged.

[CONVENTION]: I found no em dashes in the diff, in any of the five spellings. Commit trailers: only the iteration-10 commit carries `Browser-check-surface:` lines. `docs/browser-checks/render-plus-panel-3829.js` also gained the new `plus-cw-*` tokens in its own annotation. The gate looks at the whole range, so this should pass. I did not confirm that by running `bc-pr-select`.

[STRENGTH]: Only counts, a state and times pass from the report to the page. A test feeds `&lt;img onerror&gt;` and `&lt;b&gt;` strings in and asserts no `&lt;` comes out, so there is no XSS path from the third-party text.

[STRENGTH]: The switch route is person-only through `isViaScreen`, which is the same guard its sibling routes use. The server test covers all four outcomes: 403 without a screen header, 400 on a computer that is not set up, 400 on a non-boolean, and 200 with the file written and removed. `setCertWatch` also checks `enrolled()` in the engine, so a leftover state dir does not count as set up.

[STRENGTH]: The reader rules are deliberate and tested with controls. A `clear` aged exactly 40 h, a future-dated `clear`, a lost report and an unparseable file all read `unknown`. A finding is never aged out and is still shown with the check off. A sample shaped as the tunnel writes it pins the field names and types.

[STRENGTH]: On the page, the line is a live region that stays in the page and is rewritten only on change. The warning state does not rely on colour alone, because the text starts with "Warning:". The global `[hidden]{display:none !important}` rule keeps the `display:flex` row correctly hidden. The `typeof paintPlusCertWatch === 'function'` guard keeps page tests that lift `paintPlus` working. The Windows test list gains `cert-watch.test.js`, and the `windows-tests-1777` self-test still passes.

[STRENGTH]: The plan file records each decision with its rejected alternative and weakest premise, and names the follow-up card, kosmos#6613, for each known gap.

#### Iteration 13

Findings

[WARNING] server.js:10540: The person-only gate is `isViaScreen`, and it accepts any request that carries a `sec-fetch-site` header (server.js:21340), whatever its value. A local process that holds no agent token can send `sec-fetch-site: same-origin` itself and turn the certificate check off. This weakness belongs to the existing helper, not to this branch, and the plan already notes the other route to the same result (turning Kosmos+ off). But a security check's off switch is where it costs the most. It is worth one line in kosmos#6613 so that "person-only" is not read as stronger than it is.

[WARNING] engine/cert-watch.js:76: The switch writes or removes `ct-watch-off`, and the route then returns `certWatch()` as if the change has already taken effect. Nothing in this repo shows when the tunnel reads that file: on every check, or only when a session starts. If it is only at session start, turning the check off while Kosmos+ is connected leaves it running until the next restart, and the label ("check ... once a day") gives no hint of that. Confirm against kosmos-relay `ctwatch.rs`. If the file is read only at start, either say so in the label or restart the tunnel when the switch changes.

[WARNING] web/index.html:52381: When a report is `foreign` and also `lost` (damaged earlier report), only the finding sentence is shown. The lost-report fact disappears, and the plan does not decide that case. It is minor because the finding is the stronger message. Either record it as decided or add the lost sentence after the finding sentence.

[NIT] web/index.html:52404: `aria-busy` on a `role="switch"` button is announced inconsistently by screen readers. The real protection is the `cwBusy` guard. Adding `aria-disabled="true"` while a save is in flight would tell assistive tech more reliably that a click does nothing right now.

[NIT] engine/remote.js:635: `require('./cert-watch')` sits in the middle of the file rather than with the module's other requires at the top. It works, but it is easy to miss when someone reads the dependency list.

[NIT] engine/cert-watch.js:35: `certWatchFrom` checks `existsSync(REPORT_FILE)` a second time after the read has failed. Between the two checks the file can be renamed into place, so one poll can say `unknown` instead of `none` for a report that just arrived. This is harmless because the next poll corrects it, but the code catching `ENOENT` from the read itself would answer from a single look.

[NIT] docs/browser-checks/render-plus-panel-3829.js:466: The certificate-check loop mocks `/api/remote`, `cert-watch`, `pending` and `devices`, and leaves the other `/api/remote/*` reads (join, computers) going to the real board. The existing loops above it do the same, so this is consistent. If those routes ever start erroring in the check environment, the "no page errors" assertion here will fail for reasons that have nothing to do with this feature.

[STRENGTH]: Nothing from the report's text reaches the server's reply. Only counts, times and a fixed state pass through, the page shows nothing but fixed sentences, and a test proves no `&lt;` gets into the reply. That closes off XSS from the third-party log answer by design rather than by escaping.

[STRENGTH]: The reader rules match the tunnel's own semantics, and each one is tested both ways: a `clear` goes stale at exactly two spacings (with the control case), a clock in the future also counts as stale, a damaged or unparseable report or an unknown state is never `clear`, and a finding never ages out. A sample shaped like the tunnel's output pins the field names and types.

[STRENGTH]: The UI is careful. A finding is still shown when the check is off, so turning the switch off cannot hide one. The live region is never hidden and is rewritten only when its text changes, so screen readers do not re-read it on every poll. The click acts on what the switch showed, and does nothing if the switch had no value. A busy guard stops double submits, and the page tests drive that guard concurrently.

[STRENGTH]: The tests ran green: `engine/cert-watch.test.js` 11/11, `web.plus-cert-watch-6602.test.js` 9/9, `engine/windows-tests-1777.test.js` 23/23. `cert-watch.test.js` is correctly added to the engine `ALSO` list, and its owner-only mode check skips on Windows. The diff contains no em dashes. The plan file exists and matches what the code does.

#### Iteration 14

Findings

[NIT] engine/cert-watch.test.js:72: The reader's comment says a `clear` dated in the future is "not current either", and the code does check that (`Math.abs(...) &gt;= STALE_MS`). No test sets `checked_at` ahead of now. If someone drops the `Math.abs` back to a plain subtraction, every test here still passes. Add one case with `S + 41 * 3600` that expects `unknown`.

[NIT] engine/remote.js:636: `certWatch()` runs on every `GET /api/remote`, and the Plus pane polls that route. Each call does up to three synchronous fs calls (`existsSync` for the off file, `readFileSync` for the report, and `existsSync` again when the report is unreadable). The files are tiny and the sibling `address()` does the same, so this is acceptable. A short cache would still keep the event loop out of disk I/O on a slow or network-backed home directory.

[NIT] web/index.html:52389: The click handler calls `plusSay('')` before it checks `aria-checked`, so any message from the main Plus switch is cleared when the cert-check switch is clicked. Both switches share one `#plus-msg` box, so a refusal from the main switch disappears on an unrelated click. That matches the #4080 rule the comment cites, so no change is needed. It is worth knowing if the two messages ever need to coexist.

[NIT] web/index.html:19591: The switch label says "check ... once a day", but the tunnel's spacing is 20 hours (`STALE_MS` is two of them). It is user-facing rounding and is honest enough. The two numbers live in different files, so they could drift apart unnoticed.

[CONVENTION] .claude/plans/ctwatch-board-6602.md:61: The Proof section names `node --test engine/cert-watch.test.js` and the other checks, but gives no run results or output. The repo's challenge-loop and plan trail usually expects actual results. The test counts it states (11 and 9) do match the files.

[STRENGTH]: No string from the third-party report reaches the page. `certWatchFrom` returns only a state enum, integer counts and times, and the page writes everything with `textContent`. A test feeds `&lt;img onerror&gt;` and `&lt;b&gt;` payloads and asserts `&lt;` never appears in the output.

[STRENGTH]: The route follows its siblings. `PUT /api/remote/cert-watch` goes through `isViaScreen`, so a request without a browser header or with an agent token gets 403. A non-boolean `on` gets 400, and a computer that is not enrolled gets 400. The route test covers each case, and the 403 case also asserts the off file was not created.

[STRENGTH]: The reader fails safe. A `clear` that is too old, dated in the future, damaged, unparseable, or in an unknown state reads `unknown`, and any finding (including one for an earlier address) forces `foreign`. A finding is still shown when the check is switched off, so the off switch cannot hide one.

[STRENGTH]: Accessibility and wording are handled with care. The live region stays in the tree, so its first text is announced. The switch has `role="switch"`, `aria-labelledby` and `aria-busy` while saving. The finding text begins "Warning:", so it does not depend on colour alone. There is a double-click guard, and the wording has no em dashes (a grep of the added lines found none).

[STRENGTH]: Regression surface is covered. `paintPlusCertWatch` is called behind a `typeof` guard so page tests that lift `paintPlus` alone keep working. The Plus-panel browser check gains a finding, a clear control and an off-with-finding case, and `Browser-check-surface` is updated to match. `cert-watch.test.js` is added to the Windows `ALSO` list with the reason for the owner-only skip. Tunnel file names and the staleness figure are pinned by a test that says to change both repos together.

I did not run `engine/cert-watch.test.js`, `web.plus-cert-watch-6602.test.js` or `engine/windows-tests-1777.test.js`. Nothing else in the review needed a run, and the Windows test selection was judged from reading `tools/windows-tests.js` only.

No blockers or warnings.

#### Iteration 15

Findings

[WARNING] web/index.html:19588: The new `#plus-cw-line` has the class `fhint`, and the global rule `.fhint:empty { display: none; }` (web/index.html:968) takes it out of the layout and the accessibility tree whenever it is empty. The comment above the element says "Never hidden itself: a live region that is out of the accessibility tree when its text arrives is often not announced", but that is exactly what happens: an empty line has `display: none`, so the first warning to arrive may never be read out. Fix: give the line a class other than `fhint`, or add `#s-sec-plus .plus-cw-line:empty { display: block; margin: 0; }` so it stays rendered with no height.

[WARNING] docs/browser-checks/render-plus-panel-3829.js:481: The `inTree` assertion ("the line stays in the page (a live region, so its first text is announced)") only checks the `hidden` attribute (`!line.hidden &amp;&amp; !line.closest('[hidden]')`). It never reads the computed `display`, so it passes while the line is `display: none` (see the finding above). It cannot catch the problem it is named for. The page test's markup regex (web.plus-cert-watch-6602.test.js, last test) has the same blind spot. Assert `getComputedStyle(line).display !== 'none'` on the empty (clear) control as well.

[NIT] web/index.html:11706: `#s-sec-plus .plus-cw-line:empty { margin: 0; }` does nothing, because `.fhint:empty` already sets `display: none`. It only becomes meaningful once the first finding is fixed.

[NIT] .claude/plans/ctwatch-board-6602.md:35: The plan says "The switch says it is saving (`aria-busy`)". `aria-busy` on a button is generally not announced, and no CSS styles `#plus-cw-switch[aria-busy]`, so neither a sighted user nor a screen-reader user is told anything. It works as a click guard, not as feedback. Either reword the plan or add a visual and spoken saving cue.

[NIT] engine/remote.js:635: `require('./cert-watch')` sits in the middle of the module rather than with the other requires at the top. It works, but a reader scanning the top of the file for dependencies will miss it.

[NIT] web/index.html:52365: The foreign-certificate warning ("Someone else may be able to pose as this computer.") gives no next step. The plan records this as a decided gap (there is no support path yet). Noting it because it is the most serious sentence this pane can show.

[STRENGTH]: engine/cert-watch.js passes only a state, counts and times, never a string from the third-party report. That removes the XSS surface by construction, and a test plants markup in `dns_names` and `error` to prove none of it comes through.

[STRENGTH]: The staleness rule cuts both ways (`Math.abs`, with a far-future control), `foreign` is never aged out, and a damaged or unparseable report reads `unknown`, never `clear` or `none`. Each rule has a test that can fail, including the exact-boundary case at 40 hours.

[STRENGTH]: The switch route sits behind `isViaScreen` (person-only) and refuses a computer that is not enrolled. The server test covers both refusals (403 with no screen header, 400 when not set up) and checks the off file on disk in each direction, so it is not just checking status codes.

[STRENGTH]: A finding is still said with the check switched off ("The check is off." is appended), so the off switch can never hide one. Both the page test and the browser check cover this.

[STRENGTH]: Every page call is `typeof`-guarded (`paintPlusCertWatch`, `paintSwitch`), so the existing page tests that lift `paintPlus` keep working. The Windows test list adds `cert-watch.test.js` under the engine `ALSO` list, which resolves to `engine/` correctly.

Verification: `node --test` on engine/cert-watch.test.js (11/11 passed), web.plus-cert-watch-6602.test.js (9/9 passed) and engine/windows-tests-1777.test.js (23/23 passed), all exit 0. The added lines contain no em dash in any of its spellings. The plan file is at .claude/plans/ctwatch-board-6602.md.

#### Iteration 16

Findings

[STRENGTH]: I found no defects in the engine reader, the route, the page wiring or the browser check. The reader passes on only a state, counts and times, so the report's third-party strings never reach the page. A `foreign` result is never aged out, and a `clear` result goes stale in both directions.

[STRENGTH]: `PUT /api/remote/cert-watch` is gated by `isViaScreen` and checks `enrolled()`, as the plan says. The `server.test.js` route test covers the 403, the not-set-up 400, the bad-type 400, and the `ct-watch-off` file being created and removed.

[STRENGTH]: The live-region handling is careful and accounts for the global `.fhint:empty { display: none }` rule. The row is hidden with the `hidden` attribute, and the global `[hidden] { display: none !important }` at line 594 beats the `display: flex` on `.plus-cw-row`. The browser check reads the line's computed display on the clear control.

[STRENGTH]: The changed surfaces are declared in the browser-check surface list. The Windows test selection includes `cert-watch.test.js`, and the owner-only mode assertion is skipped on win32.

[NIT] web/index.html:52401: The switch click handler sets `cwBusy = true` inside the `try`, one line after the guard. It works, but putting it before the `try` is the usual shape and makes the `finally` reset read as paired.

[NIT] web/index.html:19594: The switch label holds an explanatory parenthetical ("this sends the address to Cert Spotter") and reads long as a switch label. It is honest wording, and a screen reader reads it in full through `aria-labelledby`, so it is acceptable. Treat it as copy to revisit at the design review.

[NIT] .claude/plans/ctwatch-board-6602.md:66: The plan says the final head's full-suite run is recorded with the challenge-loop proof, but the file's own proof section covers only the older head 32dfaaca8. Before merge, confirm that run is recorded for the head you are shipping (101eced8).
