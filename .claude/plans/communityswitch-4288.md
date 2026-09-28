# #4288 part A: the Kosmos Community switch (Settings > Automation)

## Why

Community slice 1 (#3485). Every Community piece gates on one consent: "My agents take part in the
Kosmos community", default ON (Josh). The send layer (#4287, Pete) and the managed block (#4289) read
it; the contract is posted on #4288.

## The change

- `engine/communityswitch.js`: `read()` gives `{ on, ok, noticeSeen }`; `setOn`, `markNoticeSeen`, and
  `participating()` (the one gate: `ok && on`). Its own file, `store.ROOT/community.json`.
  - No file reads ON: fresh and existing installs alike, with no migration step that could run twice.
  - A present but unreadable or malformed file reads OFF and not ok (it could hide an OFF we cannot see).
  - A write over an unreadable file repairs toward OFF, never ON.
- `GET`/`PUT /api/community-setting` returning `{ on, ok, share }`, the `/api/feedback-setting` shape.
  `share` is null until community turns can be told apart in the usage data (#4289 decides how a post
  runs), so the page says "not measured yet", never 0.
- The Settings row, Mona Lisa's design from the card: its own "Community" box below the Daily report,
  the privacy could-not-read treatment (knob hidden, never a false Off), the OFF note, and the share
  line in Token Usage's own units (usageAbbr).
- `docs/browser-checks/render-community-switch-4288.js`, wired on `$B8`, answers every request at the
  browser, so it writes nothing.

## Split

Part A is the switch, the row and the share line. Part B is the one-time notice, a dialog built on What's
New's pattern, which took many review rounds for focus and keyboard handling alone. `noticeSeen` is
already stored here so part B needs no storage change. Acceptance 2 (the notice shows once) is part B's.

## Decided

- Share window: 7 days. The usage data is per UTC day, so the window is available (Mona's weakest
  premise, answered).
- Mona's mock showed "12.4K"; Token Usage's formatter writes 12,400 as "12K". The row uses the formatter,
  since agreeing with Token Usage was her rule, and the check pins the formatter, not a literal.

## Review 1

- No blocker. The OFF note promised "until you delete them", and slice 1 has no author delete (only central
  take-down, #4284). The copy now says only what is true: posts already in the community stay up. The delete
  itself is filed as its own card. The check pins that the note makes no delete promise.
- The share's rounding was unpinned (3.02% reads the same rounded or floored): a 2.5% fixture now reds a floor.
- Found by my own validation, not the review: web.settings-nav pins the Automation boxes' order, and the new
  Community box was missing from it. Added after Daily report, where Mona's design puts it.

## Review 2

- No blocker. An unreadable setting was tested in the engine but never through the route, so a route that
  always answered ok:true passed everything; server.test.js now puts a folder where the file should be and
  asserts the GET answers `{ on: false, ok: false }`.
- The reason-grep comment credited the check() line for the +1; it is the top-level .catch.
- Not changed: the could-not-read wording differs from the Daily report row's. It is Mona's copy from the
  card, and it is the wording most other switches on the page use.

## Weakest premise

That "no file means ON" is enough for "existing installs migrated once". It gives the same result, but a
machine never records WHEN it was opted in; if that is wanted later, the file gains a version field.
