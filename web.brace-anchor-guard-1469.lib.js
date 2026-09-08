'use strict';
// ===========================================================================
// #1469 - a mechanical guard for the #1430 CSS brace-anchor loosening.
//
// #1430 unpinned 28 CSS assertions from their rule's CLOSING BRACE. An
// assertion anchored on `; \}` fails the moment a legitimate declaration is
// appended to that rule - which took main red at step 3 under #1310. The fix
// was enforced only by prose; a comment cannot stop anyone re-adding a brace.
// This test is the mechanical enforcement.
//
// WHAT A GREEN HERE MEANS (the narrow claim, per Angel on #1469):
//   Each of the 28 specific assertions #1430 loosened still has its OPEN TAIL.
//   None has been re-anchored to its closing brace, in ANY spelling:
//     escaped  `padding-top: 0; \}`      unescaped `padding-top: 0; }`
//     `; \s*\}`                            a wrap onto a second source line
//   If any is re-anchored, its exact loosened source string disappears from the
//   file and this guard goes RED, naming the file and the loosened form.
//
// WHAT THIS DOES NOT COVER (loud about the rest - a green is NOT "the class is
// clean", only "these 28 are untouched"):
//   - It does NOT detect a NEWLY-ADDED brittle assertion anywhere else.
//   - It does NOT cover #1430's deferred surfaces (web.room-761,
//     web.layout-picker, web.project-page, +10 by count) - never loosened.
//   - It does NOT cover the two robust replacements #1430 also made: the
//     effective() cascade check and the RAIL_RULE occurrence-count assertion.
//     Those are not brace-anchored, and the count one changed from 2 to 1 when
//     #1459 landed (the duplicate rail rule was removed), so pinning it would
//     false-red.
//   - It does NOT stop a DELIBERATELY self-defeating edit: re-anchor one pinned
//     assertion (its count -> 0) AND paste a byte-identical copy of that same
//     loosened source elsewhere in the file (count back to expected). Per-assertion
//     counting sees the total unchanged. This needs an editor actively working to
//     hide a re-anchor, which is not the threat here (accidental re-anchoring by a
//     future editor); it is named so the coverage boundary is explicit.
//
// WHY EXACT-SOURCE PINNING, NOT A CLASSIFIER (both classifier versions #1430
// tried had SILENT false negatives on spellings nobody thought to test):
//   The guard reads each file as one string and counts EXACT occurrences of the
//   loosened source of each pinned assertion. It never parses or classifies a
//   regex. Consequences, each a trap that sank an earlier version:
//     - Escaping (\} vs }) is a non-issue: a re-anchor changes the exact bytes.
//     - Multi-line braces are a non-issue: whole-file string, not a per-line scan.
//     - `/*` inside a string is a non-issue: no comment stripping happens.
//     - Compensating drift is a non-issue: per-assertion counts, not a class count.
//   Trade-off, in the SAFE direction: reformatting a pinned assertion (rewrapping,
//   renaming PAGE) also trips this. That is a false POSITIVE, drawing a review -
//   never a false negative. The card's priority is no false negatives.
//
// The pin table is generated FROM the loosened files (tools: see #1469 comment),
// then proven by PLANTING each trap and watching it go red. Not by reading.
//
// This is the pure logic module (no node:test): the guard test
// (web.brace-anchor-guard-1469.test.js) and its self-test
// (web.brace-anchor-guard-1469.selftest.test.js) both require checkBraceAnchors
// from here, so the check is defined once and never runs twice.
// ===========================================================================

const fs = require('fs');
const path = require('path');

