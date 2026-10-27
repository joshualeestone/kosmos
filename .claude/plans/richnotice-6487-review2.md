# richnotice-6487, blind review round 2 (CTO lens)

Reviewed: `git diff origin/main...HEAD` at f5f962897e (engine/phonenotice.js reportWords, engine/phonenotice.test.js, docs/phone-notifications.md line 112).

Counts: 0 BLOCKER, 0 WARNING, 2 NIT.

## Findings

### [NIT] docs/phone-notifications.md:112 and engine/phonenotice.js:81: "made with only `--on` or only `--owner`" and "(an older row)" are narrower than the code
- A report made with BOTH `--on` and `--owner` and no reason also reaches reportWords (selfreport.js:271 accepts it). It answers `Waiting on <on>.` and drops the owner. The doc's "only --on or only --owner" reads as if that case is not covered.
- `Waiting for your answer.` is not only for older rows: a current report whose `on` (or `owner`) is only punctuation, e.g. `--on '...'`, is accepted at write (non-empty after cap) and, measured, answers `Waiting for your answer.`.
- Failure scenario: a reader of the catalog concludes an `--on X --owner Y` report shows something other than `Waiting on X.`, or that the generic line can never appear on a current install. No user harm.
- Fix: "A report with no reason (made with `--on` and/or `--owner`, kosmos#6487) ... `Waiting on <what it is on>.`, else `Waiting on <who must act>.`, else `Waiting for your answer.`" and drop "(an older row)", or say "(an older row, or one whose words are only punctuation)". Same wording in the code comment.

### [NIT] engine/phonenotice.js:88: an `on` ending in `?` or `!` gets a full stop after it
Measured: `on: 'is this ok?'` answers `"Waiting on is this ok?."`. The trailing trim strips only dots and spaces.
- Failure scenario: an agent writes `--on "which plan do you want?"` and the lock screen shows `Waiting on which plan do you want?.`.
- Fix: strip `[.!?\s]+$` is wrong too (it loses the question mark); instead only append `.` when the value does not already end in `.`, `?` or `!`: `const w = said(v); return 'Waiting on ' + w + (/[?!]$/.test(w) ? '' : '.')`, with the trim limited to trailing dots and spaces as now.

## Checked and found clean

- **Round 1 dead branch, read:** the `row.auto` branch, its test row and its doc clause are gone. No other reference to `auto` remains in reportWords.
- **Round 1 owner wording, read and measured:** an owner-only row answers `Waiting on Angel.`; `owner: '  Josh. '` answers `Waiting on Josh.`. "Waiting on <who must act>" is true of `owner` as selfreport defines it ("who must act"); it no longer tells the person the agent waits for them when someone else is named.
- **Round 1 punctuation NIT, measured:** `on: '...'` now falls through (to `Waiting for your answer.`), not `Waiting on .`.
- **Whitespace-only because, measured:** `because: '   ', on: 'the build'` answers `Waiting on the build.`, so a blank reason no longer hides the other fields.
- **Masking of on/owner versus because, read:** wordsFor (phonenotice.js:130-135) runs `deps.mask` (server.js:7806 passes guideMasked) on whatever string reportNote returns, so the fallback words go through exactly the same read-side mask as `because`, and a mask that throws or returns a non-string serves nothing. On write, server.js:17750-17751 run the same `reportFieldMasker(who)` over `on` and `owner` as over `because`. Both masks are setup-guide-only by design (#4733); for other agents `on`/`owner` pass as written, which is exactly how `because` already reaches the lock screen on main. So this branch adds no new class of exposure: `on`/`owner` are agent-written free text of the same kind as `because`, capped at 200 (CAPS, selfreport.js:90) versus 1000 for `because`, and already shown on the board. A path or a person's name in `--on` reaches the lock screen just as it would in the reason; that is the page's existing warning, not new. Reasoned from source, not measured end to end through server.js.
- **Prefixes, read:** `Waiting on `, `Waiting for your answer.` carry nothing private.
- **Tests, measured:** `node --test` on engine/phonenotice.test.js, server.phonenotice-6487.test.js, web.phone-notify-catalog-6487.test.js: exit 0, 19 tests, 19 pass, 0 fail.
- **Doc versus code, read:** the three phrases in the doc line match reportWords word for word and in order; the only gaps are the two in the first NIT.
- **Null semantics, read:** reportNote still returns null for a missing time, a non-needs_you row and a missing file (test rows kept), so the route's 404 is unchanged.
