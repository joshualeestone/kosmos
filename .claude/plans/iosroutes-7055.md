# iosroutes-7055: the board still answers every route the iPhone app calls (slice 6 part 1, #6838)

**Done when:** a test on main, run by tools/run-tests.sh and by CI on every PR (test.yml has no path filter), fails
when the board stops answering a route the iPhone app or its notification extension calls, naming the route and
the Swift line that calls it.

## Decisions
- Routes are read from the Swift source, not listed by hand, so a new call in the app is covered by itself. A floor
  (10; today 15) fails a parser that stops matching.
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
   the extension's avatar declared, sandbox parity). 3. Validation, PR. 4. Part 2 (light, dark, accessibility) after coordinating View files; Angel
   keeps SignInView/SignInClient/SignInLogic.swift (#7050 slice C).