// file -> [ { pin: <exact loosened source>, count: <exact expected occurrences> } ]
// (JSON.stringify output is valid JS; string escapes here are exactly the file bytes.)
const EXPECTED = {
  "web.consolidated-867.test.js": [
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated #pj-list-view \\{ grid-column: 1; padding-top: 0;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pjmid \\.thread \\{ min-height: 0; max-height: none; flex: 1 1 auto; border: 0; border-radius: 0; background: none;/,",
      "count": 1
    }
  ],
  "web.consolidated-980.test.js": [
    {
      "pin": "assert.match(PAGE, new RegExp(cons + ' \\\\.lrow:has\\\\(\\\\.lstate \\\\.ansgo\\\\) > \\\\.lav \\\\{ grid-row: 1 \\\\/ span 3;'),",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, new RegExp(cons + ' \\\\.pj-member \\\\.lav\\\\.pj-face \\\\{ width: 28px; height: 28px; flex: 0 0 28px; aspect-ratio: 1;'),",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, new RegExp(cons + ' \\\\.pjmidhead \\\\.pjhead \\\\.pj-desc \\\\{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;'),",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /\\.cinput \\{[^}]*scrollbar-width: none; -ms-overflow-style: none;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, new RegExp(cons + ' \\\\.pj3 > \\\\.pjsplit > \\\\.pjcard, ' + cons + ' \\\\.pj3 > aside\\\\.pjcol:not\\\\(\\\\.pjsplit\\\\) \\\\{ min-height: 0; align-self: stretch;'),",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, new RegExp(cons + ' \\\\.pj3 > aside\\\\.pjcol:not\\\\(\\\\.pjsplit\\\\), ' + cons + ' \\\\.pj3 > \\\\.pjsplit > \\\\.pjcard-files \\\\{ max-height: 38vh;'),",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, new RegExp(cons + ' \\\\.pj3 > \\\\.pjsplit > \\\\.pjcard-members \\\\{ max-height: calc\\\\(100% - 12px\\\\);'),",
      "count": 1
    }
  ],
  "web.consolidated-avatar-crop.test.js": [
    {
      "pin": "assert.match(PAGE, /\\.lav img \\{ display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 50%;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /\\.lavtint \\{ width: 100%; height: 100%; display: grid; place-items: center; border-radius: 50%;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.lrow > \\.lav \\{ position: relative; overflow: visible; background: none;/,",
      "count": 1
    }
  ],
  "web.consolidated-match-mock.test.js": [
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pj3 > aside\\.pjcol:not\\(\\.pjsplit\\) \\{ grid-column: 2; grid-row: 1;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pj3 > \\.pjsplit > \\.pjcard-files \\{ grid-column: 2; grid-row: 2;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pj3 > \\.pjsplit > \\.pjcard-members \\{ grid-column: 2; grid-row: 3;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pj3 \\{ background: var\\(--k-side, #f3f1ec\\); border-radius: 0; padding: 0;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pj3 > \\.pjmid \\{ background: var\\(--k-bg\\); border: 0; border-radius: 0; border-right: 1px solid var\\(--k-rule\\);/,",
      "count": 1
    }
  ],
  "web.consolidated-project-name-overflow.test.js": [
    {
      "pin": "assert.match(PAGE, /html\\[data-layout=\"consolidated\"\\] body\\.consolidated \\.pjcard-h b \\{ font-size: \\.875rem; overflow-wrap: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/,",
      "count": 1
    }
  ],
  "web.pjsplit-order-1017.test.js": [
    {
      "pin": "assert.match(PAGE, /\\.pjsplit > \\.pjcard-files \\{ grid-column: 2; grid-row: 2;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /\\.pjsplit > \\.pjcard-members \\{ grid-column: 2; grid-row: 3;/,",
      "count": 1
    }
  ],
  "web.project-rows.test.js": [
    {
      "pin": "assert.match(PAGE, /\\.pj-list:not\\(\\.asgrid\\) \\.pj-row \\.pjpill \\{ grid-column: 4; grid-row: 1; justify-self: end;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /@media \\(max-width: 52rem\\) \\{\\n  \\.pj-list:not\\(\\.asgrid\\) \\.pj-row \\{ grid-template-columns: minmax\\(0, 1fr\\) auto;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /\\.pj-list:not\\(\\.asgrid\\) \\.pj-row \\.pjname b \\{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /^\\.pc-t \\{ display: block;[^}]*overflow-wrap: anywhere;/m,",
      "count": 2
    },
    {
      "pin": "assert.match(PAGE, /\\.pj-list:not\\(\\.asgrid\\) \\.pj-row \\.pjfaces \\{[^}]*min-width: 0; overflow: hidden;/,",
      "count": 1
    }
  ],
  "web.tab-column-order.test.js": [
    {
      "pin": "assert.match(PAGE, /body\\.consolidated \\.pj3 > \\.pjsplit > \\.pjcard-members \\{ grid-column: 2; grid-row: 3;/,",
      "count": 1
    },
    {
      "pin": "assert.match(PAGE, /body\\.consolidated \\.pj3 > aside\\.pjcol:not\\(\\.pjsplit\\) \\{ grid-column: 2; grid-row: 1;/,",
      "count": 1
    }
  ]
};

// A HARDCODED constant, deliberately NOT `Object.values(EXPECTED).reduce(...)`.
// Its whole job is to catch a table that was emptied or gutted: with an empty
// table the file loop never runs, sweptTotal is 0, and only a constant that
// still says 28 turns that into a red. A derived sum would be 0 too and pass -
// so deriving it (however tidy) would delete the "sweep read nothing" guard the
// card requires. If you legitimately change the pin set, update this by hand.
const EXPECTED_TOTAL = 28; // occurrences across all files (dups counted)

// Pure checker so a planting harness can run it against perturbed copies.
// `expected`/`total` default to the module constants; the self-test overrides
// them (e.g. an empty table) to prove the global-total floor in isolation.
// Returns [] when clean, or a list of {file, kind, ...} failures.
function checkBraceAnchors(dir, expected = EXPECTED, total = EXPECTED_TOTAL) {
  const failures = [];
  let sweptTotal = 0;
  for (const [file, arr] of Object.entries(expected)) {
    let src;
    try {
      src = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (e) {
      failures.push({ file, kind: 'file-missing', detail: e.code });
      continue;
    }
    let fileTotal = 0;
    for (const { pin, count } of arr) {
      const got = src.split(pin).length - 1;
      if (got !== count) {
        failures.push({ file, kind: 're-anchored-or-changed', want: count, got, pin });
      }
      fileTotal += got;
    }
    // PER-FILE floor: a file that contributes zero pins has gone blind (renamed,
    // rewritten, or every pin changed). A guard that reads nothing must FAIL.
    if (fileTotal === 0) {
      failures.push({ file, kind: 'file-blind' });
    }
    sweptTotal += fileTotal;
  }
  // GLOBAL floor on top of the per-file floor: the whole sweep must account for
  // every loosened occurrence. This is the one floor that fires where the
  // per-assertion checks cannot - an emptied table runs no per-assertion check
  // at all, so only this catches it.
  if (sweptTotal !== total) {
    failures.push({ kind: 'total-mismatch', want: total, got: sweptTotal });
  }
  return failures;
}

module.exports = { checkBraceAnchors, EXPECTED, EXPECTED_TOTAL };
