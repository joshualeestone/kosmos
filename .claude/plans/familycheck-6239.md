# familycheck-6239 (kosmos#6239 slice 2: a browser check for the family's words)

Card: joshualeestone/kosmos#6239. Built on Renet's `familywords-6239` (the family consent panel), which had only a
page test against a stand-in document. Agreed with Renet 16:49 CDT 10-15; merges after familywords-6239.

## What this branch adds
- `docs/browser-checks/render-org-family-6239.js`: the real page (file://), fetch answered by a stand-in for the
  board's /api/org routes, in chromium and webkit. Arms F0 to F9: a company still joins at once with exactly
  { code, accepted, ticket }; a family stops after the preview and shows every part of its words with focus on them;
  Accept and join sends exactly { code, accepted: true, ticket, wordsShown: true }; Not now and Escape join nothing;
  another code closes the words; a refusal with a code closes them, org_bad_world keeps them; "Nothing is backed up."
  and hidden empty headings; a move joins only after Accept; 390 wide with no sideways scroll; no page errors.
- `docs/browser-checks/gated.txt`: the check is run by tools/browser-checks.sh (sorted).

## Measured
- All arms pass in chromium and webkit.
- Three mutants of web/index.html in a scratch copy, each red on the arm it should be: the family gate removed (F1),
  wordsShown dropped from Accept (F2), focus on Accept instead of the words (F1 focus).
- tools.browser-checks-wired.test.js passes with the check listed.

## Decided
- A new check rather than more arms in render-orgenroll-5531.js: that check pins #5791's company flow, and a family
  file can be deleted or changed with the family feature without touching it.

## Not covered
- Nothing here talks to a real coordinator; the coordinator's family words and its refusal without wordsShown are
  familykind-6239's own tests (kosmos-relay).

## Since (familyreaccept-6239)
The same check now also carries the re-accept screen's R arms; see familyreaccept-6239.md for what
they prove and the mutants that turn them red.
