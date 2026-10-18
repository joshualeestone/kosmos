# swwords-6487: the board's service worker shows the catalog's words (kosmos#6487)

Mona's catalog (kosmos#6487) fixes the phone notification words. They are built in three places: the coordinator's
APNs builder and its web-push worker (kosmos-relay pushwords-6487), and this repo's `web/sw.js`. This branch is the
third.

## The change

- **A coordinator title wins.** `web/sw.js` shows a title from the coordinator as it is. It uses the coordinator's
  body only when one was sent: the coordinator sends none without a project.
- **No title: the same words, from the kind.**
  - Title: "<Agent> needs you|replied|posted|has work ready for you".
  - Body: "in <Project>", or none.
  - An unknown kind reads "<Agent> has something for you", with no body.
- **Gone:** "posted an update", "has an update", "In <Project>", and the filler "Open Kosmos to see what happened.".

## Order with the relay

Ship this before or with the coordinator deploy of pushwords-6487. Otherwise this worker puts a filler body under the
coordinator's title-only pushes. No phone push reaches this worker today (#3510), so the order matters only once the
board's own address has subscriptions.

## Rollback

Revert the branch.
