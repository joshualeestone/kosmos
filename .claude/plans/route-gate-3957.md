# route-gate-3957: the page must not call an /api route the board does not serve

## Why (measured)
0.6.96 shipped a page calling /api/federation/invite (and join, verify) whose board routes arrived
in a LATER merge (#3312 = 07a786f9a, then 81f1eed5c); the cut landed between them. Josh: "Kosmos
could not make a code just now".

## Decision
A static repo test, web.api-routes-3957.test.js, reading both web/index.html and server.js:
every /api path the page fetches must match a board route (a literal, a startsWith prefix other
than the bare '/api/' catch-all, or a route regex). It reds the UI PR at merge time, before any cut,
and needs no runtime flag.

## Rejected
- Driving every page call against a booted board: would EXECUTE real handlers (some POSTs reach
  outside services) to learn only what reading the code already says.
- A runtime feature flag on the UI: one more thing to forget, and it hides the gap.

## What it reads, and does not (also in the test's header)
- Page: fetch( with a literal '/api/' first argument; dynamic pieces become placeholders; a query
  glued on without '/' is dropped. NOT read: a URL that is a variable (20 today), or one with a
  variable tail (1 today, printed by name).
- Board: '/api/...' literals, startsWith prefixes, regex literals (scanned by hand: a `[^/]` class
  broke the naive pattern, which found 4 of 55).
- A placeholder is served if SOME value makes it a route: any single segment of a literal, a number
  (ids are `(\d+)`), or a regex's enumerated word. Permissive: a per-provider route the page reaches
  with a name the board lacks is not caught.
- NOT the HTTP method.

## Verification
- Green on main: 139 paths read, all served.
- Controls in the test: a planted missing route is caught; the invite route renamed away is caught.
- HISTORY: run against 07a786f9a (the page + board that shipped the bug), it reds naming exactly
  /api/federation/invite, /join, /verify; with 81f1eed5c's server.js it is green.
- Wrong turns caught by those controls: the first version passed vacuously (the bare '/api/'
  catch-all counted as a prefix serving everything; the regex scan found 4 of 55), and a skip
  pattern that stopped at the first ')' collapsed 41 paths into one (99 read, now 139).

## Challenge-loop iteration 1
- Page: every quoted '/api/' literal in CODE is read, not only fetch( arguments (44 went through
  helpers: a post wrapper, an endpoint table, `url:` fields). Comments are skipped; a literal the
  page only compares against (startsWith, ===) is not a call. 193 paths read.
- Board: a literal counts only where the server COMPARES the path to it (=== / case), outside
  comments; a comment or log line naming a future route no longer serves it (control added).
- The unread and variable-tail counts have CEILINGS (20, 1): growth reds instead of scrolling by.
- The placeholder limit is pinned by a test that asserts it: '/api/federation/x' still reads as
  served with invite removed, because join fills it. The gate catches a missing route only where the
  page names it literally.
- Historical pair re-run: still red on exactly the three federation routes.
