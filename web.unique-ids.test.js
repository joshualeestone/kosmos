'use strict';

/**
 * Every id in the markup is unique.
 *
 * 🛑 THE DEFECT THAT PROMPTED THIS ANNOUNCED ITSELF NOWHERE. Two features
 * shared `id="d-said"`: the quoted said-line and the vendor's usage-limit
 * sentence. `getElementById` returns the FIRST, so both writes landed on the
 * span, the sentence overwrote the line sixty lines later in `openDetail`, and
 * the blockquote written for it had NEVER RENDERED ONCE. No error, no warning,
 * and each half looked correct in isolation.
 *
 * ⚠️ COMMENTS AND SCRIPTS ARE STRIPPED FIRST, and that is not a detail. A scan
 * that skips <script> but not <!-- --> reported THREE duplicates here; two were
 * prose in docblocks. That mistake was made twice in one evening by two people,
 * which is why the stripping lives in the test rather than in whoever runs it.
 *
 * 🔑 AND THE CONTROL RUNS EVERY TIME. A uniqueness scan that has never seen a
 * duplicate has not been shown to detect one -- so this plants a known
 * duplicate into a copy of the page and fails if the scan stays quiet. A count
 * with no control is a claim, not a measurement.
 *
 *   node --test web.unique-ids.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function markupOnly(src) {
  return src
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}
function duplicateIds(src) {
  const seen = new Map();
  for (const m of markupOnly(src).matchAll(/\sid="([A-Za-z0-9_-]+)"/g)) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => id + ' x' + n);
}

/* ⭐ THE TWO CONTROLS BELOW ARE ANGEL'S, from a gate she built independently
   the same evening. Both cover a way this test could pass while being broken,
   and neither was in my version:

   - A duplicate planted in a COMMENT must NOT be reported. Mine stripped
     comments and never proved the stripping worked -- which is precisely the
     error that produced "three duplicate ids" in the first place.
   - A FLOOR on the id count, so a broken regex reads as BROKEN rather than
     CLEAN. Without it a pattern that matches nothing finds zero ids, zero
     duplicates, and passes. My own new instrument had the exact failure mode
     it exists to catch.

   Her note on building them: her first controls assumed a clean page and both
   failed for reasons unrelated to what they check. Running a control is how
   you find out your control is wrong. */
test('the scan is not silently matching nothing', () => {
  const n = [...markupOnly(PAGE).matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].length;
  assert.ok(n > 400,
    `only ${n} ids matched in the markup. This page has ~590; a number this low means the pattern or the stripping is broken, and a broken scan reports CLEAN`);
});

test('an id written inside a comment is not counted', () => {
  const planted = PAGE.replace('</head>', '<!-- <div id="pj-back"> a comment naming an existing id --></head>');
  assert.notEqual(planted, PAGE, 'the planting anchor moved; this control plants nothing');
  assert.deepEqual(duplicateIds(planted), [],
    'an id mentioned in a COMMENT was counted as markup. That is the mistake that reported three duplicates when there was one');
});

test('the scan can actually see a duplicate', () => {
  const planted = PAGE.replace('<blockquote class="detail-said" id="d-said"', '<blockquote id="pj-back"');
  assert.notEqual(planted, PAGE, 'the planting anchor moved; this control is no longer planting anything');
  assert.deepEqual(duplicateIds(planted), ['pj-back x2'],
    'a deliberately planted duplicate was not detected, so a clean run below proves nothing');
});

test('no id is used twice in the markup', () => {
  assert.deepEqual(duplicateIds(PAGE), [],
    'two elements share an id. getElementById returns the first, so the other can never be reached and one feature will silently overwrite the other');
});
