---
pre_challenge: true
method: challenge-loop
branch: ctwatch-notice-6613
diff_hash: bffd5514a02d165a191e033d9f254721d232136fb6ced443d70e843a5c25ba1e
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-20T00:28:42Z
iterations: 22
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 22, each run by a fresh blind reviewer. **Converged:** yes. Iteration 22, on b17e41fc, reported NO NEW FINDINGS against the recorded decisions. **Fixed:** every finding from iterations 1 to 21, one fix commit per iteration. **Asked:** 0.

**Provenance:** iterations 1 to 21 ran in this agent's previous session on 2026-10-19, and iteration 22 ran in this one. The reports below are copied from the two Claude Code transcripts.

**Rebases:** after it converged, the branch was rebased twice: onto the rebased #6602, then onto main once #6602 merged (ee19dfef). Each time its own diff kept the same patch-id, 86f1c5c9.

**Validation, measured:**
- Mortals full suite at d88ed1732, on base ee19dfef: 22319 tests, 22002 passed, 0 failed, 317 skipped. Recorded clean.
- Browser check render-plus-panel-3829.js on this Mac, on the page from 0648c996, which is unchanged since: 180 PASS, 0 FAIL, 0 SKIPPED. That includes every certificate scenario and the lost report with Got it.
- Focused tests at d88ed1732: 60 of 60.

**Still open, held by a comment on kosmos#6613:** the VoiceOver check of the notice.

### Per-Iteration Breakdown

The reviewers' own reports, with paths made repo-relative and em dashes replaced for house style. Nothing else is edited.

#### Iteration 1

Findings

