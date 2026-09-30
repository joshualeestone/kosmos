# #4720: a prebuilt team's portraits are downloaded with the catalogue, not shipped

**Branch:** `portraits-4720` · **Card:** kosmos#4720 (found by the blind review of #4557)

## The defect

The Team screen (#4557, PR #4709, not merged when this was written) sets a new member's picture
by fetching `avatar.image` as a static file under this board's `web/`. Since #4632 the catalogue
is downloaded, not shipped, so no such file ships with Kosmos. Every member's `avatar.image` is
unset today, so nothing is wrong yet. The moment the catalogue repo publishes one portrait, every
row would read "(portrait not set)".

## The call

**Portraits are published beside `catalogue.json` and the board downloads them.** The board
fetches the one file the signed catalogue names for a member, uses it only when its sha256 is the
one the catalogue carries and it is a WebP image, keeps it in the data folder, and serves it to
the page from the board's own address.

This was already half built, which I found only after deciding it: kosmos-catalogue's `build.js`
publishes `avatars/<team>-<slot>.webp` and writes `avatar.image` and `avatar.imageSha256`, its
README says the hash is there "so an image fetched beside the catalogue can be checked too", and
chaoskosmos-site #174 already passes `/catalogue/avatars/<file>.webp` through. The Kosmos side
was the only missing part. So this change uses those names exactly (`imageSha256`, not a new
field), and the catalogue repo needs no change.

Rejected:
- **Ship them in the app** (`web/avatars/teams/`). A team published on Tuesday would have no faces
  until the next Kosmos build, which is the coupling #4632 removed.
- **Embed them in `catalogue.json`.** Every role-picker open would download every portrait.
- **Let the page fetch from installkosmos.com.** The page cannot check a hash against a signature
  it never saw, so a portrait would be the one catalogue field taken on trust.

## What changes

1. `engine/catalogue.js`: `portrait(teamKey, slot)`. Reads the held catalogue only (it never
   downloads the catalogue). Refuses any `avatar.image` that is not `avatars/<id>.webp` and any
   hash that is not 64 lowercase hex, before any request. Downloads with the builder's own cap
   (512 KiB), asks once more past the caches on a mismatch (as `refresh()` does for the signature),
   keeps the file under its sha256, removes kept portraits the catalogue no longer names. A failed
   download is not repeated for a minute. Never throws.
2. `server.js`: `GET /api/catalogue/portrait?team=&slot=`. 200 with the image, or 404 with the
   reason. Nothing in the request chooses an address.
3. `web/index.html` `tcPortrait`: read from that route instead of `/<avatar.image>`. **Not in this
   branch**: the function exists only on #4709. It is one line and follows when #4709 is on main.

## Gaps decided, not missed

- **The route is a GET that can start a download**, so another page open in the same browser can
  trigger it with an image tag. What it can cause is bounded: a fetch of a path the signed
  catalogue names, at the catalogue's own address, at most once a minute per portrait while it
  fails and never again once kept. It cannot read the answer.
- **Until `tcPortrait` changes, nothing calls the route.** The catalogue repo must not publish a
  portrait before a build carrying both halves is served (the card says the same).
- **A Kosmos older than this change** that meets a catalogue with portraits shows "(portrait not
  set)" on each row and makes the agents. That is the card's stated failure, confined to old builds.
- **Windows:** nothing here is platform-specific (node fs and fetch only). Not measured on Windows
  beyond CI.
- **No portrait is shown before the team is made.** The Team screen lists members by name today;
  showing faces in the list is its own change.

## Weakest premise

That a person making a team is online at that moment. They are in practice (the Team screen just
downloaded the catalogue), and when they are not the agent is made without a picture.

## Tests

- `engine/catalogue.portrait-4720.test.js` (16): the happy path and its address, kept and not
  asked again, wrong image refused after one ask past the caches, stale cache recovered, the
  minute's gap and `force`, not a WebP, over the cap with an at-the-cap control, nine bad paths
  and six bad hashes never fetched, a damaged kept file, pruning leaves a download under way
  alone, six asks one download, unknown team and member, a test run downloads nothing, the
  address follows `KOSMOS_CATALOGUE_BASE`.
- `server.catalogue-portrait-4720.test.js` (5): through a real board against a real local web
  server standing in for the catalogue address.
