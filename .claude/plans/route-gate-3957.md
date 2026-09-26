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

## What it reads, and does not
The test's header is the current statement (it has changed each iteration; see below). In short:
page /api literals in code and in JS-built markup; board literals compared to the path, prefixes,
and route regexes; not the method; two permissive matcher limits, each pinned by a test.

## Verification
- Green on main: 185 paths read, all served (iteration 0 read 139, several of them junk).
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

## Challenge-loop iteration 2
- BLOCKER (mine, from iteration 1): the comment scanner ended every string at a line break, so a
  `//` inside a multi-line template literal hid a real call after it. Replaced by one lexical mask
  (code / comment / string / string start / regex). A page literal must be a real string START.
- BLOCKER: a comparison quoted inside a board log string counted as a route. A board literal now
  counts only when its quote is a real string start and its `===` is code.
- The lexer then mis-read the page (193 -> 171 paths, the federation routes among the lost): a
  backtick inside a regex literal opened a phantom template. Regex literals are now recognised.
  The paths floor is 170, near today's 186, so a silent drop like that one reds.
- Base parses memoized; CLAUDE.md gains convention 7 for this gate.
- History re-run: red on exactly /api/federation/invite, /join, /verify at 07a786f9a.

## Challenge-loop iteration 3
- The lexer follows `${...}` to any depth (a recursive code/template scan), so a nested template
  cannot desynchronise it; an /api literal inside an interpolation is now read. HTML comments are
  comments. Control added for the nested case.
- The floor is 180 (today 185): the old 170 sat UNDER the 171 of the slip its own comment cited.
- JS-built markup (src=, href=, action= inside a string) is read; control added.
- The free-segment board limit (`/api/project/<id>` serves a new `/api/project/templates`) is
  documented in the header and CLAUDE.md and pinned by a test, alongside the placeholder limit.
- The unread fetch count ignores comments (19; ceiling lowered to match).

## Challenge-loop iteration 4
- BLOCKER (mine, iteration 2's lexer): a `/` starting a line was always taken for a regex, so a
  division continued from the previous line swallowed the next string, fetch( included. Regex vs
  division is now decided from the previous real token across line breaks; control added.
- Board literals read in either quote; route regexes are taken from the lexer's REGEX spans (so a
  grouped anchor, /^\/api(?:\/a|\/b)\//, is read); controls added. Both failed safe before.
- History re-run: red on exactly the three federation routes.
