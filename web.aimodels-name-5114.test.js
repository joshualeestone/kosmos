'use strict';
/**
 * kosmos#5114: no sentence a person can see sends them to an "Accounts" tab. The Settings section is labelled
 * "AI Models" (its nav button and aria-label), so "the Accounts tab", "the Accounts screen" or "Settings > Accounts"
 * names a place nobody can find. Found on a newcomer's first agent with no Claude account. Reads string literals
 * (quoted text) in the files that build those sentences; comments and identifiers are not read.
 *
 *   node --test web.aimodels-name-5114.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['web/index.html', 'server.js', ...fs.readdirSync(path.join(__dirname, 'engine'))
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => 'engine/' + f)];
const OLD = /Accounts tab|Accounts screen|Settings > Accounts/;
// A quoted run on one line: '...', "..." or `...`.
const QUOTED = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;

function hits(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');   // a comment line says nothing to a person
    for (const m of code.match(QUOTED) || []) if (OLD.test(m)) out.push((i + 1) + ': ' + m.slice(0, 120));
  });
  return out;
}

test('#5114: the Settings section is labelled AI Models', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(html, /data-go="accounts"[^>]*>AI Models<\/button>/, 'the nav no longer calls this section AI Models; re-check the sentences below');
});

test('#5114: no sentence a person sees names an Accounts tab, screen or Settings > Accounts', () => {
  const found = [];
  for (const f of FILES) for (const h of hits(fs.readFileSync(path.join(__dirname, f), 'utf8'))) found.push(f + ':' + h);
  assert.deepEqual(found, [], 'these send a person to a place the screen calls AI Models');
});

test('#5114: the scan finds the old name when it is there (control)', () => {
  assert.equal(hits("  because: 'Connect a Claude account from the Accounts tab in Settings',").length, 1);
  assert.equal(hits('  // the Accounts tab used to be here').length, 0, 'a comment line is not a sentence a person sees');
});
