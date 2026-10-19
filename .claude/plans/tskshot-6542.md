# tskshot-6542: the tasks-decision shot on the default data

Card: #6542 (filed by Renet Tilley; the shot and #6492 are PigeonPete's).

## Plan
1. Measure first. The default data has NO question row at all, so no selector can find the waiting line there. The first commit's premise (a looser selector would do) was wrong and is corrected in the second.
2. Let a screen declare `needsData: '<set>'`. skipWhy(s, sc, data) skips it, with the reason, in any other run, as the size skips do. Pass args.data at both call sites.
3. tasks-decision declares needsData: 'marketing'. Its selector waits for `.tsk-waiting-who`, which both forms of the waiting line carry.
4. report.md names each skip's reason. The "no shot would be taken" error names the new cause.
5. Measure three arms: default data with another screen skips it and exits 0; default data alone refuses; marketing shoots.
