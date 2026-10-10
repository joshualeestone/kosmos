'use strict';
/* #5080: the Language box in Settings > Automation. Source checks on web/index.html (comments stripped): they catch a
   revert or a lost wire, not a wrong word, so the route test (server.agent-language-5080.test.js) and the design shots
   carry the behaviour. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('#5080: the select is in Settings, labelled, hidden until the first read lands', () => {
  assert.match(code, /<label class="dhint" for="agent-language">The language your agents write to you in<\/label>\s*<select id="agent-language" aria-describedby="agent-language-hint" hidden><\/select>/);
  assert.match(code, /id="agent-language-hint"[^>]*>Your agents write to you and in your project rooms in this language\. Kosmos\+ community posts stay in English\.<\/p>/);
  assert.match(code, /id="agent-language-msg" role="status"/);
});

test('#5080: it reads and writes /api/agent-language, and re-reads when Automation opens', () => {
  assert.match(code, /fetch\('\/api\/agent-language', \{ cache: 'no-store' \}\)/);
  assert.match(code, /fetch\('\/api\/agent-language', \{\s*method: 'PUT',[\s\S]{0,120}body: JSON\.stringify\(\{ choice: sel\.value \}\)/);
  assert.match(code, /document\.getElementById\('agent-language'\)\.addEventListener\('change', agentLanguageChange\);/);
  assert.match(code, /^refreshAgentLanguage\(\);/m);
  assert.match(code, /section === 'automation' && typeof refreshAgentLanguage === 'function' && !AGENT_LANG_SAVING\) refreshAgentLanguage\(false, true\);/);
});

test('#5080: an unreadable choice is never shown as a choice, and cannot be saved', () => {
  assert.match(code, /if \(unread\) opts\.push\(\{ value: '__unknown', text: 'Could not be read just now', disabled: true \}\);/);
  assert.match(code, /sel\.value = unread \? '__unknown' : \(r\.choice \|\| 'auto'\);/);
  assert.match(code, /async function agentLanguageChange\(\) \{\s*const sel = document\.getElementById\('agent-language'\);\s*if \(sel\.value === '__unknown'\) return;/);
});

test('#5080: Automatic names the computer\'s language only when the board is sure of it', () => {
  assert.match(code, /a && a\.sure && a\.name \? 'Automatic: ' \+ a\.name \+ ', from this computer' : 'Automatic: this computer\\u2019s language'/);
});

test('#5080: no em dash and no "this Mac" in the new words', () => {
  const box = html.slice(html.indexOf('<h3 class="dlab">Language</h3>'), html.indexOf('id="agent-language-msg"'));
  const js = html.slice(html.indexOf('let AGENT_LANG_EPOCH'), html.indexOf("addEventListener('change', agentLanguageChange)"));
  assert.ok(box.length > 100 && js.length > 1000, 'CONTROL: both slices were found');
  for (const s of [box, js]) {
    assert.doesNotMatch(s, /—|&mdash;|&#8212;|&#x2014;|\\u2014/i);
    assert.doesNotMatch(s, /this Mac/i);
  }
});
