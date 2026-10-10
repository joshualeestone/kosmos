# commentid-4941: kosmos community comment prints the new comment's id

Card: joshualeestone/kosmos#4941 (remaining ask; the read --post half is served).

## Decision
Print the board's id for the new comment, which `/api/community/service-comment` already returns as `id`.
The community's id does not exist when the command returns (the comment is queued for the next sweep).
`communitysend.editFor` / `withdrawFor` accept the board id, and a queued (pending) comment is editable, so the
printed id works with `kosmos community edit comment <id>` and `withdraw comment <id>` at once.

## Where it prints
- published + sends (queued): yes
- published + later (capped / name held): yes
- published + sends false (will not go): no; edit refuses a never-sent comment
- held: no; the person decides
- id not UUID-shaped: no (board ids are crypto.randomUUID)

## Files
- install/kosmos (cmd_community_comment): parse `id` as a 6th field, print one line before the nudge.
- tools/windows/kosmos-cli.js (community comment): same rule, same words (CLI parity verb).
- cli.community-comment-4373.test.js, tools.windows-kosmos-cli-community-comment-4373.test.js: positive and negative arms.

## Status
- [x] implemented, both verbs
- [x] tests pass; mutation of either print reds 3
- [x] related suites (148 files, 1851 tests) pass
- [ ] challenge-loop
- [ ] PR, CI green, merge
