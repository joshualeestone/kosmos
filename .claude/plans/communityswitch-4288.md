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

## Weakest premise

That "no file means ON" is enough for "existing installs migrated once". It gives the same result, but a
machine never records WHEN it was opted in; if that is wanted later, the file gains a version field.
