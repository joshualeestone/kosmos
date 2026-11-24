# avcache-9004: a changed card draws its avatars from cache (kosmos#9004)

Stacked on alistav-8990 (#8990), which versions every grid, list and working-line avatar URL (?v=<avatarVer>) and
stops idle polls from rewriting the grid and the list.

## Problem (from #8990's review, round 8 and the final whole-branch read)
The grid and the list are each one innerHTML write. When any one card changes (a working agent's memory reading or
task line), the whole container is rewritten and every avatar in it rebuilt. The agent avatar route answers
`cache-control: no-store`, so every rebuilt picture is fetched again: a room beside a working agent still reloads.

## Decision
`GET /api/agent/<name>/avatar?v=<current version>` answering 200 sends
`cache-control: private, max-age=31536000, immutable`. The version is the file's rounded mtime, the same value status
cards carry as avatarVer (store.avatarVersion), read from the stat the route already makes. Everything else keeps
`no-store`: no v, an old or malformed v (it may name a picture since replaced), and every refusal (404 and the auth
gates answer before this line). A retry URL (#8990's retry=N) with the current v is still the current picture.

Rejected:
- Caching any `?v=` request: an old v would cache the NEW bytes under an old URL. Harmless in practice (the markup moves
  to the new v), but the exact-match rule costs nothing and leaves no window.
- A per-card diff of the grid and list (patch only changed cards): removes the rebuild itself, but a much larger
  change to two paint functions and every check that reads them. The cache makes the rebuild cost nothing on the wire.
- `public` caching: the picture is behind the board's own auth; `private` keeps shared caches out.

Weakest premise: that the browser keeps an image it was told it may keep across an innerHTML rebuild in the same page.
Arm 5 measures it in Chromium (network fetches with fromCache() false). WebKit is not measured here.
Not checked: whether the relay (remote access) passes the cache-control header through unchanged.

## Tests
- server.avatar-cache-9004.test.js: current v cacheable (also with retry=N); no v, old v, v=0, malformed and
  `<v>.0` stay no-store; a missing picture is never cacheable; a new picture changes the version and the old one
  stops being cacheable.
- render-avatar-steady-8990 arm 5: three forced rewrites rebuild every avatar in both containers; none is fetched
  over the network. Control: the same arm on alistav-8990 (no-store) is expected red.
