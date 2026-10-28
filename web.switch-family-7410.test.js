'use strict';
/**
 * #7410: the provider-switch dialog says what does not come across, only when the switch crosses the Claude line, and
 * offers "Write handoff, then switch" there. The page's real functions, lifted (test-support/page.js).
 *
 *   node --test web.switch-family-7410.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page.js');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const fns = new Function(`${page.liftAll(SCRIPT, ['switchCrossesFamily', 'switchFamilyNote'])}\nreturn { switchCrossesFamily, switchFamilyNote };`)();

test('#7410: the family rule: Claude (and DeepSeek, on Claude Code) on one side, every other runner on the other', () => {
  // Review 1: Claude <-> DeepSeek too (one runner, two config folders: neither the conversation nor the notes cross).
  for (const [from, to] of [['anthropic', 'openai'], ['openai', 'anthropic'], ['anthropic', 'google'], ['xai', 'anthropic'], ['deepseek', 'openai'], ['anthropic', 'antigravity'], ['anthropic', 'deepseek'], ['deepseek', 'anthropic']]) {
    assert.equal(fns.switchCrossesFamily(from, to), true, from + ' -> ' + to);
  }
  // #7445: OpenAI -> Gemini moved to the warned side (web.switchwords-7445.test.js); OpenAI <-> Qwen stays here.
  for (const [from, to] of [['openai', 'alibaba'], ['anthropic', 'anthropic'], ['', 'openai']]) {
    assert.equal(fns.switchCrossesFamily(from, to), false, from + ' -> ' + to);
  }
});

test('#7410: across the line the dialog says the conversation does not come across, and never that everything stays', () => {
  const off = fns.switchFamilyNote('anthropic', 'openai', 'Mara', 'Claude', 'OpenAI');
  assert.match(off, /Its conversation does not come across: OpenAI cannot read Claude’s history\./);
  assert.match(off, /Its saved notes are copied into its folder; anything it only remembers from talking is lost\./);
  assert.doesNotMatch(off, /everything it has done|past stays readable/);
  const back = fns.switchFamilyNote('openai', 'anthropic', 'Mara', 'OpenAI', 'Claude');
  assert.match(back, /Claude cannot read OpenAI’s history\. Notes in its folder stay there for it to read/);
  assert.doesNotMatch(back, /are copied/, 'nothing is copied on the way back to Claude');
  for (const s of [off, back]) assert.doesNotMatch(s, /—/, 'an em dash');
});

test('#7410: within a family there is no new warning (#7445: one runner, OpenAI <-> Qwen)', () => {
  assert.equal(fns.switchFamilyNote('openai', 'alibaba', 'Mara', 'OpenAI', 'Qwen'), '');
});

test('#7410 review 1: Claude <-> DeepSeek warns too, and says the notes stay behind (nothing is copied there)', () => {
  const s = fns.switchFamilyNote('anthropic', 'deepseek', 'Mara', 'Claude', 'DeepSeek');
  assert.match(s, /Its conversation does not come across: DeepSeek cannot read Claude’s history\. Its saved notes stay behind with Claude and do not come across/);
  assert.doesNotMatch(s, /are copied/);
  assert.match(fns.switchFamilyNote('deepseek', 'anthropic', 'Mara', 'DeepSeek', 'Claude'), /stay behind with DeepSeek/);
});

test('#7410: the switch dialog uses the note, and offers the handoff only with it', () => {
  // The click handler is anonymous, so its wiring is read from the source it ships as.
  const at = SCRIPT.indexOf("document.getElementById('d-provider-go').addEventListener('click'");
  assert.ok(at > 0, 'the switch button handler vanished');
  const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});', at));
  assert.match(handler, /const familyNote = switchFamilyNote\(fromProv, sel\.value, agentShown\(\), fromWord, toWord\);/);
  assert.match(handler, /small: \(familyNote \|\| \(/, 'the old keeps-everything sentence is not replaced by the note');
  assert.match(handler, /go: familyNote \? 'Switch now' : 'Switch and restart'/);
  assert.match(handler, /alt: familyNote \? \{\s*label: 'Write handoff, then switch'/);
  assert.match(HTML, /<button class="btn" id="chg-alt" type="button" hidden><\/button>/);
});

/* changeDialog over stub elements (the #1313 harness's shape), with the second button. */
function dialog(alt, run) {
  const el = () => ({ textContent: '', hidden: false, disabled: false, onclick: null, focus() {} });
  const nodes = { 'chg-modal': el(), 'chg-title': el(), 'chg-small': el(), 'chg-keep': el(), 'chg-go': el(), 'chg-msg': el(), 'chg-alt': el() };
  const document = { getElementById: (id) => nodes[id] || null, addEventListener() {}, removeEventListener() {} };
  const changeDialog = new Function('document', `${page.lift(SCRIPT, 'changeDialog')}\nreturn changeDialog;`)(document);
  changeDialog({ title: 't', small: 's', go: 'Switch now', run, alt });
  return nodes;
}

test('#7410: the second button: hidden unless given; its step failing switches nothing and offers both again', async () => {
  const plain = dialog(undefined, async () => {});
  assert.equal(plain['chg-alt'].hidden, true, 'a dialog with no second way shows one');

  const runs = [];
  const n = dialog({ label: 'Write handoff, then switch', before: async (setLine) => { setLine('writing'); return { ok: false, line: 'Nothing was switched.' }; } },
    async (say, how) => { runs.push(how); say('done', true); });
  assert.equal(n['chg-alt'].hidden, false);
  assert.equal(n['chg-alt'].textContent, 'Write handoff, then switch');
  await n['chg-alt'].onclick();
  assert.deepEqual(runs, [], 'a handoff that was not written still switched');
  assert.equal(n['chg-msg'].textContent, 'Nothing was switched.');
  assert.equal(n['chg-go'].hidden, false); assert.equal(n['chg-alt'].hidden, false); assert.equal(n['chg-keep'].hidden, false);

  const ok = dialog({ label: 'Write handoff, then switch', before: async () => ({ ok: true }) },
    async (say, how) => { runs.push(how); say('done', true); });
  await ok['chg-alt'].onclick();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(runs, [{ viaAlt: true }], 'a written handoff did not switch, or switched without saying how');
});
