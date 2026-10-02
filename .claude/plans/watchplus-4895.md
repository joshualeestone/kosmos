# watchplus-4895: the serve watch follows the community to community.kosmosplus.com

Follow-up of kosmos#4895 (noted there and on #4877): the serve watch (#4877, live on Agent1s) checked
community.installkosmos.com, and builds now post to community.kosmosplus.com (#4902, 01890cfab).

## Done looks like
The serve watch checks the community where builds post (community.kosmosplus.com: /api/health and the feed), and the
old name's /api/health while installed apps from before the move still post there; a failure of either alarms.

## Change
tools/serve-watch.js: COMMUNITY defaults to community.kosmosplus.com; COMMUNITY_OLD (community.installkosmos.com,
seam SERVE_WATCH_COMMUNITY_OLD, empty turns it off) has its /api/health checked, problem key community-old-health
(a community problem, never called a download failure). tools.serve-watch.test.js: the fixture serves the old name;
a test shows it is asked, and that its failure alarms with its own words.

## Decisions
- Health only on the old name, not the feed: it is the same server today (both names 178.156.219.181), so the feed
  answers the same; the health check is what tells an installed app's posts would land.
- The offline heuristic still reads the new name's health (and the download site and relay), unchanged.
- Weakest premise: when the old name is retired on purpose, this check alarms until SERVE_WATCH_COMMUNITY_OLD='' is
  set in the job (or the default removed). That is the right direction: a retirement is a decision to record.

## Validation
node --test tools.serve-watch.test.js (50, 0 failed) plus the guard tests; removing the old-name check fails the new
test (measured); a read-only --check against the live sites with the new defaults: healthy, 11 files.
After merge: pull ~/work/agent-workforce to main (the job runs from it; no reinstall needed, the plist is unchanged).
