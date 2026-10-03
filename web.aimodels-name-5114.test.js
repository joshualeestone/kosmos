'use strict';
/**
 * kosmos#5114: no sentence a person can see sends them to an "Accounts" tab. The Settings section is labelled
 * "AI Models" (its nav button and aria-label), so "the Accounts tab", "the Accounts page" or "Settings > Accounts"
 * names a place nobody can find. Found on a newcomer's first agent with no Claude account.
 *
 * Scope, stated so the guard is not read as wider than it is: quoted strings in web/index.html, server.js,
 * engine/*.js (not tests), the Windows CLI and the Mac CLI (install/kosmos). Comments are removed first (block,
 * HTML, line and shell comments); identifiers are never read.
 *
 *   node --test web.aimodels-name-5114.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['web/index.html', 'server.js', 'tools/windows/kosmos-cli.js', 'install/kosmos',
  ...fs.readdirSync(path.join(__dirname, 'engine'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => 'engine/' + f)];
// Every likely way to name the old place: "Accounts tab/screen/page/section/panel", or a Settings path ending in it.
const OLD = /\bAccounts (tab|screen|page|section|panel)\b|\bSettings\s*(>|->|→|,|:)\s*Accounts\b/i;
// A quoted run on one line: '...', "..." or `...`.
const QUOTED = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;

// Comments become blank lines, so a hit still reports its real line number.
const blank = (m) => m.replace(/[^\n]/g, '');
function stripComments(text, shell) {
  if (shell) return text.replace(/^[ \t]*#.*$/gm, '');
  return text.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, '');
}

function hits(text, shell) {
  const out = [];
  stripComments(text, shell).split('\n').forEach((line, i) => {
    for (const m of line.match(QUOTED) || []) if (OLD.test(m)) out.push((i + 1) + ': ' + m.slice(0, 120));
  });
  return out;
}

test('#5114: the Settings section is labelled AI Models', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(html, /data-go="accounts"[^>]*>AI Models<\/button>/, 'the nav no longer calls this section AI Models; re-check the sentences below');
});

test('#5114: no sentence a person sees names an Accounts tab, page, screen or Settings > Accounts', () => {
  const found = [];
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const h of hits(text, f === 'install/kosmos')) found.push(f + ':' + h);
  }
  assert.deepEqual(found, [], 'these send a person to a place the screen calls AI Models');
});

test('#5114: the scan finds every spelling of the old name, and skips comments (control)', () => {
  for (const s of ["'Connect a Claude account from the Accounts tab in Settings'", '"open the accounts page"',
    '`see the Accounts section`', "'Settings > Accounts'", "'Settings -> Accounts'", "'in Settings, Accounts'",
    "'the Accounts screen'", "'the Accounts panel'"]) {
    assert.equal(hits('  x = ' + s + ';').length, 1, 'missed: ' + s);
  }
  assert.equal(hits("  // 'the Accounts tab' used to be here").length, 0, 'a // comment line');
  assert.equal(hits("/* the old\n   'Settings > Accounts' name */").length, 0, 'a block comment line with no leading star');
  assert.equal(hits("<!-- 'the Accounts tab' -->").length, 0, 'an HTML comment');
  assert.equal(hits("  # echo 'Settings > Accounts'", true).length, 0, 'a shell comment');
  assert.equal(hits("  echo 'open Settings > Accounts'", true).length, 1, 'a shell echo is read');
  assert.equal(hits("  x = 'Settings, AI Models';").length, 0, 'the right name is not a hit');
});
