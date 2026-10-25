# needskey-7108: a question's dismiss key cut on a code-point boundary

**Done when:** a question whose 300th UTF-16 unit splits an emoji gives a needsYouKey that ends before it (no lone
surrogate in the projects answer), the shortened key still dismisses, and the board's fallback cuts the same way;
tested with a control; merged.

## Decisions
- Drop a trailing lead surrogate after slice(0, 300), in the engine (needsKeyWords) and the board's keyOf fallback.
  Cutting by code points instead would change the length rule dismissNeeds checks; dropping one unit keeps every
  existing key and only shortens the broken ones.
- One helper, engine/textcut.js cutUnits, used by the key and by the self-report's caps (selfreport capped and
  cappedSentence cut `because` at 1000 the same broken way, and that text also travels in /api/projects).
- The dismissal store (needsDismissed, needsDismissGone) is left out of the projects answer: no page or server code
  reads it, and a key stored before this fix could carry half an emoji (review 1). dismissNeeds refuses a key that is
  not well-formed. A dismissal stored under an old broken key no longer matches: that row shows once more.
- web/index.html changes a pure key helper inside pjNeedsNotice, nothing drawn: a Browser-check trailer, with the
  board line pinned in the engine test.
- Weakest premise: the iPhone's refusal was measured on a minimal JSON string by the #7106 reviewer, not on a full
  /api/projects answer through the relay.

## Steps
1. Engine, board, test. DONE: engine/projects-needskey-7108.test.js 3/3 (control: the old cut fails test 1);
   projects-needsquiet-6341 green.
2. Review loop.
   - Round 1: 0 blockers, 2 warnings, 2 nits. Fixed: the stored dismissals left out of the answer and broken keys
     refused (a legacy stored key reached the phone); the 1000-unit self-report cut made code-point safe through
     the shared cutUnits; the whole project's JSON checked with the simpler lone-escape regex (any escaped
     surrogate is lone). Recorded: the board-line test is a source pin (a fallback only for a missing key).
     needskey 6/6 with needsquiet, selfreport and the dismiss route: 68 pass.    - Round 2: 0 blockers, 2 warnings, 2 nits. Fixed: commitments (`what`, cut at 300 on report and on read, in every
     /api/status poll) through cutUnits; a self-report stored before the fix is made well-formed on read (latestOf:
     because, on, owner via toWellFormed); the ten 240-unit screen-line cuts in status.js (evidence in /api/status)
     through cutUnits. Recorded: the board fallback test stays a source pin. needskey 8/8 (controls: the old
     commitment cuts and the raw stored read each red); commitments, needsquiet, selfreport, dismiss route: 127 pass.
   - Round 3: 0 blockers, 3 warnings, 1 nit. Every round found another path (a pane title cut at 160, a role at 60,
     a commitment sent with a broken character, a project description stored as given, measured), so the fix is now
     also a last line of defence: the server writes /api/status and every sendJson answer through strictStringify,
     which makes every string well-formed (a lone half becomes U+FFFD; well-formed text unchanged). The cuts stay
     code-point safe so ordinary long text loses no character to U+FFFD: oneLine and the role cut through cutUnits,
     commitments made well-formed first. server.strict-json-7108.test.js over HTTP on a sandboxed board (control:
     plain JSON.stringify in sendJson is red). The stored-report test covers on and owner too. Recorded: no test
     drives each of the ten status.js evidence cuts at an emoji; the server's strict writing covers them whatever
     they cut. needskey 8/8, strict-json 3/3, with commitments, selfreport, needsquiet and the dismiss route: 138 pass;
     status.test.js 242 pass.
   - Round 4: 0 blockers, 1 warning, 5 nits. Fixed: strictStringify mends object keys too, at any depth (a replacer
     sees only values; tested); the Codex hook dialog's source and command cuts (160, 159) through cutUnits; tests
     that can fail for selfreport's capped (on at its cap) and commitments' capForDisplay (a stored broken
     character), each with a red control. Recorded: the status HTTP test's live half has nothing broken to catch in
     a sandbox (its source check is what fails); oneLine and the role cut have no emoji test (the strict writing
     covers them). needskey 10/10, strict-json 3/3, with commitments, selfreport, needsquiet, the dismiss route and
     status.test.js: 382 pass.
3. Validation, PR.
