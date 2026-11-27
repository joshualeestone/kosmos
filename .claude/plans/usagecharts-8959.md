# #8959 slice D1c2b: the Token usage charts, native on the iPhone

Card: https://github.com/joshualeestone/kosmos/issues/8959 (plan comment 7156509203). Stacked on D1c2a (usage-8959 2ec2276929).

**The call:** the page's usageCharts4Html and usageDonutSvg on the phone.
- The four class charts (last 14 days) use Swift Charts' AreaMark and LineMark (iOS 16). Each has the page's name, tag, total and share, and one accessibility label as the page's aria-label.
- The donut (top 6 models plus Other, clockwise from the top, the total in the centre, the legend with whole percent or "<1%") is a drawn arc shape, since SectorMark needs iOS 17.
- The hint gets back "(the daily charts show the last 14 days)".

**Pinned:** fixture.json gains a day with four more priced models, so the donut's Other slice is exercised. The node parity test also extracts the page's chart series, headers and labels, the donut centre and the legend; expected.json is regenerated from the page; and the Swift suite checks the same fields.

**Weakest premise:** the shapes themselves are drawn, not compared. The UI run's shots are the check for them.

## Measured (first build)
- run-usage.sh PASS 73/73 (two stale literal checks moved to expected.json). Mutants: the class share's bands (2 of 73 fail), the donut taking 7 models before Other (1).
- web.usage-ios-parity-8959 2/2. Typecheck 0 errors.

## Challenge loop ledger

### Round 1 (opus, 02:09 CST): no BLOCKER, 2 MAJOR, 4 MINOR. The reviewer checked every page rule listed in the plan and found them matched.
- MAJOR 1 the 14-day window was never cut (the fixture had 3 days): the fixture now has 16 days (13 small October days and one big one), so the window cuts two, and the suite pins U.chartDays == 14 and "last 14 days". Control: dropping the window fails 3 of 75.
- MAJOR 2 nothing checked the charts were drawn, though the plan's premise said the shots would: the UI test now asserts each chart's identifier (and the reads chart's label, "last 2 days" in the sample) and the donut, with shots usage-charts and usage-donut.
- M1 the donut's centre could run over the ring at large text: one line, scaled down to fit the hole.
- M2 the chart headers squeezed at large text: one line while it fits, else the total and share go under the name (ViewThatFits).
- M3 the arc's inset was a bare 11 tied to a 22 stroke elsewhere: one constant, DonutArc.ring.
- M4 the donut's whole-percent band and the single-model circle were untested: the fixture's big day gives 64% and 36% slices, and a unit check covers one model as the whole circle at 100%.
- Measured: run-usage.sh PASS 75/75; parity 2/2; app and UI-test typecheck 0 errors.

### Round 2 (sonnet, 02:13 CST): no BLOCKER, no MAJOR, 3 MINOR. Loop ends here: rounds with nothing material after round 1's fixes.
- M2 the UI test's reveal could swipe past the donut (a container may never read as hittable): it now stops once the donut exists.
- M3 one day of data drew an empty chart: a point mark then.
- M1 kept: slice angles are pinned for contiguity, not against the page's arcs. The page exposes them only inside its SVG paths, and the legend's percentages, which are pinned to the page, catch a wrong fraction.
- Measured: run-usage.sh PASS 75/75; typecheck 0 errors (app and UI test).

## 2026-11-27 11:5x CST: CI could not type-check the chart in time
- PR #9223 CI: UsageView.swift:138 "unable to type-check this expression in reasonable time" (logic tests + simulator build, and the UI build). Fixed: the chart is its own function (classChart) and the accessibility label is built in typed steps (chartLabel); nothing drawn or read changes.
- Reasoned, not measured: this Mac type-checks both versions fine even at a 1 s per-expression limit (only an unrelated RoomView.swift:762 is flagged, in both), so it cannot reproduce the CI runner's timeout. CI decides.