[BLOCKER] web/index.html:12673: The new `#cwcard` sits between `#askcard` and `#conn`, and that breaks every adjacent-sibling rule built on `#askcard[hidden] + #conn`. Those rules are at lines 1344 (#conn clears the floating stack), 1351 and 1356 (#5140: on a phone with an empty board, `#boardbar` and New agent move below the stack) and 1361 (the talk view's #conn gap). On origin/ctwatch-board-6602 `#conn` came straight after `#askcard`; now none of these selectors match, even when `#cwcard` is hidden. So a floating notice can cover the Claude-unreachable line, and can cover New agent for a brand-new user on a phone. docs/browser-checks/render-update-toast.js (the #5140 widths loop) and render-conn-top-3708.js measure exactly this and should go red at the release cut. Fix: change the selectors to `#askcard[hidden] + #cwcard[hidden] + #conn`, plus a variant for a showing `#cwcard`, or move `#cwcard` after `#conn`.

[WARNING] web/index.html:1340: The surface gate (tools/lib/browser-check-surface-gate.sh, run in tools/run-tests.sh) maps the token `askcard` to docs/browser-checks/render-connect-sheet-4637.js. This branch adds lines containing `askcard` (`#askcard, #cwcard {...}`, `class="askcard" id="cwcard"`, the `.asknote` rules) but does not update that check, and no `Browser-check-surface: render-connect-sheet-4637.js &lt;reason&gt;` trailer exists anywhere on the branch. 6602's trailers cover 4610 and others, not 4637. The full suite should refuse this branch.

[WARNING] web/index.html:5024: `#cwcard` reuses the `.askcard` look but not the rules keyed on `#askcard` by id. In the consolidated layout it has no `margin-left/right: var(--space-8)`, so it renders flush to the window edges, which is the defect #4637 fixed for `#askcard`. It is also missing from the keyboard-up hide rule (12034) and the talk-view margin-bottom rules (3481, 11904), so it can crowd the composer on a phone.

[WARNING] web/index.html:2026: Dismissing the notice hides the card while the focused close button is inside it, so keyboard and screen-reader focus falls to `&lt;body&gt;`. The request notice it copies (`askAct`, `note-dismiss`) moves focus to the current view's tab or the menu button. The same happens with Got it on the Plus pane (`ackBtn` is hidden on repaint while focused), with no focus target.

[NIT] web/index.html:2026: The notice only repaints on the 30 s `pollCwNote` or on `paintPlus`. Unlike `paintAsk`, it is not hooked into `syncPlusChrome`, so after leaving Kosmos+ an undismissed finding takes up to 30 s to come back.

[NIT] web/index.html:2026: The wording "A certificate for this computer's address was issued that this computer did not ask for." reads awkwardly, because the relative clause is far from its noun. It is also softer than the Plus pane's "Warning: ... Someone else may be able to pose as this computer." Something like "Warning: a certificate was issued for this computer's address that this computer did not ask for." would match the pane's urgency.

[NIT] web/index.html:19598: The accessible name "Got it" says nothing about what it acknowledges. An `aria-describedby="plus-cw-line"` would tie it to the lost-report sentence.

[NIT] web.cert-notice-6613.test.js:363: The Got it test slices `paintPlusCertWatch` without `paintCwNote`, so the new call `paintPlusCertWatch -&gt; paintCwNote` (guarded by `typeof`) is never exercised. Removing that line would not turn any test red.

[NIT] server.test.js:11643: The ack-lost route test does not cover the agent-token shape (the sibling test file's "Third shape") or a computer that is not set up. Both are refusal arms the route claims.

[NIT] engine/cert-watch.js:106: A report whose `state` is `foreign` with empty lists and zero overflow gets `key: null`. The Plus pane then says foreign while the notice never shows. This is probably unreachable from the tunnel, but nothing records that it is.

[STRENGTH]: Only a 16-hex digest leaves the module, and the page re-checks `/^[0-9a-f]{16}$/` before using it. The sentence is set with `textContent`, so no third-party string reaches the DOM, and a test asserts that the key is not written into the page.

[STRENGTH]: The lost-report acknowledgement is keyed to the exact marker value, refuses any other marker, and is kept in the board's own file, so the tunnel's report is never edited. A later loss is said again, and the tests cover both the refused marker and the later loss.

[STRENGTH]: The new route matches its sibling's auth (`isViaScreen` plus enrolled), and the server test checks the 403 and the 400 before the 200. The three permitted test files pass: 13/13, 6/6 and 9/9, each with exit code 0. The added lines contain no em dash in any of the five spellings (checked with a control that matched).

#### Iteration 2

Findings

[BLOCKER] web/index.html:2151: The empty-slot rule `#utoast-slot:empty, #uabort-slot:empty, ... { display: none; }` was not extended to `#cwnote-slot`, and the branch adds no CSS for it. The slot is a visible, empty flex item in `.topnotes`, which has `gap: 8px`, and the rule's own comment says "An empty slot is a flex item and would spend one trailing gap". Whenever any other notice shows and no certificate finding exists (nearly every time), the stack gets a spurious 8px leading gap and every notice is pushed down. `topnotesTrack` also feeds that into `--topnotes-h` and `--topnotes-clear`. The commit trailer says the stack `render-login-expiry-3532.js` measures "is unchanged"; that claim is false as written, and that check measures the stack's gaps and edges. Add `#cwnote-slot:empty` to the rule, and have the browser check assert that a login notice's top offset is the same with and without the slot.

[WARNING] web/index.html:52456: `paintCwNote` takes only the `cw` it is handed, and the one place that feeds it when the Plus pane is on screen is `paintPlusCertWatch`. When `cw` is null or invalid, that function returns early before calling `paintCwNote`, so `CW_NOTE.last` keeps the old finding. `syncPlusChrome` then repaints a stale notice when the person leaves Kosmos+, until the next 30-second poll corrects it. This is minor but real. Call `paintCwNote(null)` in the early-return branch.

[WARNING] web/index.html:52467: `role="status"` sits on content that is inserted along with its own container via `innerHTML`. Many screen readers do not announce a live region that arrives already filled. The comment claims "announced, not re-read" behaviour that nothing here tests, and the `&lt;b&gt;` text is set after insertion (`slot.querySelector('.utxt b').textContent = head`), which does help. Confirm that the sibling notices (`paintLoginAdvisories`) use the same pattern, or insert an empty region first and fill it on the next tick.

[WARNING] web/index.html:52485: "Review" calls `cwNoteDismiss()`, so it permanently puts that finding set away in `localStorage` before the person has read anything on Kosmos+. This is the plan's stated decision, but it means the only floating alert for a possible impostor certificate is gone after one click. The Plus pane line stays, which limits the harm. If the person navigates away immediately, nothing re-raises the alert. Consider dismissing only on the close X, and on Review dismissing only once the Plus pane has been seen.

[WARNING] web/index.html:52489: After "Review", no keyboard focus is moved. The button that had focus is removed from the DOM, so focus falls to `body`, while the close path does move focus. Send focus to the `#plus-flow` heading, or to the cert line, after `settingsGo('plus')`.

[CONVENTION] web.cert-notice-6613.test.js:22: The notice tests run against a hand-rolled fake DOM. Its `querySelector()` ignores its selector, `classList` is a stub, and `firstChild` is a stand-in. The tests prove the logic runs, not that the markup is right. The CSS gap defect above passes every test here. The only real coverage is the browser check, which was not run in this review. Add a static assertion that every slot in `#topnotes` has a matching `:empty` rule.

[CONVENTION] engine/cert-watch.js:78: `ackLostIn` and `certWatchFrom` read the ack file with `Number(...)`. An empty or garbage file gives `0` or `NaN`, which never equals a marker, so it fails safe. OK. But the ack file name is not in the existing "file names are the tunnel's" test, which is correct since it is a board-owned file. No change needed; the board-owned status could be stated in that test's comment.

[NIT] web/index.html:52446: The `.slice(-50)` cap on dismissed keys is not covered by any test.

[NIT] web/index.html:19594: The "Got it" button has `aria-describedby="plus-cw-line"`, but when the line also carries the foreign-finding sentence ("Someone else may be able to pose as this computer") the button reads that whole warning every time it is focused. That is noisy. An `aria-label` such as "Got it: earlier report could not be read" would be shorter and clearer.

[STRENGTH]: The findings key is a 16-character hex digest, built from each finding's own hash with overflow counts included and sorted. Only the digest reaches the page, and `paintCwNote` re-validates it as `/^[0-9a-f]{16}$/` before use. Nothing from the third-party report reaches the DOM, so the XSS surface is closed. The test with `key: '&lt;b&gt;x&lt;/b&gt;'` exercises exactly that.

[STRENGTH]: The `ack-lost` route is `isViaScreen` and enrolled-only, as the switch is. `ackLostIn` re-reads the tunnel's report and refuses any marker that is not the current one, so a stale acknowledgement can never cover a later loss. The server test covers the 403 (not from the screen), the 400 (wrong marker) and the 200 path.

[STRENGTH]: The tunnel's file is never written by the board. The acknowledgement lives in a separate board-owned file with mode 0600, and the plan states why and what was rejected.

[STRENGTH]: The plan names its weakest premise (the dismiss record is per browser) and follows the existing #6315 dismiss ruling. Wording is plain, honest and free of em dashes. The browser check includes a clear-check control (a clear check raises no notice) and asserts the stack ordering.

I did not run the tests or a browser, as instructed.

#### Iteration 3

Findings

[WARNING] docs/browser-checks/render-plus-panel-3829.js:1: The `Browser-check-surface:` line now lists `plus-cw-ack`, but no scenario in this check shows, reads or clicks Got it. Every certificate mode stubs `lost: false, lostAt: null`, and the only matches for `plus-cw-ack` in docs/browser-checks are on the annotation line. The surface gate reads this line as "a browser check asserts this token", so Got it now looks covered in a real browser when nothing checks it. Its show/hide is covered only by the vm test in web.cert-notice-6613.test.js, and the click handler (POST, repaint, focus) is not covered anywhere. Fix: add a `lost` scenario that checks Got it shows, POSTs `{at}` to a stubbed `/api/remote/cert-watch/ack-lost`, then hides with focus on `#plus-cw-line`, with a control where nothing was lost. If that is not wanted, drop `plus-cw-ack` from the annotation.

[WARNING] web/index.html:52511: After Got it succeeds on a report whose check is otherwise current and clear, `plusCwSay` returns '' and the line is emptied. Focus then goes to `#plus-cw-line`, which is focusable but empty (`.plus-cw-line:empty` stays `display: block`). A screen reader user lands on a blank status paragraph, and nothing tells them the acknowledgement was saved. Either say a short fixed confirmation through `plusSay`, or send focus to a stable target (the switch row) when the line is empty.

[WARNING] web/index.html:52511: The Got it click handler has no test. A failed POST should leave Got it shown with the error said, and a success should hide it and move focus. web.cert-notice-6613.test.js tests only `paintPlusCertWatch`'s show/hide of the button, so a broken handler (wrong route, wrong body key, focus lost) would pass every node test on this branch.

[NIT] web/index.html:52462: The notice's "unchanged, not rewritten" shortcut keys on the finding key alone. `findingKey` mixes `foreign` and `earlier_foreign` into one id set, so a finding that moves from this address to an earlier one keeps the same key, and the card keeps its stale headline ("this computer's address"). Including `cw.foreign &gt; 0` in the shortcut's comparison would close it.

[NIT] web/index.html:52464: "Warning: a certificate was issued for an address this computer used before, that this computer did not ask for." reads awkwardly. The pane's own wording ("a certificate, which this computer did not ask for, for an address this computer used before") is clearer, and reusing its structure would keep the two surfaces consistent.

[NIT] web/index.html:52466: The comment says the words are "filled after the card is inserted" (#3532's pattern). Only the `&lt;b&gt;` headline is set afterwards; the `&lt;small&gt;` line is in the same `innerHTML` that creates the `role="status"` region, so some screen readers will announce only the headline. The plan already admits this was not measured with a screen reader, so this is just a note that the comment slightly overstates the pattern.

[NIT] web/index.html:52517: `setInterval(pollCwNote, 30000)` polls `/api/remote` from every open tab, including background ones, with no visibility check. The route is cheap (it reads files only), so this is a small cost, not a defect.

[NIT] server.test.js:11643: The route test does not check the not-enrolled refusal (`ackCertWatchLost` returning 400 on a computer that is not set up). The switch's equivalent refusal is checked in engine/cert-watch.test.js, but the board-level enrolled gate for ack-lost is not checked anywhere.

[STRENGTH]: Only a 16-hex digest leaves `findingKey`, and the page drops any key that is not exactly 16 lowercase hex. The notice writes only fixed sentences, and the one dynamic headline is set through `textContent`. Nothing from the third-party report reaches the DOM.

[STRENGTH]: The new route matches its sibling `PUT /api/remote/cert-watch`: the same person-only `isViaScreen` check, the same enrolled gate (in `remote.ackCertWatchLost`), and the same body-parse and error shape. As a POST it also goes through the global `crossSiteWrite` guard. `ackLostIn` refuses any marker other than the report's current one, so acknowledging one loss can never quiet a later one, and the tunnel's own file is never edited.

[STRENGTH]: The tests can fail and include controls. The engine test checks a non-matching marker is refused and leaves no ack file, and that a later marker is said again. The page tests include controls (on Kosmos+, a clear check, a non-hex key). A structural test checks that every slot in `#topnotes` has an `:empty { display: none }` rule. The browser check checks the empty slot's computed `display: none` in the clear control. All three allowed test files pass locally: 13/13, 9/9 and 9/9.

[STRENGTH]: `syncPlusChrome`'s call into the notice is guarded with `typeof`, and the `var CW_NOTE` declaration is hoisted, so an early call is safely skipped. The 6602 test's end anchor was moved to the new block's opening comment, so that test's vm slice does not run the new top-level polling code.

#### Iteration 4

Findings

[WARNING] web/index.html:52440: `paintCwNote` never checks `cw.on`, so a person who switched the certificate check off still gets the red "Warning" card, with the line "Kosmos+ checks the public certificate logs for this computer." That sentence is false for them. The Plus pane handles this: `plusCwSay` appends `PLUS_CW_WORDS.off` when the check is off. The pane also gates the Got it button on `cw.on === true &amp;&amp; plusOn !== false`. The card has no such gate and no "check is off" wording. The tunnel's last report stays `foreign` while the check is off, so the card keeps appearing. A new finding key is also impossible while the check is off, so that card can only be dismissed, not replaced. Either hide the card when `cw.on` is false, or say the check is off. Add a test for the off case. The `FOUND` fixtures in the new test all use `on: true`.

[WARNING] web/index.html:52503: Review calls `cwNoteDismiss()` before the person has read anything. It then calls `showTab('settings'); settingsGo('plus')` and focuses `#plus-cw-line` after `paintPlus()` resolves. The pane's line is rewritten only after `paintPlus` runs. If `paintPlus` fails or the pane stays unmounted (Plus not set up on screen, `#plus-flow` hidden), focus goes nowhere and the finding is already put away for that key. The plan accepts that the Plus pane line is "never put away". But after Review the only other surface is gone, and on a pane that did not render, nothing shows the finding. Consider dismissing only once the pane line is actually non-empty and visible.

[NIT] server.js:10548: The new `ack-lost` route reuses `isViaScreen`. That helper is true for any request carrying a `sec-fetch-site` header, including `cross-site`. `readBody` ignores content-type, so a cross-site `text/plain` JSON POST can pass it if it guesses `at`. The impact is small (it only silences a notice, and only for the exact current marker). It is the same weakness as the sibling PUT, and the plan already lists `isViaScreen` as a speed bump. The route tests only the no-header case for 403. Worth a one-line mention on kosmos#6613.

[NIT] engine/cert-watch.js:93: `ackLostIn` uses a plain `writeFileSync`, not a temp-file write plus rename like the other board-owned state writes. A concurrent `certWatchFrom` read can see an empty file, so `Number('')` is 0 and the lost sentence flickers back for one poll. It is harmless, but a rename makes it atomic.

[NIT] web/index.html:52452: The `paintCwNote` early-out `CW_NOTE.sig === sig &amp;&amp; slot.firstChild` means the card is never repainted for an unchanged finding. That is correct for announcements. But `cwNoteAway()` is only re-read on the next different paint, so a key dismissed in another tab while this card is showing stays up until the finding changes. The test "put away in another tab is honoured at the next paint" only covers a paint that starts from an empty slot.

[CONVENTION] .claude/plans/ctwatch-notice-6613.md:41: The Proof section says the screen-reader behaviour was "not separately measured". That is honest. But the notice's role=status is filled after insert and the Got it flow moves focus onto a status region with `tabindex=-1`. An announcement check is still open. The plan should say who owns it.

[STRENGTH]: The finding key is a 16-hex digest of finding hashes and is validated against `/^[0-9a-f]{16}$/` before use. Report strings never reach the page, so there is no XSS path from the tunnel's file. The card's headline is set with `textContent`, and a test checks the key is never written into the HTML.

[STRENGTH]: `ackLostIn` is keyed on the marker value and refuses any marker that is not the report's current one. It writes only the board's own file, so a later loss is announced again and the tunnel's report is never edited. The unit test, the route test (403 without the screen header, 400 for a wrong marker, 200 and `lost:false` for the right one) and the browser check all exercise that path.

[STRENGTH]: Integration is careful. `#cwnote-slot` is in the `:empty` rule, so the floating stack takes no room. The 6602 test's slice anchor was moved to match. The commit trailers name the three browser checks the new card could affect. The 13, 11 and 9 test files all pass when run. The new browser scenarios include a control: a clear check raises no card.

#### Iteration 5

Findings

[BLOCKER] web/index.html:52490: Review never puts the finding away. Clicking Review calls `showTab('settings')` and then `settingsGo('plus')`. Both run `syncPlusChrome()` (lines 25870 and 43455), which calls `paintCwNote(CW_NOTE.last)`. By then `plusOnScreen()` is true, so `paintCwNote` takes its on-Plus branch and sets `CW_NOTE.key = null`. `paintPlus()` then calls `paintPlusCertWatch` and `paintCwNote(cw)` while still on Plus, which nulls the key again. When the `.then` callback runs `cwNoteDismiss()`, it hits `if (!CW_NOTE.key) return;` and nothing is stored, so the notice comes back as soon as the person leaves Kosmos+. That is the opposite of the #6315 ruling the plan cites. Fix: save the key before navigating (`const shownKey = CW_NOTE.key;`) and have `cwNoteDismiss` take that key as an argument rather than reading `CW_NOTE.key` after the repaints.

[WARNING] web.cert-notice-6613.test.js:136: The test "Review puts the finding away only once the pane says it" passes only because its stubs make `showTab`, `settingsGo` and `paintPlus` no-ops that never call `paintCwNote` or `syncPlusChrome`. The real call chain that clears the key is never modelled, so the test certifies the blocker above. Its stubbed `paintPlus` should call `ctx.paintCwNote` with `plusOnScreen` returning true, as the real page does.

[WARNING] docs/browser-checks/render-plus-panel-3829.js:497: Given the blocker, the check "Review opens Kosmos+ and puts that finding away" (it expects `localStorage` `kosmos.cwnote.dismissed` to be 16 hex) should fail on this HEAD. The plan's Proof section reads as if this scenario passed. Either the browser check was not run on the final commit, or the claim is unmeasured. Re-run it after the fix and record the result.

[WARNING] web/index.html:52478: `pollCwNote` treats one failed fetch (for example a board restart, or a non-JSON reply) as "no finding": it calls `paintCwNote(null)`, which wipes a showing warning and resets `CW_NOTE.sig`. The next good poll rewrites the card, so a security warning flickers off for up to 30s and its `role="status"` words can be read out again. On `r === null`, keep the last state (return without painting).

[WARNING] web/index.html:1484: On narrow screens (`max-width: 720px`) `.utoast .utxt small` is hidden. Only `.login-adv` and `.reboot` are exempt. So on a phone the cwnote card drops "The certificate check is off; this is what it found before.", which is the only place the notice discloses that the check is off. Add `.utoast.cwnote .utxt small { display: block; }` beside the other two exemptions, as #5018 and #5359 did.

[NIT] web/index.html:52464: Every time the person leaves Kosmos+, the card is rebuilt and announced again, because the on-Plus branch clears `CW_NOTE.sig`. That may be intended (a reminder), but no comment says so.

[NIT] engine/cert-watch.js:118: The temp path `ct-watch-lost-ack.tmp` is fixed. Two acks at the same moment from two tabs race on one temp file, and one can fail with ENOENT, which shows the person "we could not save that". A per-call suffix (for example the pid plus a counter) avoids this.

[NIT] engine/cert-watch.js:77: The ack file is read on every `certWatch()` call, and `/api/remote` is now polled every 30s by `pollCwNote` from every open tab, on top of the existing 5s Plus tick. The cost is small, but the `GET /api/remote` load per open tab rises.

[NIT] .claude/plans/ctwatch-notice-6613.md:44: The Proof section says the browser check covers "Review opens Kosmos+ and puts it away". It should say whether that was run on the final commit (see the blocker).

[STRENGTH]: The key is a 16-hex digest. The page checks that shape with `/^[0-9a-f]{16}$/`, never writes it into the markup, and builds the card only from fixed sentences, with the headline set through `textContent`. Nothing from the third-party report reaches the DOM.

[STRENGTH]: `ackLostIn` refuses any marker other than the current `damaged_report_at` and writes atomically (temp file, then rename). The board keeps its record in its own file and never edits the tunnel's report, so a later loss is always said again. The engine tests cover the refused marker, the quieted marker and the later loss.

[STRENGTH]: The new route matches its sibling switch: person-only through `isViaScreen` (checked after the body is read, so a token in the body counts), enrolled-only, and the same error shapes. The server test checks the 403, the 400 for a wrong marker, and the 200.

[STRENGTH]: The static test checks that every `#topnotes` slot is in the `:empty { display: none }` rule. It guards the whole class of slots, not just the new one.

[STRENGTH]: The re-anchor in web.plus-cert-watch-6602.test.js is correct, and all three permitted test files pass (13, 13 and 9 tests).

#### Iteration 6

Findings

[WARNING] web/index.html:52470: The Review handler only puts the finding set away and moves focus if `#plus-cw-line` has text after `paintPlus()`. The notice card has already been removed (`cwSlot.textContent = ''`) and the Review button that held focus is gone. When the pane doesn't paint the sentence, focus drops to `body` and nothing announces the failure. The notice does come back at the next 30s poll, so the finding isn't lost. The else branch should send focus somewhere stable, such as the pane heading or `#plus-cw-switch`. A rejection from `paintPlus()` also leaves the `.then` unhandled and focus lost.

[WARNING] web/index.html:52470: The "pane says the finding" test is `line.textContent` being non-empty. It does not check that the line says the foreign-certificate sentence. A lost or unknown sentence on the same pane would also dismiss the finding key. This can only happen if `plusCwSay` ever gives non-foreign text while `cw.state === 'foreign'`, which it doesn't today. Keying the check on `line.dataset.state === 'foreign'` would make it match what the comment claims.

[WARNING] .claude/plans/ctwatch-notice-6613.md:44: The plan says the browser check (`render-plus-panel-3829.js`) was NOT YET RUN on the final commit. This branch changes the floating stack, the slot order and focus handling, and browser-check gates read the `Browser-check-surface:` trailers. Run the check and record the result before the PR merges. The unit and page tests pass (13, 14 and 9, which I ran), but they stub `showTab`, `settingsGo` and `paintPlus` rather than the real repaint chain.

[WARNING] web/index.html:52485: `pollCwNote` fetches `/api/remote` every 30s from every tab and every view, including remote phones. That route runs `remote.status()` and `remote.read()` on each call, which is more than the notice needs. It is probably cheap, but it adds permanent polling load on a route the Plus pane already polls every 5s. The notice could reuse the status tick's result or poll less often. At minimum, skip the poll while the tab is hidden.

[NIT] web/index.html:52420: Dismissals are per browser in `localStorage` and capped at 50 keys. The plan states this as accepted. Closing the notice on one device leaves it showing on another, and the board-side record exists only for the lost report. Fine as designed, but worth a line in the user-facing docs.

[NIT] web/index.html:52500: Got it on a failed POST calls `plusSay(..., 'switch')` and then `paintPlus()`. If the 400 means "that report is no longer the one" (the marker changed), the repaint brings the new `lostAt`, so a second click works. This is correct, but nothing tests the 400 path in the page tests.

[NIT] engine/cert-watch.js:78: `acked !== damagedAt` compares `Number(...)` of the file with `secs(...)`. A corrupt ack file gives `NaN`, so the loss is said again. That is the safe direction and is correct. A one-line comment saying so would help.

[STRENGTH]: The ack route reuses `isViaScreen`, the same person-only check as the switch. It validates `at` as a positive integer and re-reads the report so an acknowledgement can't cover a later loss. The tunnel's file is never edited, and the write is temp file plus rename. The server test covers the 403, 400 and 200 cases.

[STRENGTH]: The finding key is a 16-hex digest, and the page accepts only `^[0-9a-f]{16}$`. The notice writes only fixed sentences, with the headline set through `textContent`. No text from the third-party report reaches the DOM, so there is no XSS path.

[STRENGTH]: The notice follows the stack's conventions. It has its own slot with the `:empty` rule, `role="status"` on the words only, focus sent to the same places #5018 uses on close, and a repaint guard on `sig` so a screen reader isn't re-read each poll. It captures `shownKey` before the repaint that clears it, and a mutant test covers that.

#### Iteration 7

Findings

[BLOCKER] web/index.html:2153: The full-suite browser-check surface gate (tools/lib/browser-check-surface-gate.sh, called from tools/run-tests.sh) will fail on this branch. The edited `:empty` rule appears as both a removed and an added line, and it contains `#uoffline-slot:empty`. `uoffline-slot` is a declared surface token of `docs/browser-checks/render-phone-offline-718.js` and `render-restart-screen-4343.js`. I matched those tokens against the changed lines with the gate's own whole-token pattern and both checks are HITs. Neither check is updated anywhere in origin/main...HEAD (the only check touched is render-plus-panel-3829.js), and no `Browser-check-surface:` trailer names either of them. The trailers cover only render-login-expiry-3532, render-phone-taps-5218, render-plus-bar-3837 and the four from 6602. Fix: add a per-check trailer for each of the two checks. The reason is real: the new slot is first in the stack and empty without a finding, so the offline notice those checks measure keeps its place.

[WARNING] web/index.html:52524: Got it sets `ackBtn.disabled = true` while the POST is in flight. A focused button that becomes disabled loses keyboard focus in current Chromium and Firefox, so focus falls to the body. On a refused or failed Got it the button stays visible, but focus has already gone, and the handler's focus code only runs on success. The sibling switch handler a few lines above deliberately uses `aria-busy` plus a busy flag instead of `disabled`, so focus survives. Use the same pattern here, or put focus back on the button after a refusal.

[WARNING] web/index.html:52540: `setInterval(pollCwNote, 30000)` and the immediate `pollCwNote()` run on every board page, enrolled or not, for the whole life of the tab. That is a `GET /api/remote` every 30 s from each visible tab, even for a person who never set up Kosmos+, on top of the pane's own poll while on Kosmos+. It is cheap per call, but it is a new standing load on every board. Also, `document.hidden` only skips a poll: there is no `visibilitychange` re-poll, so a finding that arrives while the tab is in the background can wait up to 30 s to show after the tab comes back. Consider skipping the poll while not enrolled (backing off after an `enrolled: false` answer), and polling once on visibilitychange.

[NIT] web.plus-stale.test.js:58: That test slices from `/* #1011. The panel showed` to `/* The words of the code box`, so its slice now contains the whole new notice block. The block's load-time side effects run inside that harness: the click listeners, `setInterval`, and an un-awaited `pollCwNote()` that calls `paintCwNote`. It passes today only because its fixtures carry no `certWatch`. If a future fixture adds a finding key, `slot.querySelector` does not exist on that harness's elements, which gives an unhandled rejection that does not point at this code. Re-anchoring this test's end at `/* kosmos#6613: the notice for a finding` (as web.plus-cert-watch-6602.test.js was re-anchored) keeps the two concerns apart.

[NIT] web/index.html:52511: Closing the certificate notice always sends focus to the K mark, even while other notices are still in the stack. The login notice keeps focus on a remaining notice's close button first. It is consistent with #5018's fallback order, but not with the "stays on the notices while any is left" behaviour of its nearest sibling.

[NIT] web/index.html:52536: `plusSay('Noted.')` stays in `#plus-msg` until something else writes there, so "Noted." can sit on the pane long after the moment it described. Consider clearing it on the next repaint that has nothing new to say.

[NIT] engine/cert-watch.test.js:155: The earlier-address key case writes `state: 'clear'` with an `earlier_foreign` finding. The engine correctly turns that into `foreign`, but the fixture is not a report shape the tunnel writes. Using `state: 'foreign'` there would make the fixture match reality without weakening the assertion.

[STRENGTH]: Nothing from the third-party report reaches the page. The notice gets only a 16-hex digest, the page checks it against `/^[0-9a-f]{16}$/` before using it, the markup is fixed strings, and the headline goes in through `textContent`. The page test also asserts the key is never written into the DOM.

[STRENGTH]: The new route matches its PUT sibling: `isViaScreen`, then the enrolled check in remote.js. As a POST it also passes the global `crossSiteWrite` origin guard. `ackLostIn` refuses any marker that is not the report's current one, and writes atomically (temp file, then rename). An unreadable acknowledgement record makes the loss be said again, which is the safe direction.

[STRENGTH]: Review captures the key before opening Kosmos+, and only puts the finding away once the pane's line actually says it. The page test models the real repaint that clears `CW_NOTE.key`, and has a control arm where the pane did not paint. The empty-slot test reads every slot in `#topnotes` against the `:empty` rule, so a future slot cannot quietly add a gap.

[STRENGTH]: Ran the three permitted files (exit code and tally checked): engine/cert-watch.test.js 13/13, web.cert-notice-6613.test.js 14/14, web.plus-cert-watch-6602.test.js 9/9. No em dashes in the added lines, in any of the five spellings (the scan's control arm returned 1).

#### Iteration 8

Findings

[WARNING] web/index.html:52470: The notice is raised only for `state === 'foreign'`. A lost report (`lost`, so findings may be missing) never reaches the floating stack, and its only sign is the sentence on the Kosmos+ pane. The plan decides this, but then "Got it" is the only lost-report handling outside Settings, and a person who never opens Kosmos+ never learns the report was damaged. Say so explicitly in the plan or the PR as a known gap.

[WARNING] web/index.html:52511: Review puts the finding set away permanently (the key goes into `localStorage`) as soon as the pane's line shows it. The comment at line 372 calls leaving Kosmos+ "a reminder, by design". For a finding the person only glanced at, there is no reminder after Review, and the card returns only if the finding set changes. This follows the #6315 ruling, but it means a person who pressed Review and did nothing else will not see the card again.

[NIT] web/index.html:52520: On a failed `/api/remote` read, `paintPlus` returns early, so `paintPlusCertWatch` is not called and `CW_NOTE.last` is kept. That is correct. However, a pane repaint where `r.certWatch` is absent (a board older than this branch) calls `paintCwNote(null)` and drops the card until the next poll. That is harmless but untested.

[NIT] engine/cert-watch.js:123: `ackLostIn` leaves `ct-watch-lost-ack.*.tmp` files only if the process dies between write and rename, and nothing cleans them up. This is negligible.

[NIT] web.plus-stale.test.js:60: `cwAt &gt; 0 ? cwAt : …old anchor` silently falls back to the old end if the new comment is renamed. The later `end &gt; start` assert does not catch that fallback. Prefer a hard assert that `cwAt &gt; 0`.

[NIT] web.cert-notice-6613.test.js:226: The slot-coverage test slices the stack at the literal `'&lt;/div&gt;\n  &lt;/div&gt;'`, which depends on exact whitespace in the markup. A reindent would make the test pass vacuously or fail confusingly. The `slots.length &gt;= 7` assert partly guards this.

[NIT]: I could not run `web.plus-stale.test.js` from my working directory, because it reads `web/index.html` by a relative path and failed with ENOENT. I did not re-run it from the worktree. The other three allowed test files pass: engine/cert-watch.test.js 13/13, web.cert-notice-6613.test.js 15/15, web.plus-cert-watch-6602.test.js 9/9.

[STRENGTH]: The finding key is a hex digest, and `paintCwNote` rejects anything that is not 16 hex characters. No text from the tunnel's report reaches the page, and there is a test for both.

[STRENGTH]: The Review handler captures the key before the repaint clears it, and dismisses only once the pane's own line shows the finding. A pane that did not paint keeps the card and sends focus to the switch. The test models the real repaint, and its control arm can fail.

[STRENGTH]: The lost-report acknowledgement is keyed on the marker value, written atomically (temp file then rename), and the server refuses a stale marker. A later loss is said again, and an unreadable ack record fails toward saying the loss. The route is person-only (`isViaScreen`) and enrolled-only, with a server test covering the 403, the 400 and the 200.

[STRENGTH]: The new slot is in the stack's `:empty` rule, and a static test checks every slot. The `Browser-check-surface:` trailers explain each incidental match to another browser check. The card's wording is fixed sentences with no em dashes (checked on the added lines), and `role="status"` sits on the words rather than the card.

#### Iteration 9

Findings

[WARNING] web/index.html:52488: `pollCwNote` treats any JSON reply as a real answer. It never checks `res.ok`, so a 500 from `GET /api/remote` (`{ error: 'we could not read the Plus state' }`, server.js:10514) has no `enrolled: true` and is read as "not set up for Kosmos+". The result: `paintCwNote(null)` removes a showing warning, and `quietUntil` stops polling for ten minutes. A network failure already keeps the warning (the "no blink" rule in the plan), but this failed read does the opposite. Suggested fix: return early unless `res.ok` and `typeof r.enrolled === 'boolean'`, and add a page test where the stub answers `{ ok: false, json: async () =&gt; ({ error: '...' }) }`.

[WARNING] web/index.html:52478: The card's small line follows only `cw.on`. With the check switch on but Kosmos+ itself switched off (enrolled, `r.on === false`), it says "Kosmos+ checks the public certificate logs for this computer.", which is false: the tunnel is not running, so nothing is checking. The Plus pane qualifies its sentences with `plusOn` (`plusCwSay`), but `pollCwNote` drops `r.on`, and `paintPlusCertWatch` does not pass `plusOn` to `paintCwNote`. Suggested fix: pass `plusOn` through and choose the small line from `cw.on === true &amp;&amp; plusOn !== false`, with a third sentence for the Kosmos+-off case.

[NIT] web/index.html:52508: The Review landing (`land`) reads only `line.textContent` and `line.dataset.state`, not whether `#plus-flow` is visible. paintPlus returns early in two places (the `PLUS_SI_REGISTERING` branch and the not-enrolled branch) without repainting the line. In those cases, a line still holding 'foreign' from an earlier paint lets Review put the finding away and send focus to a hidden element. This is unlikely in practice, but checking `!flow.hidden` (or `line.offsetParent`) would close it.

[NIT] web/index.html:20982: After a Forget while on Kosmos+, paintPlus takes its not-enrolled early return, so `CW_NOTE.last` keeps the old finding. Leaving Kosmos+ then has `syncPlusChrome` repaint that stale warning until the next 30 s poll clears it. Clearing `CW_NOTE.last` on the not-enrolled branch, or polling once on leaving, would avoid the flash.

[NIT] engine/cert-watch.js:41: The `'p:' + String(f.pubkey_sha256) + '@' + String(f.not_before)` fallback gives `p:undefined@undefined` for every finding that has no hash, id or pubkey. Such findings collapse to one id, so adding a second one leaves the key unchanged and the put-away notice does not come back. That needs a malformed tunnel entry, but adding the list index to that last fallback would keep "a new finding is a new key" true.

[NIT] web.cert-notice-6613.test.js:229: The slot-coverage test cuts the stack at the first `'&lt;/div&gt;\n  &lt;/div&gt;'`, which depends on the exact indentation. If that string is not found, `indexOf` returns -1 and the slice silently drops only the last character, which still passes because of `slots.length &gt;= 7`. Asserting the end index is positive would make it fail loudly when the markup is reshaped.

[STRENGTH]: The new `POST /api/remote/cert-watch/ack-lost` is a write route, so the server's global write guard covers it (Origin must be loopback, form content types refused; server.js:4596-4660). It is also person-only (`isViaScreen`) and enrolled-only, like the switch. `ackLostIn` refuses any marker other than the report's current one, writes atomically (temp file then rename), and never edits the tunnel's file.

[STRENGTH]: Review captures the key before opening Kosmos+, and the page test models the real repaint that clears `CW_NOTE.key` on the way there. The "pane did not paint" control keeps the notice and checks focus, so the test can fail on the bug it guards against.

[STRENGTH]: `findingKey` keeps only a 16-hex digest, and the page refuses any key that is not 16 hex characters before using it. Nothing from the third-party report reaches the DOM; the test checks the key is not written into the page.

[STRENGTH]: Fits the floating stack's existing conventions:
- The new slot is added to the stack's `:empty` rule.
- A static test checks that every slot in `#topnotes` is in that rule.
- Close sends focus to the same targets as the other notices (four identical uses in the file).
- The headline is filled after the card is inserted, following #3532's `role="status"` pattern.
- No em dashes were added in the diff.

[STRENGTH]: Tests and browser-check coverage:
- engine/cert-watch.test.js passed (13/13), web.cert-notice-6613.test.js (15/15) and web.plus-cert-watch-6602.test.js (9/9), each exit 0.
- `bc-surface-map.sh` lists 10 covering checks. Every one is either edited (render-plus-panel-3829.js) or named in a `Browser-check-surface:` trailer in origin/main..HEAD.
- Both tests that slice the script (web.plus-stale, web.plus-cert-watch-6602) were moved to stop before the new block, which runs timers at load, and they now assert the anchor exists.

#### Iteration 10

Findings

[WARNING] web/index.html:52516: The Review handler dismisses the finding only when `land` finds `plus-cw-line` in the `foreign` state, and it reads `line.dataset.state`. `paintPlusCertWatch` sets `dataset.state` after it writes the line text (around line 52454). In practice both are set before `paintPlus()` resolves, so this works. The coupling to paint order is implicit, though, and the page test models it with stubs. If `paintPlusCertWatch` is ever reordered or made async, Review will silently stop putting the finding away. A one-line comment at the `dataset.state` assignment naming this dependency would protect it.

[WARNING] web/index.html:52505: `pollCwNote` calls `GET /api/remote` every 30 seconds in every tab, on every view. That route also runs `remote.status()` and `remote.configured()`, and the Plus pane already polls the same route. The cost is small and bounded: hidden tabs skip, and a computer that is not set up is asked only every 10 minutes. But a set-up computer with several open tabs, or several boards, pays for this poll constantly. Consider a lighter route, or sharing the poll with the existing one, if `status()` ever gets heavier.

[NIT] engine/cert-watch.js:158: The ack file is read on every `certWatchFrom` call. Every `GET /api/remote`, now polled every 30 seconds per tab, does one extra `readFileSync` that fails with ENOENT in the normal case. It is harmless, but the read could be skipped unless `damagedAt !== null`.

[NIT] engine/cert-watch.js:187: The `ct-watch-lost-ack` file is never removed once the tunnel clears its marker. It is one small stale file and a later marker never matches it, so there is no correctness effect.

[NIT] web/index.html:52497: When the notice is inserted, the small line is already inside the `role="status"` region and only the headline is set afterwards. Some screen readers may announce only the small line, or nothing, for a region inserted with content. The plan records that VoiceOver has not been run and names an owner, so this is already tracked.

[STRENGTH]: The dismissed-finding design matches the existing asknote and login notice conventions. It keeps a per-browser `localStorage` list with an in-memory fallback, caps the list at 50 keys, and keys on a 16-hex digest so nothing from the report reaches the page. The digest gives each finding its own hash, then its log id, then a position-carrying fallback. The unit test shows that a second identical bare entry gives a new key.

[STRENGTH]: `ackLostIn` is safe to expose. It checks the marker against the report's current `damaged_report_at` and refuses any other value. It writes by temp file and rename, with mode 0600. It never edits the tunnel's report. A damaged or empty ack file never matches, so the loss is said again. The route is person-only (`isViaScreen`) and enrolled-only, and `server.test.js` covers the 403, the wrong-marker 400 and the 200.

[STRENGTH]: The notice sits in the floating stack with its own `:empty` rule, so it takes no room and leaves the `#askcard[hidden] + #conn` layout rules alone. Focus handling is thorough. The captured key survives the repaint on the way to Kosmos+. A pane that did not paint keeps the notice and sends focus to the switch. Got it uses `aria-busy` instead of `disabled`. A refused ack keeps focus on the button.

[STRENGTH]: The test-anchoring edits are handled carefully. `web.plus-cert-watch-6602.test.js` and `web.plus-stale.test.js` re-anchor on the new comment and assert it exists, so a moved block fails loudly rather than slicing a wrong region. The three requested suites pass (13, 17 and 9 tests). The commit trailers explain why the other browser checks are matched without change. The diff has no em dashes in any spelling.

#### Iteration 11

Findings

[WARNING] web/index.html:52485: The notice's Review button (`.utoast .uacts button.uprime`) gets no finger-size rule on touch screens. The base `.uacts button` rule (line 1379) gives it about 28px of height. #5407 made the login notice's main action 44px under `@media (hover: none), (pointer: coarse)` (line 6579), and #5218 gave every notice's close a 44px hit area. The new notice's main action is missing from both, and it is the card that is guaranteed to show on a phone (its small line is kept there). Fix: add `.utoast .uacts button[data-cw="open"]` (or `.utoast.cwnote .uacts button`) to the 44px rule at line 6579. render-phone-taps-5218.js could also assert it.

[NIT] web/index.html:52517: Review's `land()` runs after `paintPlus()` resolves. paintPlus returns early without painting when `PLUS_EPOCH` moved (another paint, such as the 5s status tick, started in between). In that window `land` reads whatever the line held before. On a first visit that is harmless: the notice is kept and focus stays on the section. On a return visit the line still has the previous visit's text and `data-state="foreign"`, so `land` puts away `shownKey` based on a line that may be about an older finding set. The window is small. One fix: compare against a value paintPlusCertWatch records for this paint (for example `line.dataset.key = cw.key`) and require it to equal `shownKey`.

[NIT] web/index.html:52423: `line.dataset.state` is set only on the object branch of paintPlusCertWatch. The `!cw` branch empties the line but leaves the old `data-state`. `land` survives this only because it also checks `textContent`. Clearing `dataset.state` there too would make the stale read above impossible from that side.

[NIT] CLAUDE.md:86: The "Where to find things" row for the certificate check still lists only `GET /api/remote` and `PUT /api/remote/cert-watch` and `paintPlusCertWatch`. It is missing `POST /api/remote/cert-watch/ack-lost`, the board-owned `ct-watch-lost-ack` file, `paintCwNote` / `pollCwNote` / `#cwnote-slot`, and `web.cert-notice-6613.test.js`. The next person routed by that row will not find the notice.

[NIT] web/index.html:19597: `#plus-cw-ack` is a bare `.btn` between the line `&lt;p&gt;` and `#plus-cw-row`, with no spacing rule of its own. Worth a look in the design shots so it does not sit flush against the switch row.

[STRENGTH]: The finding key is a 16-hex digest built only from the report's identifiers, and the page validates it with `/^[0-9a-f]{16}$/` before using it. Everything written into the card is a fixed sentence (the headline goes in via `textContent`). Nothing from the third-party report reaches the DOM, and a test checks that the key is not written into the page.

[STRENGTH]: `ackLostIn` refuses any marker other than the report's current `damaged_report_at`. It writes the board's own record by temp file plus rename and never edits the tunnel's file. A damaged or empty record never matches, so the loss is said again. The route is person-only (`isViaScreen`), enrolled-only, and sits behind the global `crossSiteWrite` guard. server.test.js covers 403, 400 (wrong marker) and 200.

[STRENGTH]: Failed reads are handled honestly. A thrown fetch, a non-OK answer, or an answer without a boolean `enrolled` keeps what is showing and does not start the ten-minute quiet. Tests cover both the thrown and the 500 case, plus the background-tab and not-set-up quiet paths.

[STRENGTH]: The Review test models the real repaint that clears `CW_NOTE.key` on the way to Kosmos+, and has a control arm (a pane that did not paint keeps the notice). The slot test checks every `#topnotes` slot is in the `:empty` rule. The re-anchored slices in web.plus-stale.test.js and web.plus-cert-watch-6602.test.js now stop before the new block, which starts timers.

[STRENGTH]: Verified locally: engine/cert-watch.test.js 13/13, web.cert-notice-6613.test.js 17/17, web.plus-cert-watch-6602.test.js 9/9, all exit 0. The surface map lists 10 browser checks that touch the change. Each one is either edited (render-plus-panel-3829.js) or named in a `Browser-check-surface:` trailer in origin/main..HEAD. No em dash was added in any of the five spellings, checked with a control that matches.

#### Iteration 12

Findings

[WARNING] web/index.html:52500: In `pollCwNote`, `typeof r.enrolled !== 'boolean'` is the only guard before `paintCwNote(r.enrolled === true ? r.certWatch : null, ...)`. A 200 answer from an older or partly updated board has no `certWatch`, so the same path paints `null`. The pane's `paintPlusCertWatch` also calls `paintCwNote(null)` when `cw` is missing. A warning on screen is therefore cleared by a successful but incomplete answer, without the "failed read keeps the notice" rule applying. This is low likelihood because the board and page ship together, but it is a quiet way to lose a security warning. Treat a missing `certWatch` on an enrolled answer as a failed read.

[WARNING] web/index.html:52518: Review puts the finding set away (`cwNoteDismiss(shownKey)` in `land`) after one paint, while the finding is still current. The card never returns for that set, and only the pane line remains. This follows #6315 and the plan records it, so I am not calling it a defect. But for a certificate-misissuance warning, "Review once, then silence on every other view" is the weakest part of the design. Josh should know it is a choice, not just a rule applied as written.

[NIT] web/index.html:52536: After a successful Got it, if the `paintPlus()` refresh failed (a null read), the Got it button can still be visible. Focus then goes to the line or switch and "Noted." is not said unless the line is empty. The state is self-correcting on the next paint, but the user sees Got it still showing after a success. Consider hiding the button optimistically on a successful POST.

[NIT] engine/cert-watch.js:139: `findingKey` gives the same key whether a certificate sits in `foreign` or `earlier_foreign`. A finding that moves from "this address" to "an earlier address" keeps its dismissal even though the sentence changes. This is probably acceptable (same certificate), but it is untested and unrecorded in the plan.

[NIT] web/index.html:52455: The dismissed list is shared across tabs only at the next paint (it is read from `localStorage` each time). There is no `storage` event, so a second open tab keeps showing the card until its next poll, up to 30 seconds. Fine, but it is not what "put away" suggests.

[CONVENTION] .claude/plans/ctwatch-notice-6613.md:34: The VoiceOver measurement is assigned to "April ... at this card's design review", and the plan says to record it on kosmos#6613 "before it closes". That is an open item with a named owner, which is fine, but nothing mechanical enforces it.

[STRENGTH]: `ackLostIn` is well bounded. It is board-owned and never edits the tunnel's report. It refuses a marker that is not the current one, so an ack never covers a later loss. It writes atomically (temp file plus rename), and an unreadable record fails toward saying the loss again. The route is person-only and enrolled-only like the switch, and the server test covers the 403, the wrong marker (400) and the success.

[STRENGTH]: Only fixed sentences and a 16-hex digest reach the page. `paintCwNote` validates the key with `/^[0-9a-f]{16}$/`, and the headline is set via `textContent` after insertion. The tunnel's strings never get near `innerHTML`, and there is a test for the non-hex key case.

[STRENGTH]: The tests are real. The Review test models the repaint that clears `CW_NOTE.key` and has a control where the pane did not paint. The stale-`data-key` test covers a line left over from an older finding set. The slot-coverage test checks that every slot in the stack has an `:empty` rule. The existing anchor-sliced tests were re-anchored with assertions. The three requested suites pass (13, 19 and 9 tests).

[STRENGTH]: Accessibility is handled with care. The notice has a 44px Review button on touch and a close button covered by the existing 44px `::after` hit area. Focus moves to the K mark or the remote bar menu on close, and to the pane's line or the switch after Review or Got it. Got it uses `aria-busy` rather than `disabled`, so focus is kept. The commit trailers for `Browser-check-surface` name each affected check with a reason, and there are no em dashes in the added lines.

#### Iteration 13

Findings

[WARNING] web/index.html:52551: When Got it is refused, focus can be lost. The refusal path calls `paintPlus()` and only puts focus back on Got it if the button is still showing (`if (!ackBtn.hidden &amp;&amp; ackBtn.focus) ackBtn.focus()`). The most likely refusal is "that report is no longer the one to acknowledge", which happens when the tunnel has replaced or cleared the marker. If it was cleared, the repaint hides Got it while it has focus, and keyboard focus falls to nothing. The success path already falls back to the line or the check's switch; the refusal path should do the same when Got it is gone. The page test only covers a refusal where the button stays visible (its `paintPlus` stub never hides it on `ok: false`), so it cannot catch this.

[NIT] engine/cert-watch.js:80: The comment says a record that does not read as a number "never matches". That is not quite true: `Number('')` and `Number(' ')` are 0, and `secs()` floors a fractional value such as 0.5 to 0 (it checks `v &gt; 0` before flooring). So an empty ack file next to a marker below 1 would hide the loss. The page would also show a Got it that does nothing, because both `ackLostIn` and the click handler refuse `at &lt;= 0`. The tunnel writes i64 seconds, so this cannot happen in practice. Either have `secs` reject anything below 1 after flooring, or parse the record with `/^\d+$/` so the comment is accurate.

[NIT] engine/cert-watch.js:39: The last fallback key (`'p:' ... '#' + n`) includes the entry's position in its list. If the tunnel reorders entries that have neither `cert_sha256` nor `id`, the key changes and a dismissed notice comes back. This errs toward telling, which matches the plan's stated bias. Noting it so nobody later reads the key as fully stable for such entries.

[NIT] web/index.html:52517: If a 5s status-tick paint starts while Review's own `paintPlus()` is still fetching, the epoch check makes Review's paint return early, so `land` can run before the line is painted. The only cost is that the notice is not put away yet; focus stays on the settings section that `settingsGo` focused, so nothing is lost. Worth a one-line comment since `land` assumes its own paint finished.

[STRENGTH]: Review stores the key it acted on before opening Kosmos+, and only puts the notice away once the pane's line says the same finding set (`data-key`). This stops a stale line, or a pane that never painted, from silently removing a security warning. Page tests cover both the positive case and the control.

[STRENGTH]: The acknowledgement is a board-owned record tied to the exact marker the person was shown. It is checked against the live report before writing and written whole (temp file then rename). The tunnel's file is never touched, and a later loss is reported again. Engine and route tests cover the wrong-marker refusal and the person-only 403.

[STRENGTH]: Polling handles failures without losing state. A network error, a 500, or a set-up answer with no `certWatch` all keep the card as it is. Only an OK answer with a true/false `enrolled` is acted on, and each of those cases has its own page test.

[STRENGTH]: The two existing page tests that sliced the script up to the moved comment (plus-stale, plus-cert-watch-6602) were re-anchored with explicit guards. I swept the other tests and none slices across the new block. All three permitted test files pass: 13/13, 20/20 and 9/9. Every browser check the page diff touches is either asserted or has a `Browser-check-surface:` trailer in origin/main..HEAD. No em dashes in the diff. The new close button's label follows the login notice's "Close: ..." pattern, and the touch rules give Review and the close button 44px.

#### Iteration 14

Findings

[WARNING] engine/cert-watch.js:85: The `secs` change from `v &gt; 0` to `v &gt;= 1` is a behaviour change (a fractional marker such as 0.5 used to floor to 0 and count as a loss, and now reads as absent). `engine/cert-watch.test.js` has no test for it. Revert the change, or add a case with `damaged_report_at: 0.5` that expects `lost: false` and `lostAt: null`, so the new guard can fail.

[NIT] web/index.html:52470: Dismissed keys are never cleared when a finding goes away. The 50-key cap bounds the list, but a key from a resolved finding stays in the list. If the same certificate set came back, it would stay silent. The plan says "a new finding is a new key", which holds. The case where an old set comes back is not stated, so add one sentence to the plan.

[NIT] web/index.html:52572: The Got it button has no `min-height: 44px` rule on touch screens, unlike the notice's Review button. It is a primary action on a phone-reachable pane. This is probably fine, since other `.btn`s in Settings share the size, but the plan gives 44px as the standard for the notice's main action and is silent here.

[NIT] .claude/plans/ctwatch-notice-6613.md:57: The plan's test counts match what I ran (13, 21, 9). The mutant claim, "dismissed-key check removed, 2 notice tests red", is not something I could re-verify from here.

[STRENGTH]: The notice is built on fixed sentences plus a 16-hex digest, so no third-party text from the report reaches the page. The page checks the key against `/^[0-9a-f]{16}$/` before use, and a test covers a non-hex key.

[STRENGTH]: The lost-report acknowledgement is board-owned and keyed on the marker value. The write goes through a temp file and a rename. Stale and non-numeric markers are refused. The route is person-only and enrolled-only, and the server test covers all three outcomes (403, 400, 200).

[STRENGTH]: Failure handling in `pollCwNote` is careful. A failed read, a 500, a hidden tab and an older board with no `certWatch` each keep the warning as it is instead of blinking it off. A computer that is not set up is polled only every 10 minutes. Review dismisses only once the pane's line carries the same key, and focus is never lost.

[STRENGTH]: The notice slot is in the stack's `:empty` rule, and a test asserts that every slot in `#topnotes` has one. The browser check has a clear-check control, and the page tests were re-anchored with explicit asserts. The commit-message `Browser-check-surface:` trailers each give a reason.

I found no BLOCKERs. I did not re-report the unrun browser check or the choice that Review puts the finding set away.

#### Iteration 15

Findings

[WARNING] web/index.html:52396 (with engine/cert-watch.js:72 and :92): The card can stay silent while the pane shows a red warning. engine/cert-watch.js only ever raises the state to `foreign`, never lowers it. So a report that says `state: "foreign"` with empty or missing `foreign` / `earlier_foreign` lists and zero overflow comes back as state `foreign` with `key: null`. `plusCwSay` then shows the red Warning sentence on the Kosmos+ pane, but `paintCwNote` needs a 16-hex key, so no card appears anywhere else. That is the exact case this card exists for, and the most security-relevant one to miss. Fix: return a key whenever `state === 'foreign'` (for example, hash a fixed `'s:foreign'` id plus the counts when there are no entries), and add an engine test for the empty-list foreign report.

[WARNING] web/index.html:51551: The not-enrolled branch in `paintPlus` calls `paintCwNote(null)` whenever `r` is truthy. `paintPlus` parses the body without checking `res.ok`, so a 500 like `{error: 'we could not read the Plus state'}` lands in this branch and clears the notice and `CW_NOTE.last`. `pollCwNote` was deliberately fixed to treat that same answer as a failed read ("no blink"). Because of this, leaving Kosmos+ after one error tick shows no card until the next 30s poll. Fix: guard with `r &amp;&amp; r.enrolled === false`, matching what `pollCwNote` accepts.

[WARNING] .claude/plans/ctwatch-notice-6613.md:1 (branch commit trailers): This branch passes the surface gate only because of the parent branch's commits. Measured with `bc-surface-map.sh` on `origin/ctwatch-board-6602...HEAD` alone: this branch's own lines match `render-plus-gate-1615.js`, `render-plus-asks-signin-4610.js` (via `plus-flow` in Review's `land`), `render-plus-stars-3778.js` (via `#s-sec-plus #plus-cw-ack`) and `render-plus-signin-3478.js`. None of this branch's commits carries a `Browser-check-surface:` trailer for those four. Today they are covered by 6602's trailers, whose reasons describe 6602's diff, not this one. Once 6602 rebase-merges and this branch is rebased onto main, `origin/main..HEAD` loses those commits and `browser-check-surface-gate.sh` will refuse. Fix: add per-check trailers in this branch's own commits, with reasons about this diff (Review reads `#plus-flow`'s hidden flag only; the new CSS rule only spaces Got it).

[NIT] web/index.html:52496: `pollCwNote` has no ordering guard. A `visibilitychange` poll and an interval poll can both be in flight, and the older answer can land last and repaint a state that has since changed until the next tick. `paintPlus` already guards this with `PLUS_EPOCH`; a matching counter here would close it.

[NIT] engine/cert-watch.js:51 (diff line 224): Tightening `secs` from `v &gt; 0` to `v &gt;= 1` also changes how `checked_at` and `error_at` are read, not only `damaged_report_at`. It is harmless in practice (a sub-second epoch is never current), but the plan's Decisions section does not mention this side effect.

[NIT] web/index.html:52529: When Review finds the pane has not painted the finding and the switch is hidden, focus falls on nothing, because the pressed button has already been removed. The Got it handler has a full fallback chain; this path does not.

[STRENGTH]: Review records the finding key at the moment it is pressed, then dismisses only if the pane's line shows `data-key` for that same finding set and `#plus-flow` is visible. A pane that did not paint therefore never costs the person the notice, and tests cover that case.

[STRENGTH]: The acknowledgement is stored by the board in its own `ct-watch-lost-ack` file, written atomically (temp file, then rename), and tied to the exact marker. A later loss is shown again, an empty or damaged record does not count as an acknowledgement, and the tunnel's report is never edited.

[STRENGTH]: Nothing from the third party reaches the page. The key is a validated 16-hex digest, the headline is a fixed sentence set through `textContent`, and a test checks that the key is never written into the markup.

[STRENGTH]: The new page tests run the real script extracted from index.html, with stubs that model the actual repaint on the way to Kosmos+ (including the cleared key) and include controls that can fail. Locally: `engine/cert-watch.test.js` 13/13, `web.cert-notice-6613.test.js` 21/21, `web.plus-cert-watch-6602.test.js` 9/9.

[STRENGTH]: The new slot is added to the stack's `:empty` rule, and a static test checks that every slot in `#topnotes` is covered by it. That stops the same mistake from coming back with the next slot.

#### Iteration 16

Findings

Plan file: `.claude/plans/ctwatch-notice-6613.md`, read. I ran the three allowed test files and all pass (13, 21 and 9). The browser check was not run, as briefed.

[WARNING] web/index.html:11713: The new Got it button (`#plus-cw-ack`) has no 44px touch rule. The same commit gives the notice's Review that size, citing #5218/#5407. The block at about line 6568 already lists the Plus pane's other buttons (`#plus-site-link` and so on) at 44px. Got it is the only action on a lost-report sentence, so it needs the same size. Add `#plus-cw-ack` to that `:is(...)` list, and have `render-phone-taps-5218.js` or the Plus panel check measure it.

[NIT] engine/cert-watch.js:75: The comment still says "acknowledging it from the board is kosmos#6613", as if that were pending. This branch adds the acknowledgement (`ackLostIn`, with the `ct-watch-lost-ack` file read just below). Reword it to say the marker is acknowledged by the board's own file.

[NIT] web/index.html:52563: The Got it handler awaits `paintPlus()`, which can return early if a newer paint superseded it (`epoch !== PLUS_EPOCH`). The handler then reads a line that has not repainted. A saved Got it keeps its sentence and gets no "Noted." until the next tick. Focus still lands somewhere real, so this is minor. Review has a comment for the same overtaking case, and Got it does not.

[NIT] web/index.html:52518: `pollCwNote` and `paintPlus` both call `paintCwNote` with no ordering between them. A slow poll answer that lands after a newer `paintPlus` can repaint the older state. The `seq` guard only orders polls against other polls. The effect is bounded, since the next 30s tick corrects it, but it could flash a card the pane just put away. It is not worth fixing now.

[STRENGTH]: The key is a 16-hex digest, and the page accepts it only if it matches `/^[0-9a-f]{16}$/`. The card writes only fixed sentences, via `textContent` for the headline. Nothing from the report reaches the page, which was the point of the design.

[STRENGTH]: The ack route is person-only (`isViaScreen`) and enrolled-only. It refuses any marker that is not the report's current one, and it writes the record by temp file and rename. The server route test covers 403, 400 and 200, with the 403 and 400 cases acting as negative controls.

[STRENGTH]: The stack changes are complete. The slot is first in the stack and in the `:empty` display rule, and a static test checks every slot is covered. The `Browser-check-surface:` trailers name the checks the diff touches. `bc-surface-map` lists exactly those ten checks, and every one has a trailer on a commit in this branch.

[STRENGTH]: The failure paths are handled. A 500 or a failed fetch keeps the warning showing, and an older board with no `certWatch` leaves it alone. A computer not set up is polled only every ten minutes. Review dismisses only once the pane's `data-key` matches, with a test that fails if it dismisses on a stale line. The page tests that slice the script by anchors were re-anchored with guards that fail loudly if the anchor moves.

#### Iteration 17

Findings

[BLOCKER] engine/cert-watch.js:84: Got it never brings the check back to clear on a real tunnel report. The tunnel writes `state: "unknown"` for as long as `damaged_report_at` is in the file (kosmos-relay origin/main `crates/tunnel/src/ctwatch.rs:729`: `else if !verified || map.contains_key("damaged_report_at") { "unknown" }`). Its doc comment (lines 71-72) says the marker stays until a person has looked and that acknowledging it is the board's job. Nothing ever removes the marker: the board only writes `ct-watch-lost-ack` and never edits the report. So once the person presses Got it, `lost` turns false but `state` stays `unknown` permanently. On a running check the pane then says "The daily check of the public certificate logs has not been able to confirm anything lately." for good, with no Got it, even while daily searches succeed. Got it just swaps one cannot-confirm sentence for another that can't be dismissed. Suggested fix: when the loss is acknowledged, raw `state` is `unknown`, `checked_at` is current (inside STALE_MS) and the last try did not fail (`failing` false), read the state as `clear`. Keep `unknown` when there is no current success, so the `!verified` arm is unchanged.

[BLOCKER] engine/cert-watch.test.js:168: The acknowledgement test uses a fixture the tunnel never writes: `{ state: 'clear', checked_at: S, damaged_report_at: ... }`. With the marker present the tunnel always writes `unknown` (or `foreign`). The assertion `'acknowledged, a recent clear is clear again'` passes only because of that fixture, which is why the defect above is green. The same shape is in server.test.js:11641 (`state: 'clear'` beside `damaged_report_at`) and in the browser check's `cwNow()` (docs/browser-checks/render-plus-panel-3829.js:537, which answers `clear` after the ack). All three need the tunnel's real shape (`state: 'unknown'` plus the marker) so they can return the dangerous answer.

[WARNING] web/index.html:19600: Got it sits directly under the line. When the state is `foreign` with a lost report, that line is the red certificate warning with the lost sentence appended. A sighted person can read a bare "Got it" as acknowledging the certificate warning. Only the aria-label says it is about the earlier report. In a security warning, a visible label that names what it acknowledges (for example "Got it: earlier report") avoids that misreading.

[NIT] web/index.html:52536: If the pane has not painted, Review falls back to `.apphead .klink` / `.apphead h1` filtered only on `el.focus`. The close path just below also filters on `getClientRects().length`. In a layout where the K mark is not rendered, `focus()` does nothing. Focus is not lost, because settingsGo already focused the section, but the two paths should use the same visibility check.

[NIT] web/index.html:52499: `pollCwNote` sets `quietUntil` for ten minutes after a "not set up" answer, and nothing clears it when the person sets up Kosmos+ in this tab. During that window a finding is raised only through the pane's own paint. The practical impact is negligible (the check runs every 20 hours), but resetting `quietUntil` in paintPlus's enrolled branch would make it exact.

[NIT] web/index.html:52484: The comment says the headline "is set after the card is in". The `role="status"` region and its text are inserted in the same task, so to a screen reader this is the same as inserting everything at once (a newly inserted live region is often not announced at all). The plan already defers the VoiceOver measurement. The comment should not claim an ordering benefit that does not exist.

[NIT] web.cert-notice-6613.test.js:139: The finger-size test matches only the rule's text. It still passes if the rule moves out of the `(hover: none), (pointer: coarse)` block, where it would stop applying on touch screens. Slicing that media block before matching would make it a real check.

[STRENGTH]: Review takes the key it acted on before opening Kosmos+, and only puts the finding away once the pane's line shows that same finding set (`data-key`). The page test models the real repaint that clears `CW_NOTE.key`, with a control arm for a pane that did not paint and one for a line left over from an older set.

[STRENGTH]: `ackLostIn` refuses any marker other than the one in the report and writes atomically (temp file, then rename). The route is person-only and set-up-only, matching the switch. Nothing from the third-party report reaches the page; the notice uses only a hex key and fixed sentences.

[STRENGTH]: Failed reads (network error, an error answer, a set-up answer with no `certWatch`) all leave the notice alone and keep polling, and each case has its own test. A static test checks that every slot in the floating stack has the `:empty` rule.

The three permitted test files pass (13, 21, 9). The surface map lists 10 browser checks for this diff, and each is covered by either a direct edit (render-plus-panel-3829.js) or a `Browser-check-surface:` trailer in this branch's commits.

#### Iteration 18

Findings

[WARNING] web/index.html:52511: `pollCwNote` increments `CW_NOTE.seq` before the ten-minute quiet check, so a skipped poll on a computer that is not set up still invalidates an older request still in flight. Move the increment below the quiet return. It can only drop an answer that arrived late and is almost always harmless, but the stale-answer guard should not be advanced by a call that sends nothing.

[WARNING] web/index.html:52503: The dismissed-key record never forgets a finding set. If set A is dismissed, then B appears, and A is later recreated (for example B's entries age out of the tunnel's report), A stays silent on that browser. The plan accepts this, and the Plus pane line still says it. For a security warning it is the one place the notice can stay quiet while a real finding stands, so it is worth a second look with the product owner. This is not a code defect.

[NIT] engine/cert-watch.js:84: `marked` accepts any positive number, including values below 1 such as 0.5. `secs` now rejects those, so the lost sentence shows with `lostAt` null and cannot be acknowledged. The comment says so, and the tunnel only writes whole i64 seconds, so this cannot happen in practice. The engine test for it should say it is a defensive path.

[NIT] engine/cert-watch.js:128: The temp file name is built from pid, time and a random value. That is fine, but a failed write cleans up only inside the catch. A crash between the write and the rename leaves a stray `.tmp` file in the tunnel's state directory, which nothing sweeps. Cosmetic.

[CONVENTION] .claude/plans/ctwatch-notice-6613.md:60: The plan names April as owner of the VoiceOver measurement, to be recorded on kosmos#6613 before it closes. There is no mechanism in the branch (no card comment or test marker) that holds that open. This is a note for the PR description rather than a code change.

[STRENGTH]: Every report shape was checked against the tunnel's real writer (ctwatch.rs). `damaged_report_at` is written as `now` and kept. `state` is `unknown` for as long as that marker exists. `cert_sha256`, `id`, `pubkey_sha256` and `not_before` are present on foreign entries. `earlier_foreign` entries carry an added `address` field that the key ignores. The key fallback chain (cert hash, then id, then pubkey plus not_before plus index) matches those fields. The ack-then-clear rule (the marker is acknowledged, the check is current, and it is not failing) matches the tunnel's `!verified || damaged_report_at` rule, so Got it cannot leave the pane permanently on "cannot confirm".

[STRENGTH]: The acknowledgement is bound to the marker value. `ackLostIn` refuses any other marker, so a later loss is said again. The write is atomic (temp file then rename), the tunnel's own file is never edited, the route is person-only and enrolled-only like the existing switch, and the server test covers 403, 400 and 200. Nothing from the third-party report reaches the page: only a 16-hex digest, validated by regex, and fixed sentences written with `textContent`.

[STRENGTH]: Review captures its key before the repaint on the way to Kosmos+ clears it. It dismisses only after the pane's own line says the finding (matching `data-key`), and a pane that did not paint keeps the notice and sends focus to a real element. Focus handling after close, Review and Got it is thorough. Got it uses `aria-busy` rather than `disabled`, and a refused Got it keeps focus. A failed or old-board read does not blink the warning off, and the stale-answer guard, the background-tab skip and the ten-minute quiet period are all handled.

[STRENGTH]: The browser-check surface trailers cover all ten checks the surface map returns for this diff, each with a specific reason. The changed `render-plus-panel-3829.js` has its own control scenarios (a clear check raises nothing) and a lost scenario that posts the marker it was shown. I ran the three allowed test files: 13, 21 and 9 tests, all passing. The diff adds no em dashes. The plan's counts match, and its decisions and known gaps are stated honestly.

#### Iteration 19

Findings

[WARNING] engine/cert-watch.js:31: `findingKey` mixes the overflow counts (`'o:' + foreign_overflow + ':' + earlier_overflow`) and, for entries with no hash and no id, the entry's position in the list (`#n`). The tunnel changes both without a new certificate turning up. On an address change it folds `foreign_overflow` into `earlier_overflow`: ctwatch.rs builds the new report with only `earlier_overflow`, and later sets `foreign_overflow` to a count read from that rebuilt report, where it is no longer present. Its retain step can also drop an entry from `foreign`, which renumbers the ones after it. Either way the key changes, so a set the person closed comes back with no new certificate. This leans toward telling, so it is not a safety problem. But the plan says "a new finding is a new key", and that is only true one way round. Either key the overflow as one total, not split by list, and use an index only when nothing else tells two entries apart, or write this re-raise down in the plan's decisions. No engine test covers a rename-shaped report.

[NIT] engine/cert-watch.js:81: The comment "even one that is not a whole second (said, though it cannot be acknowledged)" only holds below one second. A fractional marker such as 1792368000.5 is floored by `secs`, shown as `lostAt` 1792368000, and accepted by `ackLostIn`. The test case (0.5) matches what the code does, but the comment and the test label say "not a whole second" when they mean "below one second". The tunnel only writes whole i64 seconds, so this changes nothing in practice.

[NIT] engine/cert-watch.js:90: After a Got it, a current check whose last try failed (`failingNow`) stays `unknown`, so the pane says the failing sentence. A board that never lost a report gets `clear` from the tunnel in the same situation (verified because `checked_at` is recent) and says nothing. The plan makes this choice ("Stale or failing stays unknown") and it is the cautious direction, but the two boards now disagree on the same tunnel facts. One line in the plan's decisions saying so would stop someone treating it as a bug.

[NIT] engine/cert-watch.js:160: `findingKey` is exported but nothing outside the module uses it: no test or caller imports it. Drop the export, or test it directly.

[NIT] web/index.html:52482: The notice's sentences use a straight apostrophe ("this computer's"). Its sibling in the stack, the login notice, uses the curly one ("agent’s"). The Plus pane's own line also uses straight ones, so either choice matches something; this is only consistency within the floating stack.

[STRENGTH]: The engine reads the tunnel's real shapes correctly, checked against ctwatch.rs on relay main:
- The tunnel writes `unknown` for as long as `damaged_report_at` exists, and the after-Got-it override to `clear` is fenced exactly where the tunnel's own unknown conditions are (not current, failing, no `checked_at`).
- The key falls back in the same order the tunnel uses to tell findings apart: `cert_sha256`, then `id`, then pubkey with `not_before`.
- `ackLostIn` re-reads the marker before writing and writes the record whole (temp file, then rename), so a race with a new loss can only leave the new loss still said.

[STRENGTH]: The state and key are read with care at every step:
- Review records the key it acted on before the repaint clears `CW_NOTE.key`, and puts the set away only when the pane's line carries that same `data-key` and `#plus-flow` is showing.
- A failed read, a 500, or an answer from an older board with no `certWatch` all leave a showing warning alone. Only an explicit `enrolled === false` clears it, and paintPlus's not-enrolled branch keeps the same distinction.

[STRENGTH]: Nothing from the third-party report reaches the page. The card is built from fixed strings with the heading set through `textContent`, the key must match `/^[0-9a-f]{16}$/`, and the board sends only a digest.

[STRENGTH]: The tests have controls that can actually fail:
- clear raises nothing, and a pane that did not paint keeps the notice;
- a line left from an older finding set is not accepted;
- a 500 is not read as "not set up";
- a check confirms every slot in the stack has its `:empty` rule.

All three allowed suites pass with the exit code checked: engine/cert-watch.test.js 13/13, web.cert-notice-6613.test.js 21/21, web.plus-cert-watch-6602.test.js 9/9.

[STRENGTH]: The browser-check surface coverage is complete. All 10 checks the surface map names for the web diff are either edited on the branch (render-plus-panel-3829.js) or named in a `Browser-check-surface:` trailer in this branch's own commits. The gate reads trailers across the whole branch, so trailers in later commits count. No em dashes in any added line (checked across all five spellings).

#### Iteration 20

Findings

[WARNING] web/index.html:52488: The card's small line says "Kosmos+ checks the public certificate logs for this computer." whenever `cw.on` is true and Kosmos+ is on. It ignores `cw.failing` and a stale `checkedAt`. The Plus pane itself says "has been failing lately" in that case, but only when the state is not foreign. So a finding raised by a check that has been failing for days still reads as an active, healthy check. This is the one sentence on the card that makes a claim about current behaviour. Either add a `failing` arm to `runs` (for example "The check has been failing; this is what it found before.") or drop the sentence when `cw.failing === true`.

[WARNING] engine/cert-watch.js:97: The post-acknowledgement promotion to `clear` applies to every raw `unknown`, not only the tunnel's marker-driven one. A report whose `state` is missing or invalid already defaults to `unknown` at line 76. With a marker, a fresh `checked_at` and no `error_at`, an acknowledged report then reads `clear`. A tunnel only writes `unknown` beside a marker when unverified or marked, and the unverified case is excluded by the staleness and `failingNow` tests, so this is narrow. Still, the tests only use the tunnel's real shape. Consider requiring `raw.state === 'unknown'` literally, so a garbled `state` field stays `unknown`.

[NIT] web/index.html:19600: The button label "Got it: earlier report" reads awkwardly, and a screen reader hears it with no tie to the sentence above it. Consider `aria-describedby="plus-cw-line"`, or a label such as "Got it, I have seen the earlier report note".

[NIT] web/index.html:52477: `pollCwNote` is the only reader of `r.on` for the card's `plusOn`. `paintPlus` passes the same value, but `syncPlusChrome` repaints with `CW_NOTE.lastPlusOn`. If both race, the last writer wins and the small line can flip between "on" and "plus-off" until the next poll. This is harmless, since it is a repaint of the same key, but the `seq` guard covers only polls against polls.

[NIT] .claude/plans/ctwatch-notice-6613.md: The plan's Proof section says the browser check is not yet run. The task brief records this as known, so I am only noting that the Proof section's test counts (13, 21, 9) match what I ran.

[STRENGTH]: The tunnel's real report shapes are respected. The tunnel never removes `damaged_report_at` and writes `unknown` beside it (relay `ctwatch.rs`: `!verified || damaged_report_at`). The board therefore keeps its own `ct-watch-lost-ack` file keyed on the marker value, and never edits the tunnel's report. A later loss writes a new marker (`now`), which an old acknowledgement cannot cover.

[STRENGTH]: `findingKey` is stable under what the tunnel does without a new certificate: a rename moves findings from `foreign` to `earlier_foreign`, overflow counts fold together, and entries are dropped. It pools both lists and numbers bare duplicates by repetition. It uses `cert_sha256`, then `id`, then pubkey and `not_before`, which matches the tunnel's own dedupe order. Only a 16-hex digest reaches the page, so nothing from the third-party search answer is written into the markup.

[STRENGTH]: Security and robustness are handled well. The route is person-only through `isViaScreen`, like the switch, and enrolled-only. Acknowledgement is refused for any marker other than the report's current one. The ack file is written atomically (temp file then rename) with mode 0600. The client fixes the card's markup, sets text with `textContent`, and validates the key against `/^[0-9a-f]{16}$/` before use.

[STRENGTH]: The client keeps the warning in place on a failed read. An error answer is not "not set up", an older board without `certWatch` changes nothing, and stale polls are dropped by `seq`. Review dismisses a finding only after the pane's own line carries the same `data-key`, and it captures the key before the repaint clears it. The unenrolled-poll backoff is also sound.

[STRENGTH]: Focus and touch handling are deliberate. Close and Review move focus to a real element, Got it uses `aria-busy` instead of `disabled`, and the 44px rules sit inside the coarse-pointer block. The `.utoast .ux` ::after hit area already covers the close button. The `:empty` slot rule and the `Browser-check-surface:` trailers match the surface map's covering list, which names ten checks.

I ran the three allowed test files, `engine/cert-watch.test.js`, `web.cert-notice-6613.test.js` and `web.plus-cert-watch-6602.test.js`, and all 43 tests pass. I found no em dashes in the diff's added lines.

#### Iteration 21

Findings

[WARNING] web/index.html:52487: `paintCwNote` rebuilds the card with `innerHTML` whenever its signature changes, and clears it with `slot.textContent = ''` when the finding goes or the computer is no longer set up. Neither path checks whether keyboard focus is inside the card, so a 30s poll that changes the small line (the check starts or stops failing, the switch flips in another tab) or removes the card drops focus from Review or close onto the page body. The sibling in the same stack, `paintRebootNote`, handles exactly this: it records `held = slot.contains(document.activeElement)`, puts focus back on the new button after a repaint, and sends it to the K mark when the note goes. Apply the same guard here, with the existing klink, kplus-bar-menu, h1 order for the clear path.

[WARNING] web.cert-notice-6613.test.js:1: Several branches have no test, so a mutant would pass:
- **Earlier-address headline:** the "an address this computer used before" sentence (`here` false, when `foreign` is 0 and `earlier` is above 0) is never painted, so a mutant that inverts or drops `here` stays green.
- **Not set up:** nothing exercises `paintPlus` calling `paintCwNote(null)` on `enrolled === false` but not on a failed read.
- **Enrolling ends the quiet:** nothing checks that `CW_NOTE.quietUntil` resets once the computer is set up.
- **Cleared pane:** nothing checks that the `!cw` branch of `paintPlusCertWatch` hides Got it and clears `data-key`.

The not-set-up test covers only the ten-minute quiet.

[NIT] engine/cert-watch.js:124: The comment says the key is "Stable under what the tunnel does without a new certificate: a rename ... folds the overflow counts". On a rename where `earlier_foreign` plus `foreign` exceeds the tunnel's `MAX_FOREIGN` (100), the tunnel truncates and counts the dropped entries (ctwatch.rs, near the `earlier.truncate(MAX_FOREIGN)` call). Those ids leave the pool, so the key changes and a closed notice comes back with no new certificate. This errs toward telling, but the comment should name the exception.

[NIT] web/index.html:52504: Two writers paint the notice and neither knows about the other's answers. `pollCwNote`'s `seq` guard only orders polls against polls. A poll answer that lands after a newer `paintPlus` paint (the user just switched the check, or pressed Got it) repaints the card with the older small line for up to 30s. The key is unaffected, so a dismissal still holds. Possible fix: have `paintPlusCertWatch` bump `CW_NOTE.seq`.

[NIT] web/index.html:52492: The Review button has no accessible name beyond "Review", while close says "Close: certificate warning". The login notice in the same stack names its action ("Refresh login: &lt;provider&gt;"). Suggest `aria-label="Review: certificate warning"`.

[NIT] .claude/plans/ctwatch-notice-6613.md:1: The `render-plus-gate-1615.js` trailer (commit c9b6df15) says this branch "names plus-switch as a focus target". The code names `plus-cw-switch`. The matched token is `plus-flow` (read in Review's landing), and the trailer's first clause says so. The "plus-switch" clause misdescribes the code.

[NIT] engine/cert-watch.js:219: If the process dies between `writeFileSync` and `renameSync`, a `ct-watch-lost-ack.&lt;pid&gt;.&lt;ts&gt;.&lt;rand&gt;.tmp` file is left in the state directory. Nothing sweeps the tunnel state directory, unlike `remote.js`'s `sweepStaleTemps` for its own file. It is harmless, and it is cleared by Forget.

[STRENGTH]: The engine models the tunnel's real shape, checked against relay main: `unknown` beside `damaged_report_at` (`!verified || map.contains_key("damaged_report_at")`). After Got it, only the tunnel's own literal `unknown`, when current and not failing, reads as clear, with controls for stale, failing and garbled. The ack is the board's own file keyed on the marker value, so the tunnel's report is never edited and a later loss is said again.

[STRENGTH]: The finding key pools both lists and both overflow counts, numbers repeated bare entries by occurrence, and keys on `cert_sha256`, then `id`, then `pubkey_sha256@not_before`. That mirrors the tunnel's own dedupe rule (its `same` closure). Only a 16-hex digest reaches the page, it is validated with `/^[0-9a-f]{16}$/` before use, and the notice writes only fixed sentences via `textContent`.

[STRENGTH]: Review captures the key before navigating and dismisses only once the pane's line shows this finding set (`data-state` and `data-key`, with `#plus-flow` visible). A failed or 500 read keeps the card instead of blinking it off. An answer from an older board with no `certWatch` changes nothing.

[STRENGTH]: The new route follows the switch's pattern: JSON parse, then `isViaScreen`, then the enrolled check in the engine. It sits behind the global cross-site write guard. The server test covers the 403 from off-screen, the 400 for a wrong marker, and a success that reads clear afterwards.

[STRENGTH]: All three allowed suites pass:

| Suite | Pass |
|---|---|
| `engine/cert-watch.test.js` | 13/13 |
| `web.cert-notice-6613.test.js` | 21/21 |
| `web.plus-cert-watch-6602.test.js` | 9/9 |

Every check that `bc-surface-map` names for this branch's diff to `web/index.html` is covered. `render-plus-panel-3829.js` is edited and its surface line extended. The other nine each have a `Browser-check-surface` trailer on a branch commit. No em dashes appear in added lines or commit messages.

#### Iteration 22

NO NEW FINDINGS

I read the full diff of engine/cert-watch.js, engine/remote.js, server.js, web/index.html, the CLAUDE.md row and the two adjusted test anchors. I compared them with the tunnel's real report shapes (`ctwatch.rs` on relay `origin/main`).

I checked these and found no defect beyond what the plan records:
- **Tunnel shapes:** entries always carry `id`, and `cert_sha256` may be null, so `findingKey` falls back from hash to id to the bare entry correctly. The tunnel writes `unknown` for as long as the lost marker stands. The `clear` promotion after Got it requires a current `checked_at`, no failing try, and the tunnel's own literal `unknown`, so a first check after the loss stays `unknown`.
- **Person-only route:** the Got it POST carries no screen marker in the body, but `isViaScreen` accepts the browser's `sec-fetch-site` header, so the page's own request passes. The route is still a speed bump, which the plan already records.
- **Poll sequencing:** the sequence bumps from `pollCwNote` and `paintPlusCertWatch` drop only older answers. A failed read leaves the card as it is.
- **Focus paths:** these were consistent, covering Review landing, the failed-land fallback, Got it refused and saved, and rebuild or clear of the card.
- **Test anchors and counts:** the `web.plus-stale` and `web.plus-cert-watch-6602` slice anchors match the new block, and the plan's counts are accurate. `web.cert-notice-6613.test.js` ran 29 tests with 29 passing, and `engine/cert-watch.test.js` ran 13 with 13 passing.

I did not run the browser check or the full suite.
