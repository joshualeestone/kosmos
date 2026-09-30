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

- **The route is a GET that can start a download.** Another website cannot reach it: `/api/`
  needs the board token, the cookie is SameSite=Strict, and the route calls `crossSiteRead` like
  the other GETs that make this computer fetch (it accepts only `same-origin` and `none`, so a
  page on another local port, which is `same-site`, is refused too). What is left, on a board that does not
  enforce the token: a request carrying neither header at all (`crossSiteRead` lets that
  through, as it says itself), one with no Sec-Fetch-Site and a loopback Referer, or a program
  on this computer.
  What it can cause is bounded: a request for a path the signed catalogue names, at the
  catalogue's address, at most two asks a minute per portrait while it fails (the plain ask and the
  one past the caches; an ask that is redirected is more than one request), one when it succeeds, and none after that: kept on disk, or held in
  memory when the disk refuses the save. A page that is not the board's cannot read the bytes;
  an image tag could tell a picture from an error, and its size. The pictures are public.
- **The route can answer late.** Each of the two asks may take the full 8 s timeout, so a slow
  catalogue address can hold one answer for about 16 s (measured by review 4: 8.0 s for one
  stalled ask). The agent is already made by then, so nothing is lost, but **`tcPortrait` must
  not wait for one member's portrait before starting the next**: six members in a row would be a
  minute and a half of nothing. That is a requirement on the #4709 follow-up line.
- **The download follows redirects**, as the catalogue's own download does. A host that serves
  the catalogue address could send the board to another address; the answer is still refused
  unless it is the named image, so this is a request the board makes blind, by someone who
  already controls what the catalogue address serves. Not changed here, so the two downloads
  behave alike.
- **A portrait republished under the same file name while the board holds the older catalogue.**
  File names are `avatars/<id>.webp`, not content-addressed. A board holding serial N asks, gets
  the new image, asks once past the caches, gets it again, and refuses it: that member is made
  with no picture until the board takes serial N+1 (the Team screen asks for the catalogue each
  time it opens, at most once in ten minutes). The ask past the caches covers only the reverse
  case. Not built: forcing a catalogue download in the middle of making a team would change the
  team under the person. A wrong picture is never shown; a missing one costs a retry later.
- **Two Kosmos processes sharing one data folder with different catalogues** would prune each
  other's portraits. The cost is a second download.
- **A crash between write and rename** leaves one `<sha>.webp.<pid>.tmp` (at most 512 KiB) that
  nothing removes.
- **Until `tcPortrait` changes, nothing calls the route.** The catalogue repo must not publish a
  portrait before a build carrying both halves is served (the card says the same).
- **A Kosmos older than this change** that meets a catalogue with portraits shows "(portrait not
  set)" on each row and makes the agents. That is the card's stated failure, confined to old builds.
- **Windows:** nothing here is platform-specific (node fs and fetch only). Not measured on Windows
  beyond CI.
- **No portrait is shown before the team is made.** The Team screen lists members by name today;
  showing faces in the list is its own change.

## Review 1 (blind, opus): 0 blockers, 3 warnings, 7 nits

Fixed: the prune's keep list had no test (a second member's kept portrait now must survive); a
portrait whose save fails was downloaded on every ask (now held in memory, tested with a file
where the folder should be); the failure and in-flight maps were keyed by hash alone, so two
members sharing an image under two names shared one failure (now hash and name); the route
lacked `crossSiteRead` and an answer for a throw inside its handler; each arm of the WebP test,
the declared-size refusal, the minute's gap expiring and the response headers are now pinned.
One line removed because nothing could pin it: the delete of a damaged kept file (the good copy
replaces it on rename). I also removed the 20-byte length check as redundant; that was WRONG (see
review 2). Decided, not built: the three gaps added above. My first version of the first gap said
another website could trigger the route with an image tag; that was wrong, and the reviewer
showed why.

## Review 2 (blind, sonnet): 0 blockers, 3 warnings, 3 nits

- W: **my claim that the 20-byte check was redundant was false.** A 16-byte file can carry every
  mark the WebP test reads and no image; the reviewer ran every length from 0 to 24 and nine were
  accepted. The floor is back and a 16-byte case is in the test. (The hash still had to match the
  signed catalogue, so nothing could have been served that the catalogue did not name.)
- W: two guards had no test: the prune keeping the portrait just saved when the catalogue is
  replaced while it downloads, and the prune dropping a held-in-memory portrait the catalogue no
  longer names. Both are pinned now, through a real republish (`refresh` with a newer serial).
- W: **"23 guards removed one at a time, each red" overstated it.** What is true now: 27 single
  removals in `engine/catalogue.js` each turn a test red, and 2 in the route. These stay green
  and are left as they are, stated: in the route's handler, the early return when the response
  is already gone, the catch around the answer, and the headers-sent check in its 404 (each
  defends against a state I could not produce in a test).
- N, taken: the 404 body is `{ error }` like the rest of the board, not a second shape; the cap
  is pinned as the literal 524288; the comment on the in-memory hold says when an entry is
  really dropped.
