'use strict';
/**
 * kosmos#5127, #5128 (the #5114 class): no sentence a person can see uses the spellings in OLD below, which name
 * places that do not exist. Other wordings ("its Terminal", "Terminal view") are not caught; a bare "Terminal" is
 * legitimate, since the Mac box is headed "This agent's Terminal".
 * - There is no "Terminal tab": an agent's screen is a box under the AI Settings pill on its page ("This agent's
 *   Terminal" on a Mac, "Starting this agent" on Windows, #5239), so sentences point at AI Settings, which both platforms show.
 *   The Codex hook refusals are shown ON the agent's page and only ever reach a Mac (Windows is turned away first), so they name the Mac heading and
 *   where it is ("look at This agent's Terminal under AI Settings on this page"); the
 *   not-running message can show elsewhere, with no session, so it names only the place ("on its page").
 * - "Add a provider" lives under Settings, AI Models; a hint that says "Settings: Add a provider" skips the section.
 *
 * Scope, stated so the guard is not read as wider than it is:
 * - WHAT: the spellings in OLD (a Terminal tab, pill, section or page; "Settings" then ":", ">", "->" or "," then
 *   "Add a provider"), any case.
 * - WHERE: (1) quoted strings, one line at a time (a line starting with * or // is a comment line and skipped,
 *   so a string on such a line is not read; a stray apostrophe earlier on a line can mis-pair the quotes), escaped quotes included, in web/index.html, server.js,
 *   engine/*.js (not tests), the Windows CLI and the Mac CLI; (2) the text between tags in web/index.html's markup
 *   (scripts, styles and HTML comments removed). Whole comment lines are skipped. A name split across two quoted
 *   pieces is not seen.
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
const OLD = /\bTerminal (tab|pill|section|page)\b|\bSettings\s*(:|>|->|,)\s*Add a provider\b/i;
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

// The text a person reads in the page's markup: between tags, with scripts, styles and HTML comments removed.
function markupHits(html) {
  const blank = (m) => m.replace(/[^\n]/g, '');
  const text = html.replace(/<script\b[\s\S]*?<\/script>/gi, blank).replace(/<style\b[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.match(/>[^<>]+</g) || []) if (OLD.test(m)) out.push((i + 1) + ': ' + m.slice(1, 121));
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
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const h of hits(text, f === 'install/kosmos')) found.push(f + ':' + h);
    if (f === 'web/index.html') for (const h of markupHits(text)) found.push(f + ' (markup):' + h);
  }
  assert.deepEqual(found, [], 'these name a place a person cannot find');
});

test('#5127: the scan finds the old names and skips comments (control)', () => {
  assert.equal(hits("  return no('nothing was pressed; open its Terminal tab to see it');").length, 1);
  assert.equal(hits("  x = 'Set up in Settings: Add a provider';").length, 1);
  assert.equal(hits("  x = 'see its Terminal pill';").length, 1, 'another spelling');
  assert.equal(hits("  x = 'Set up in Settings > Add a provider';").length, 1, 'another separator');
  assert.equal(hits("  x = 'it\\'s on the Terminal tab';").length, 1, 'an escaped quote');
  assert.equal(hits("  // open its 'Terminal tab' here").length, 0, 'a // comment line');
  assert.equal(hits("  <!-- 'the Terminal tab' -->").length, 0, 'an HTML comment line');
  assert.equal(hits("  # echo 'the Terminal tab'", true).length, 0, 'a shell comment line');
  assert.equal(hits("  echo 'open the Terminal tab'", true).length, 1, 'a shell echo is read');
  assert.equal(markupHits('<p>Open its Terminal tab.</p>').length, 1, 'text in the markup');
  assert.equal(markupHits('<script>x = 1 > 0 && "the Terminal tab" < 2</script>').length, 0, 'a script is not markup text');
  assert.equal(hits("  x = 'look at This agent\\u2019s Terminal under AI Settings on this page';").length, 0, 'the new words are not a hit');
});
