# iosroutes-7055: the board still answers every route the iPhone app calls (slice 6 part 1, #6838)

**Done when:** a test on main, run by tools/run-tests.sh and by CI on every PR (test.yml has no path filter), fails
when the board stops answering a route the iPhone app or its notification extension calls, naming the route and
the Swift line that calls it.

## Decisions
- Routes are read from the Swift source, not listed by hand, so a new call in the app is covered by itself. A floor
  (10; today 12 paths, 15 method-and-path pairs) fails a parser that stops matching.
- "Answered" means the board's reply differs from its reply to a made-up path at the same depth, measured in the
  run (today: 404 {"error":"no such endpoint"}). Rejected: "not 404", because real routes 404 for an unknown agent
  or project ("there is no project by that name").
- The one variable-method site (SettingsLogic, GET and PUT /api/phone-notify) is declared, and the declaration is
  checked against the source.
- Only board routes: /v1 (coordinator) and /_kosmos (relay gate) live in other repos. Out of scope too: the phone's
  links into board pages (/?tab=detail&agent=, /?tab=projects&project=, /?project=&task=), a contract with what
  web/index.html reads at boot, not a server.js route.
- Review 1: the two attachment routes (full path from the board, so no literal) are declared and pinned to
  BoardLogic.swift; the method is read to the end of its request builder and every httpMethod line in a file that
  calls the board must be claimed; the unknown-route control is byte for byte at every method and depth used.
- Weakest premise: a route that still exists but changed its reply SHAPE passes. The phone's parsers are tested
  against captured JSON in ios/LogicTests, which a shape change would not update; a shape check is a follow-up.

## Steps
1. Test + controls (a renamed board route goes red, naming BoardLogic.swift:357). DONE.
2. Review loop (round 1: 0 blockers, 3 warnings, 5 nits, all addressed; round 2: 0 blockers, 3 warnings, 4 nits,
   all addressed: brace-depth request scope, one claim per line, a variable method only on a declared route with its
   callers matched exactly, comments and raw strings stripped, nested interpolations, the per-route sibling control,
   the extension's avatar declared, sandbox parity; round 3: 0 blockers, 3 warnings, 5 nits, all addressed: one
   whole-file Swift scanner (line and nested block comments, multi-line and raw strings, nested interpolation
   parens), braces counted on string-blanked code, a request's scope ends at the next request that builds its own
   URL, two literals on one line or a route passed to an undeclared helper is a problem, the extension's helper
   declared and its body pinned, a method-loss control). Rule now: whatever cannot be attributed with certainty is a
   loud problem, never a silent GET.
   Round 4: 1 blocker (a board route not written as one literal was skipped silently), 2 warnings, 2 nits, all
   addressed: partial board paths, + joins, joins onto unknown bases, unknown paths and board paths in raw or
   multi-line strings are problems; other services only on positive evidence; every httpMethod in the app claimed;
   the variable-method callers matched loosely and counted. No false red on today's tree (17 routes, 0 problems).
   Round 5: 2 blockers (a method taken from the next request bound to another variable; a request whose URL is
   built elsewhere neither read nor reported) and a warning (false reds on ordinary Swift). Five rounds of route-
   string heuristics kept missing shapes, so the parser was redesigned to count REQUESTS: every URLRequest or
   URLSession-from-URL in the app is a board route in place, another service, a web view page load, or declared in
   SITES; a method is read only from the request's own variable; every httpMethod must belong to a request. The
   string heuristics (partial paths, joins, helpers) are gone, and a permanent control test feeds the parser the
   shapes that once slipped through and ordinary non-board Swift.
   Round 6: 2 blockers, 4 warnings, 2 nits (all silent cases on plausible Swift), all addressed: a declared helper's
   callers are read and must match (scoped to the file only while the helper stays private, which is checked); an
   https URL with a board path is reported, not skipped; nothing may extend a literal; a method set in a branch or a
   URL replaced after building is reported; URLRequest.init, NSMutableURLRequest and URLSession or Data fetches from
   a URL count as requests; page loads only on webView; httpMethod == is not a set. Each has a control case.
   Round 7: no silent finding on today's tree; 2 warnings and 2 nits on plausible Swift, all addressed: every
   "/api/..." route in the app must be used by a request on its line or tied to SITES (closes a route written away
   from its request); a bare reassignment is a new request; an early exit before the method makes it conditional;
   other-service evidence read from the request's own argument. Each has a control case.
3. Validation, PR.
4. Part 2 (light, dark, accessibility) after coordinating View files; Angel keeps SignInView, SignInClient and
   SignInLogic.swift (#7050 slice C).
