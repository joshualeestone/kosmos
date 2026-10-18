# nocommline-6399 (kosmos#6399)

Josh 2026-10-17 11:09 (verbatim): "Also I do not want all these lines that just came in that say \"Last community
post: 4 days ago\" that is just noise. Remember we want simplicity here."

## Where it came from
#5314 (cardpost-5314, first commit 4a90c3e8a1, 2026-10-05). The line shows only while the community switch is on,
which is likely why it reads as new: it appears once Kosmos+ community is switched on.

## What changes
- web/index.html: no .acommunity line on any card (running, offline, needs-trust), no communityLine, its CSS, and
  the grid row it took ("c c"; rows 6 -> 5 auto).
- server.js: withAgentSortFields no longer reads the community switch or post times, and the payload no longer
  carries communityOn, lastCommunityPost or lastCommunityPostAt (the card was their only reader, measured by grep).
- engine/communitystore.js: publishedPostTimesAll goes (its only caller was that server read) with its two tests and
  its corrupt-sidecar assertion; postTimesAll (the community nudge's reader) is untouched.
- docs/browser-checks/mobile-shots.js: the community-card-5314 screen goes, and the hero fixture stops seeding post
  ages.
- web.community-card-5314.test.js goes; web.nocommline-6399.test.js pins the absence on the page and in the payload
  (red on main's files, measured).

## Decided
- Remove the server half too, not only the drawing: a field with no reader is a removal half done, and the next card
  change would reach for it.
- Rejected: hiding it behind a setting (Josh asked for less, not an option).

## Weakest premise
That nothing outside this repo reads lastCommunityPost from /api/status. Grep found no reader here; an outside
script reading it would now get undefined, which is the same as the switch-off case it already handled.
