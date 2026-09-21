'use strict';

/**
 * The Settings time-zone display (kosmos#1668 capture half, #3338 removal).
 *
 *   node --test web.timezone-1668.test.js
 *
 * #3338 removal (Josh, 0.6.84): the time zone is NO LONGER asked -- asking for a
 * city/ZIP read as invasive data collection. paintYouTz now shows the zone
 * READ-ONLY (auto-detected from the system clock, or the saved value), and
 * captures the machine zone SILENTLY when nothing was ever saved, so an agent
 * still knows the operator's local time. This suite pins: read-only display, the
 * friendly label, and the silent capture (POST only when unset). The consumer
 * half is in engine/timezone-1668.test.js; the route in server.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift, liftConst } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A stub carrying only #you-tz-display (the read-only value), and a fetch that
 *  records POSTs so a test can assert the silent capture. */
function makePaint(machineTz, savedTz) {
  const display = { textContent: '' };
  const els = { 'you-tz-display': display };
  const document = {
    getElementById(id) { return id in els ? els[id] : null; },
  };
  const Intl = {
    DateTimeFormat: function () { return { resolvedOptions: () => ({ timeZone: machineTz }) }; },
  };
  const posts = [];
  const fetchStub = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    return { json: async () => ({ timezone: savedTz }) };   // GET /api/settings
  };
  const src = liftConst(SCRIPT, 'YOU_TZ_FRIENDLY') + '\n'
    + lift(SCRIPT, 'youTzMachine') + '\n'
    + lift(SCRIPT, 'youTzLabel') + '\n'
    + lift(SCRIPT, 'paintYouTz') + '\nreturn paintYouTz;';
  const paint = new Function('document', 'fetch', 'Intl', src)(document, fetchStub, Intl);
  return { paint, display, posts };
}

test('#3338: with NO saved zone, the display shows the machine zone (friendly label) and it is captured SILENTLY', async () => {
  const { paint, display, posts } = makePaint('America/Chicago', null);
  await paint();
  assert.equal(display.textContent, 'Central Time (CT)', 'the machine zone is shown with its friendly label, read-only: ' + display.textContent);
  assert.equal(posts.length, 1, 'the machine zone is captured with exactly one silent POST when nothing was saved');
  assert.equal(posts[0].timezone, 'America/Chicago', 'the silent capture saves the machine zone so agents still get local time');
});

test('#3338: a SAVED zone is shown read-only and is NOT re-captured (no POST)', async () => {
  const { paint, display, posts } = makePaint('America/Chicago', 'America/New_York');
  await paint();
  assert.equal(display.textContent, 'Eastern Time (ET)', 'the saved zone wins over the machine zone: ' + display.textContent);
  assert.equal(posts.length, 0, 'a saved zone is never re-captured -- no POST');
});

test('#3338: a machine zone outside the friendly set still shows (raw IANA) and is captured', async () => {
  const { paint, display, posts } = makePaint('Africa/Nairobi', null);   // not in YOU_TZ_FRIENDLY
  await paint();
  assert.equal(display.textContent, 'Africa/Nairobi', 'an unlisted zone falls back to its IANA id, never blank');
  assert.equal(posts[0].timezone, 'Africa/Nairobi', 'and it is still captured');
});

test('#3338 removal: the Settings markup is READ-ONLY -- a display, no picker/search/save', () => {
  assert.match(PAGE, /id="you-tz-display"/, 'the read-only display is present');
  assert.doesNotMatch(PAGE, /id="you-tz-search"/, 'the city/ZIP search input is GONE (the invasive ask Josh removed)');
  assert.doesNotMatch(PAGE, /id="you-tz-save"/, 'the Save button is GONE -- nothing to save, it is auto-detected');
  assert.doesNotMatch(PAGE, /<select id="you-tz"/, 'the picker <select> is GONE');
});

test('#3338 removal: the onboarding About-you step no longer ASKS for a time zone', () => {
  assert.doesNotMatch(PAGE, /id="fr-you-tz"/, 'the onboarding tz picker is gone');
  assert.doesNotMatch(PAGE, /id="fr-you-tz-search"/, 'the onboarding city/ZIP search is gone');
  // but the machine zone is still captured silently on Continue:
  assert.match(SCRIPT, /timezone: youTzMachine\(\)/, 'onboarding still captures the machine zone silently on Continue');
});
