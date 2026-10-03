'use strict';
/**
 * kosmos#5127, #5128 (the #5114 class): no sentence a person can see names a place that does not exist.
 * - There is no "Terminal tab": an agent's screen is a box under the AI Settings pill on its page ("This agent's
 *   Terminal" on a Mac, "Live output" on Windows), so sentences point at AI Settings, which both platforms show.
 * - "Add a provider" lives under Settings, AI Models; a hint that says "Settings: Add a provider" skips the section.
 *
 * Scope, stated so the guard is not read as wider than it is: quoted strings, one line at a time, escaped quotes
 * included, in web/index.html, server.js, engine/*.js (not tests), the Windows CLI and the Mac CLI. Whole comment
 * lines are skipped. A name split across two quoted pieces is not seen. web.aimodels-name-5114.test.js guards the
 * Accounts name the same way.
 *
 *   node --test web.place-names-5127.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['web/index.html', 'server.js', 'tools/windows/kosmos-cli.js', 'install/kosmos',
  ...fs.readdirSync(path.join(__dirname, 'engine'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => 'engine/' + f)];
const OLD = /\bTerminal tab\b|\bSettings\s*:\s*Add a provider\b/i;
const QUOTED = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g;
const COMMENT_LINE = /^[ \t]*(\/\/|\*|\/\*|<!--)/;
const SHELL_COMMENT_LINE = /^[ \t]*#/;

function hits(text, shell) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if ((shell ? SHELL_COMMENT_LINE : COMMENT_LINE).test(line)) return;
    for (const m of line.match(QUOTED) || []) if (OLD.test(m)) out.push((i + 1) + ': ' + m.slice(0, 120));
  });
  return out;
}

test('#5127: the agent page still has an AI Settings pill that holds the agent\'s screen', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = html.search(/data-go="model" aria-controls="[^"]*\bd-sec-term\b[^"]*"/);
  assert.ok(at > 0, 'no agent-page pill controls the agent\'s screen (d-sec-term); re-check the sentences that send people there');
  const button = html.slice(at, html.indexOf('</button>', at));
  assert.match(button, />\s*AI Settings\s*</, 'the pill that holds the agent\'s screen is no longer called AI Settings');
});

test('#5127, #5128: no sentence a person sees names a Terminal tab or "Settings: Add a provider"', () => {
  const found = [];
  for (const f of FILES) {
    for (const h of hits(fs.readFileSync(path.join(__dirname, f), 'utf8'), f === 'install/kosmos')) found.push(f + ':' + h);
  }
  assert.deepEqual(found, [], 'these name a place a person cannot find');
});

test('#5127: the scan finds the old names and skips comments (control)', () => {
  assert.equal(hits("  return no('nothing was pressed; open its Terminal tab to see it');").length, 1);
  assert.equal(hits("  x = 'Set up in Settings: Add a provider';").length, 1);
  assert.equal(hits("  // open its 'Terminal tab' here").length, 0);
  assert.equal(hits("  x = 'look under AI Settings on its page';").length, 0, 'the new words are not a hit');
});
