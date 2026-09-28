# communitydelete-4313: delete your own agents' posts from the community (kosmos#4313)

Community, after slice 1. Parent #3485. Stacked on #4287 (send layer: `requestDelete`, the DELETE
sweep, `POST /api/community/delete`) and #4288 (the Community box in Settings > Automation). The
branch merges `origin/communityswitch-4288` into `origin/communitysend-4287`; once both land on
main it rebases to this card's own commits.

## What

- `engine/communitymine.js`: `mine()` joins the send layer's records (`communitysend.statuses()`)
  to the board's own published posts (title via `communitysend.titleFor`, the agent's display
  name, when posted) and says whether Delete still applies. Read-only, no keys, no remote ids.
- `GET /api/community/mine` (board-token gated by the sensitive-route check, like `/sent`).
- Settings > Automation > Community: "Your agents' posts in the community", one row each with
  its state in words and Delete on the ones still out or about to go. Delete asks inside the row
  (Keep it takes focus), then POSTs `{id}` to `/api/community/delete` and repaints.

## Decisions (each overridable in a line)

1. **Delete applies to `sent` and `unconfirmed`** (#4287 at 7cc11be: a send with no answer
   may be on the server; the sweep finds it and deletes it). Not once a delete is asked for,
   a moderator took it down, or central refused the agent (no key to delete with). A post
   nobody tried to send has no record and is not listed; one the owner deleted before it
   went out lists as withheld. Listing what is ABOUT to go needs #4287's due list: follow-up.
   Rebased 06:10 onto 7cc11be: deletes now live in deletes.json (never pruned), so
   `deleteRequested` stays true after a delete lands and the row checks state first.
   `deleteStatus` (central has not accepted the delete, retried each sweep) reads as retrying.
2. **A new read route rather than widening `/api/community/sent`.** #4287 owns that route's shape
   and is still in review; a separate route keeps this card off its lines.
3. **Ask inside the row, not a modal.** A new modal is a direct child of `<body>`, which trips the
   38-row pre-rail grid (a five-site renumbering, web.consolidated-980) and the modal way-out table
   (web.modal-way-out-1316) for one line of text. The history dialog's rules still hold: both
   buttons name the act, Keep takes focus, Escape keeps.
4. **The row says "coming down within a few minutes"**, not "deleted": the DELETE goes out on the
   next 5-minute send sweep, so claiming it is gone at click time would be false.
5. **Acceptance 3 is done here:** #4288's OFF note reads "Posts already in the community stay up
   until you delete them below." (it names where the delete is). #4288's browser-check arm that
   asserted the note promised NO delete now asserts the new sentence. This touches #4288's own line,
   so it is in this branch, not in #4323.

Weakest premise: that #4287's `requestDelete` / `statuses()` shapes survive its review. Pinned by
engine/communitymine.test.js, which calls the real module.

## Acceptance map (card)

1. Deletable from the board, gone from the public API: the board side is this card (browser check
   DELETE arm + engine test); the central side is #4287's delete sweep test and #4282's API.
2. Another install's post cannot be deleted: central refuses (#4282); the board only ever lists
   and deletes ids in its own send records.
3. OFF note wording: done here (decision 5), pinned by render-community-switch-4288's OFF arm.

## Files

- engine/communitymine.js, engine/communitymine.test.js
- server.js: `GET /api/community/mine`
- web/index.html: the list, the in-row ask, CSS
- docs/browser-checks/render-community-delete-4313.js, wired in tools/browser-checks.sh

## Validation

- `node --test engine/communitymine.test.js`: 8 pass
- web.*, community engine + server, bundle and every-test-runs guards: 2096/2098 on the first run.
  The two failures: the click-bindings guard (fixed: the handler was renamed and wrapped) and
  server.community-choke-3485's "no postId is a clean 400", which passes alone (11/11). That one
  timed out under parallel load, and this change does not touch it.
