'use strict';
/**
 * kosmos#3641 (Josh, 2026-09-24 16:06, #admin: "lets just kill the Beta Build line.. you can still get
 * the current version in settings"): the corner "beta build v<version>" marker from #2066 / #2658 is
 * gone from every view, Mac and Windows, and the version still reads in Settings > Updates.
 *
 * This file used to pin the marker's text per channel. A removal with no guard gets undone, so it now
 * pins the absence of every piece the marker had (the element, its painter, its CSS, its visible
 * words) and, as the control, that the Settings version line it points people to is still wired.
 *
 *   node --test web.build-marker-2066.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('#3641: no corner marker element, painter or style is left in the page', () => {
  assert.equal(/id="buildmark"/.test(PAGE), false, 'the #buildmark element came back');
  assert.equal(/#buildmark\b/.test(PAGE), false, 'a #buildmark style or selector came back');
  assert.equal(/\bpaintBuildMark\b/.test(PAGE), false, 'paintBuildMark came back');
});

test('#3641: the page never writes the "beta build" words anywhere a person could see them', () => {
  /* Any spelling a string literal could carry, since the old marker built it in JS. */
  assert.equal(/['"`]beta build/i.test(PAGE), false, 'a "beta build" string came back');
  assert.equal(/>\s*beta build/i.test(PAGE), false, 'a "beta build" text node came back');
});

test('control: the version still reads in Settings > Updates, painted from the first frame', () => {
  assert.match(PAGE, /<b id="build"><\/b>/, 'the Settings version line (#build) is gone');
  assert.match(PAGE, /function paintBuildLine\(version\) \{\n  const el = document\.getElementById\('build'\);/,
    'paintBuildLine no longer paints #build');
  assert.match(PAGE, /paintBuildLine\(null\);/, 'the version line is no longer painted before the first poll');
  assert.match(PAGE, /paintBuildLine\(data\.version\);/, 'the version line no longer follows the status poll');
});
