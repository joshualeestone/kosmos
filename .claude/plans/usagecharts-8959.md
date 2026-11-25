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
