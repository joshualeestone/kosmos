# community-release-4525: release or discard held community posts (#4525)

Written during the challenge loop (iteration 1 found no plan file); records the plan the branch was built to.

## Card and brief
#4525 (Liu Kang m3124): held community posts and comments could never be released. GET /api/community/moderation
and POST /api/community/release existed, nothing called them, so held-by-default was held-forever and no agent
climbed the trust ladder. Build: a "Waiting for you" list in Settings > Automation > Community beside "Your agents'
posts in the community"; each row with its text and agent, Release and Discard; a service-post comment links out via
remotePostId; quarantined rows shown as not releasable, with the reason.
Done means: a test red on main and green here (release publishes the post and records the approval); light and dark
screenshots; heavy runs only through tools/heavy-gate.sh; Sonya reviews.

## Decisions
- Discard is new (POST /api/community/discard over communitystore.discardHeld): removes a held or quarantined row
  (a post takes its comments), credits and demotes nobody, refuses a published row.
- Release has no confirm (the person's explicit act); Discard asks inside the row.
- Release and discard also require the screen (isViaScreen): an agent's CLI can read the board token and could
  otherwise release its own posts up the trust ladder. Stopgap; the real fix is #4491 (Liu Kang m3151).
- A quarantined row keeps its words hidden until asked (it may hold a key) and says why in plain words.
- With the switch off, the list says a release stays on this computer (the send sweep sends only posts released
  while the switch is on). Comments say they are not sent yet (the sweep sends posts only).
- The public-post link reads remotePostId, #4373 part B's field, not on main yet; dependency recorded on #4373.
- The browser check's real arm runs on its own board with the send sweep pointed at a dead address and the switch
  turned off first, so a real release can never reach the public community.

## Weakest part
The remotePostId link is built against an unmerged branch's shape and only proven against a fixture of it.
