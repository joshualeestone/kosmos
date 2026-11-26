# #9161: file:// browser checks red in a headed hand run; one shared pattern for their start-up fetch noise

Found on #9158. Measured on origin/main 3fb2aec358 with the pinned runtime (Playwright 1.62.1 / Chromium 1234), one
queued turn, all 17 checks that carried a `URL scheme "file"` filter: **14 red headed (35 to 754 false FAILs each),
all 17 green headless** (table on #9161). The gate runs headless, so it was right; a person's headed hand run was not
readable.

Cause: each check skipped its own `file://` fetch failures with a copied pattern that knew only the headless shell's
words. Full Chrome words the same refusal as `Access to fetch at 'file:///api/...' from origin 'null' has been blocked
by CORS policy: ...`. render-computers-4648 had its own wider pattern, but its CORS arm expected "only supported for
HTTP" and Chromium 1234 says "only supported for protocol schemes", so it was red too.

## Change
- docs/browser-checks/lib-file-console.js: `isFilePageNoise(text)`, the old pattern's arms plus one CORS arm anchored
  to a `file:///` URL AND origin 'null'.
- The 13 checks with the identical copy now call it (one require, one line each). render-computers-4648 keeps its own
  HARNESS (it also filters pageerror and WebKit's words) and adds the shared arm on its console path.
- render-inline-field-errors-2606 is not touched: #9158 (PR #9164) serves it from a board and drops the copy.
- browser-checks-file-console-9161.test.js (6): the headed line as printed, the headless wordings, the lines it must
  NOT ignore (an http(s) CORS refusal, a file:/// fetch from a real origin, an ordinary page error, empty), a sweep that
  no check carries the old copy (2606 allowed until #9164 merges), and that each of the 14 requires and applies it.

## Rejected
- Serving all 14 from a board, as #9158 did for 2606: most of these replace window.fetch with their own answers (up
  to 15 stubs in one file), so a board would change what they test. That was the right tool for one check with no
  stubs, not for these.
- Widening each copy in place: 14 copies again, the next wording change is 14 edits.
- Matching "blocked by CORS policy" without the file:/// anchor: a check's own cross-origin bug would then be ignored.

## Weakest premise
The CORS arm is still Chromium's wording. If Chrome rewords it, the headed run goes red again, loudly, in one place to
fix; it cannot go silently green, because an unknown wording is a FAIL.

## Measured
- New test 6/6. Controls, each turning it red: the CORS arm removed (1 fail), the arm un-anchored from file:/// (1
  fail), the old copy put back in render-pjadd-back-2850 (2 fail).
- node --check on every file in docs/browser-checks after the edit (one insert first landed between a try and its
  catch in render-firstrun-reentry-3359; moved above it).

## Reviews
