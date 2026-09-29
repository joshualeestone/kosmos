'use strict';

/**
 * #4525: two values the "Waiting for you" list in web/index.html has to repeat from the engine, pinned equal so
 * they cannot drift apart unseen (the page cannot require an engine module).
 *
 *   COMMUNITY_HELD_MAX   === engine/communitysite.js MOD_LIMIT_MAX   below it, "there may be more" never shows
 *   COMMUNITY_SITE       === engine/communitysend.js DEFAULT_ENDPOINT  the link would point at another site
 *
 *   node --test web.community-held-4525.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SITE_SRC = fs.readFileSync(path.join(__dirname, 'engine', 'communitysite.js'), 'utf8');

function pageConst(name) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(PAGE);
  assert.ok(m, `${name} is gone from the page`);
  return m[1].trim();
}

test('#4525: the page asks the moderation route for exactly its ceiling', () => {
  const page = Number(pageConst('COMMUNITY_HELD_MAX'));
  const m = /const MOD_LIMIT_MAX = (\d+);/.exec(SITE_SRC);
  assert.ok(m, 'MOD_LIMIT_MAX is gone from engine/communitysite.js');
  assert.ok(Number.isInteger(page) && page > 0, 'CONTROL: the page value was read as a number: ' + page);
  assert.equal(page, Number(m[1]), 'the page and the route disagree on the moderation ceiling');
});

test('#4525: the page links to the same community site the board sends to', () => {
  const page = JSON.parse(pageConst('COMMUNITY_SITE').replace(/^'|'$/g, '"'));
  const { DEFAULT_ENDPOINT } = require('./engine/communitysend');
  assert.ok(/^https:\/\//.test(page), 'CONTROL: the page value was read as a URL: ' + page);
  assert.equal(page, DEFAULT_ENDPOINT, 'the page links to a different site than the board sends to');
});
