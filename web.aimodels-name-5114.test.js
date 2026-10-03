'use strict';
/**
 * kosmos#5114: no sentence a person can see sends them to an "Accounts" tab. The Settings section is labelled
 * "AI Models" (its nav button and aria-label), so "the Accounts tab", "the Accounts page" or "Settings > Accounts"
 * names a place nobody can find. Found on a newcomer's first agent with no Claude account.
 *
 * Scope, stated so the guard is not read as wider than it is:
 * - WHAT: the spellings in OLD below (Accounts tab/screen/page/section/panel in any case, or a Settings path ending in
 *   Accounts). A bare "Accounts" ("open Accounts") is not matched: the word is used legitimately elsewhere.
 * - WHERE: (1) quoted strings, one line at a time, escaped quotes included, in web/index.html, server.js,
 *   engine/*.js (not tests), the Windows CLI and the Mac CLI (install/kosmos); (2) the text between tags in
 *   web/index.html's markup (scripts, styles and HTML comments removed). Not seen: a name split across two quoted
 *   pieces ('the Accounts' + ' tab'), and unquoted shell output in install/kosmos.
 * - Only WHOLE comment lines are skipped (starting //, *, /*, <!-- or, in shell, #). A quoted old name inside a
 *   multi-line comment on a line without a leading marker is still read: that fails loudly (a false red), which is
 *   the safe direction, where stripping block comments by pattern silently hid real strings containing "/*".
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
// A quoted run on one line: '...', "..." or `...`, with backslash escapes inside.
const QUOTED = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g;
const COMMENT_LINE = /^[ \t]*(\/\/|\*|\/\*|<!--)/;
const SHELL_COMMENT_LINE = /^[ \t]*#/;

function hits(text, shell) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if ((shell ? SHELL_COMMENT_LINE : COMMENT_LINE).test(line)) return;   // a comment line says nothing to a person
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

test('#5114: the Settings section is labelled AI Models', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(html, /data-go="accounts"[^>]*>AI Models<\/button>/, 'the nav no longer calls this section AI Models; re-check the sentences below');
});

test('#5114: no sentence a person sees names an Accounts tab, page, screen or Settings > Accounts', () => {
  const found = [];
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const h of hits(text, f === 'install/kosmos')) found.push(f + ':' + h);
    if (f === 'web/index.html') for (const h of markupHits(text)) found.push(f + ' (markup):' + h);
  }
  assert.deepEqual(found, [], 'these send a person to a place the screen calls AI Models');
});

test('#5127 (Baron): the Claude-Code-missing create refusal names where to connect, as its siblings do', () => {
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'create.js'), 'utf8');
  assert.ok(/Connect a Claude account in Settings, AI Models\. Kosmos will then set it up\./.test(src),
    'the refusal a newcomer meets when Claude Code is not installed yet names no place to connect');
  assert.ok(!/Connect a Claude account and Kosmos will set it up/.test(src), 'the placeless wording is back');
  const runners = fs.readFileSync(path.join(__dirname, 'engine', 'runners.js'), 'utf8');
  assert.ok(!/Connecting a Claude account will download|Connect a Claude account and Kosmos will download/.test(runners),
    'the install refusal names no place again');
});

test('#5114: the scan finds every spelling of the old name, and skips comments (control)', () => {
  for (const s of ["'Connect a Claude account from the Accounts tab in Settings'", '"open the accounts page"',
    '`see the Accounts section`', "'Settings > Accounts'", "'Settings -> Accounts'", "'in Settings, Accounts'",
    "'the Accounts screen'", "'the Accounts panel'"]) {
    assert.equal(hits('  x = ' + s + ';').length, 1, 'missed: ' + s);
  }
  assert.equal(hits("  // 'the Accounts tab' used to be here").length, 0, 'a // comment line');
  assert.equal(hits("/* the old\n   'Settings > Accounts' name */").length, 1,
    'a block comment line with no leading marker is read: a loud false red, never a silent miss');
  assert.equal(hits("<!-- 'the Accounts tab' -->").length, 0, 'an HTML comment');
  assert.equal(hits("  # echo 'Settings > Accounts'", true).length, 0, 'a shell comment');
  assert.equal(hits("  echo 'open Settings > Accounts'", true).length, 1, 'a shell echo is read');
  assert.equal(hits("  x = 'Settings, AI Models';").length, 0, 'the right name is not a hit');
  assert.equal(hits("  x = 'this agent\\'s sign-in: open the Accounts tab';").length, 1, 'an escaped quote inside the string');
  assert.equal(hits("  y = 'Read(~/.claude-*/**)'; x = 'the Accounts tab';").length, 1, 'a string containing /* does not hide the next one');
  assert.equal(markupHits('<p>Open the Accounts tab.</p>').length, 1, 'text in the markup');
  assert.equal(markupHits('<button>Settings, Accounts</button>').length, 1, 'a button label');
  assert.equal(markupHits('<script>x = 1 > 0 && "the Accounts tab" < 2</script>').length, 0, 'a script is not markup text');
  assert.equal(markupHits('<!-- the Accounts tab -->').length, 0, 'an HTML comment is not markup text');
});
