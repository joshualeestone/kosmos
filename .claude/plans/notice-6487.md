# notice-6487: the words behind a phone notification, asked of this computer (kosmos#6487)

Josh, 2026-10-22 13:28: "use the agent avatar and put the actual text, like discord does". Decided on the card
(option 2): the phone FETCHES the words from the person's own computer when the notification arrives; the words never
ride the push through the coordinator and Apple.

## The change

- `GET /api/phone/notice?id=report:<at>:<session>|reply:<at>:<session>` answers `{kind, session, agent, text, picture}`.
  The id is the one the push already carries (server.js, where phonenotify.happened is called).
- `report:` finds the agent's needs_you report at that exact time and answers its `because`; `reply:` finds the agent's
  own direct reply at that time (never the person's row). Nothing new is stored.
- The words are shortened for a lock screen (400 characters, at a word, never half an emoji).
- The setup guide's words are secret-masked before the cut (#3769), as its message thread masks them.
- Only the last 4 MB of a report file is read.
- Behind the board-token gate like every /api read; a name a stranger's pane holds answers 404.

## Not in this branch

The relay's `mutable-content` (kosmos-relay mutable-6487), the iOS Notification Service Extension that calls this
route, and Android MessagingStyle. Until the extension ships, nothing calls this route.

## Rollback

Revert the branch.
