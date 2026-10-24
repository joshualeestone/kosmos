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
- Only board routes: /v1 (coordinator) and /_kosmos (relay gate) live in other repos.
- Weakest premise: a route that still exists but changed its reply SHAPE passes. The phone's parsers are tested
  against captured JSON in ios/LogicTests, which a shape change would not update; a shape check is a follow-up.

## Steps
1. Test + controls (a renamed board route goes red, naming BoardLogic.swift:357). DONE.
2. Review loop. 3. Validation, PR. 4. Part 2 (light, dark, accessibility) after coordinating View files; Angel
   keeps SignInView/SignInClient/SignInLogic.swift (#7050 slice C).