- N, decided and left: redirects are still followed (see the gap above). What would change my
  mind: a measurement, once a real portrait is published, that the live address never redirects;
  then both downloads should refuse redirects together.

## Review 3 (blind, fable): 0 blockers, 1 warning, 4 nits

- W: the route test's "refused before the board fetches anything" could not fail: it asked for a
  member an earlier test had already failed on, so nothing would have been fetched either way
  (the reviewer moved the refusal to after the download and the file stayed green). Each
  downloading test now has its own member, and the control is the same request from the board's
  own page: answered, and fetched only then. The "second ask" test no longer leans on the first.
- N, taken: the residual in the first gap named the wrong thing (another local port is refused).
- N, decided and left: the route answers GET only (the page uses GET; nothing sends HEAD). The
  kept copy is read without a size check (the folder is the person's own data folder; a check
  there is a guard no test could turn red). Redirects: as review 2.

## Review 4 (blind, opus): 0 blockers, 1 warning, 5 nits

- W: my fix for review 3's warning was itself weak. The "refused before the board fetches" test
  raced the download it was meant to catch: with the refusal moved after the download started,
  the reviewer saw it pass 6 runs in 30. So "can now fail on ordering" was true about four times
  in five. It now waits for a stray download to land and also checks nothing was kept; I ran the
  same mutation 30 times after the change (result in the proof).
- N, taken: the cap on the ask past the caches is pinned; the two-names test asks both at once,
  so the in-flight map's key is pinned as well as the failure map's; the clean-up of a
  half-written file is pinned with a save that fails at the rename; one line that could never
  run (dropping the in-memory copy after a save that cannot be reached while it is held) is
  removed; the first gap names the whole residual; the late answer is a recorded gap with a
  requirement on the follow-up.

## Review 5 (blind, sonnet): 0 blockers, 1 warning, 2 nits

- W: my review 4 change un-pinned what review 1 had pinned. Asking the two names at once pins
  the in-flight map's key, but both asks are past the failure check before either fails, so the
  FAILURE map's key was no longer tested (the reviewer keyed it by hash alone and the file
  stayed green). Review 4's line above, "pinned as well as the failure map's", was therefore
  false when written. There are now two tests: at once (in-flight key) and one after the other
  (failure key); each key, keyed by hash alone, turns its own test red.
- N, left: the in-flight entry is set after the download's closure has started. Nothing before
  its first await can throw today (`base()` and string joins). N, not taken: the reviewer read
  `setup()` as leaving the in-memory hold between tests; it clears it (`useKeyForTest`).
- The product code has not changed since review 2 except one line that could never run. Rounds
  3, 4 and 5 each found a test that did not pin what the round before had claimed, each caused
  by my own previous fix.

## The removal sweep, re-run whole after review 5

The counts quoted in reviews 1 and 2 above are what was true then. On the head after review 5 I
re-ran every one in a single pass: 29 single removals or weakenings in `engine/catalogue.js` and 2
in the route each turn a test red (31 of 31), and so does keying either map by the hash alone
(each its own test). That is 31 of the ones I tried, not every line: see review 6 for the ones a
reviewer found still green.

## Review 6 (blind, fable): 0 blockers, 0 warnings, 3 nits. CONVERGED

The reviewer ran its own sweep of 51 removals it chose itself: 44 red. The 7 that stay green, all
left as they are: in the route, the early return when the response is gone, the catch around the
answer, the headers-sent check in the 404, the GET-only check (decided in review 3) and the
rejection arm of the promise (`portrait()` never rejects); in the engine, writing through a
temporary file and a rename instead of straight to the final name (the difference only shows
if the process dies mid-write), and the `try` around the prune's delete (it throws only on a
permission error). Unmutated, both files were green 10 runs of 10; the three timing-dependent
removals were red 20 of 20 each.

Nits, taken in this file only (no code or test changed after this review): the sweep sentence
above no longer reads as a complete list; "two a minute" counts asks, and an ask that is
redirected is more than one request (the redirect gap already says redirects are followed).
Not taken: a remembered failure is not dropped when the catalogue is replaced (about 200 bytes
per portrait ever named, and the same name with the same hash failing is still true).

## Weakest premise

That a person making a team is online at that moment. They are in practice (the Team screen just
downloaded the catalogue), and when they are not the agent is made without a picture.

## Tests

- `engine/catalogue.portrait-4720.test.js` (28; see review 2 for what removing a guard does and does not turn red): the happy path and its address, kept and not
  asked again, wrong image refused after one ask past the caches, stale cache recovered, the
  minute's gap and `force`, not a WebP, over the cap with an at-the-cap control, nine bad paths
  and six bad hashes never fetched, a damaged kept file, pruning leaves a download under way
  alone, six asks one download, unknown team and member, a test run downloads nothing, the
  address follows `KOSMOS_CATALOGUE_BASE`.
- `server.catalogue-portrait-4720.test.js` (6; the cross-site refusal and the no-store header each red when removed): through a real board against a real local web
  server standing in for the catalogue address.
