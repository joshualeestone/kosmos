---
pre_challenge: true
method: challenge-loop
branch: ping-optout-2020
diff_hash: 292dadfaf23cba233ded7a9e0e86d701ad189b06783d950387cf83cd5e1bb7af
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T17:04:35Z
iterations: 5
merged_main: true (resolved reason-grep count 32->33; main #2023 + this #2020 both add a check)
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (1 clean-baseline pass + 4 fresh blind reviews, ACROSS TWO MODELS)
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 WARNINGs, 6 NITs (3 WARNINGs fixed, 6 NITs fixed; 0 deferred)
**Fixed:** 9 | **Deferred:** 0 | **Asked:** 0

kosmos#2020 STEPS 1+2 (Splinter's routing). Restores the two telemetry opt-out
SWITCHES (notify + ping) Josh removed 08-26, so telemetry "can be turned off",
wired to the EXISTING /api/notify-setting + /api/ping-setting routes, with honest
disclosure copy. STEP 3 (flip the defaults to ON) is HELD FOR JOSH - defaults stay
OFF; nothing here makes a send default on. Real switches (role="switch", green
on/grey off), not checkboxes (Josh's 2026-09-03 style ruling), restored from the
08-26 removal diffs rather than #1843's stale card body.

### Baseline (6.0)

Full engine suite (2103) green; a projects.test.js fixture that used a reasonless
needs_you found + fixed by running the whole engine suite; page <script> parses;
the restored controls verified live against a sandboxed board.

### Model diversity (deliberate)

iter 1 Sonnet, iter 2 Opus, iter 3 Sonnet, iter 4 Opus. Independent-but-identical
reviewers share blind spots; the two WARNINGs that mattered most were caught by the
alternation (Opus caught the false-reassurance message a Sonnet pass had passed).

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
- [WARNING] the caller-seam test (server.test.js) that catches "the catch branch stopped painting null" ran only refreshAutoUpdate (dead ternary scaffolding for refreshTell, none for refreshNotify) AND `return`ed inside the loop so a second entry was silently skipped --> FIXED (Promise.all over all three refreshers, painter+epoch in the tuple; covers the thrown-fetch catch branch of both new functions).
- [NIT] stale "refreshTell went with the row" comment --> FIXED.
- [NIT] the 403-arm browser 200-control asserted only "some position" --> FIXED (asserts reads-OFF, an independent catch on a default-ON regression).

#### Iteration 2 (Opus)
- [WARNING] the could-not-read MESSAGE ("...so nothing is sent until you turn it on") re-introduced a reassurance in the forbidden #2047 direction: on a gated read the value is unknown and the send may be ON, so the copy lied reassuringly while the switch (correctly) hid --> FIXED (neutral "We could not read this setting just now.", matching autoPaint; no behavioral claim).

#### Iteration 3 (Sonnet)
- [WARNING] the notify disclosure copy under-disclosed: it omitted `session` and the event `id`, both of which notify.payload() sends. STEP 2 is "honest disclosure" --> FIXED (copy covers all seven payload fields; re-derived the copy-matches-payload guard - notify.test.js pins the EXACT payload key-set so a new field forces a disclosure review).
- [NIT] a malformed 200 on the SAVE path could paint a false Off --> FIXED (`unread` now also treats a body with no boolean `on` as could-not-read; #2047 holds on the save path too).
- [NIT] two other browser checks (render-settings-nav, regress-a-night) had stale "tell/notify GONE" comments and omitted the restored toggles --> FIXED (included + comments corrected).

#### Iteration 4 (Opus)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs.
- [NIT] "whether it posted or answered" is honest now but not forward-safe if needs_you/check_in go live --> FIXED ("what it did (posted or answered)").
- [NIT] ping.test.js title "no control left" reads stale (ping's opt-out is back as the Settings row) --> FIXED (retitled to the CREATE-PAGE control + default-off, with a #2020 note).
**Converged** - the reviewer verified the three-state paint is 403-safe on every read arm (403 / 500-throw / ok:false / malformed body / non-boolean on), no path defaults a send ON, both disclosure strings honestly cover their payloads, and the guards were strengthened not weakened.

### Outstanding questions (ASKED)
None.

### Deferred items
None. (STEP 3 - flip defaults ON - and a shared Settings-toggle FACTORY for the future #2037 switch are deliberately OUT of scope: step 3 is Josh's irreversible half, and a speculative factory built for one not-yet-existent caller is the same "control without its mechanism" defect - it lands WITH #2037's real feature. Splinter adopted this.)

### Strengths
- Three-state / 403-safe on every read AND save arm: a gated/failed/thrown/malformed read draws COULD-NOT-READ (switch hidden, aria-checked stripped, neutral message), never a false Off - the #2047 privacy harm. Verified end-to-end by render-optout-403-2020.js (200 control + a page.route 403 arm) and at the painter/seam/unit layers.
- Defaults stay OFF (notify.js/ping.js untouched; ENOENT -> on:false); guards pin control-present AND default-off together (#2013).
- Honest disclosure: both rows' copy covers their full payload; a payload-key guard forces a copy review on any new field.
- Restored real switches from the removal diff (not the stale card), so Josh's checkbox->switch ruling was met by construction.
