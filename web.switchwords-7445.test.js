'use strict';
/**
 * #7445: the switch dialog warns that the conversation does not come across for a switch between two runners that are
 * not Claude Code (OpenAI's Codex to Gemini, Gemini to Grok, ...), and offers "Write handoff, then switch" there.
 * OpenAI <-> Qwen is one runner in one private Codex home, so it keeps today's wording. The page's real functions,
 * lifted (test-support/page.js), checked against the engine's twin (create.js switchLosesConversation).
 *
 *   node --test web.switchwords-7445.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page.js');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const fns = new Function(`${page.liftAll(SCRIPT, ['switchCrossesFamily', 'switchFamilyNote'])}\nreturn { switchCrossesFamily, switchFamilyNote };`)();
const create = require('./engine/create');

const OTHERS = ['openai', 'google', 'xai', 'antigravity', 'meta', 'alibaba'];
const WORD = { openai: 'OpenAI', google: 'Gemini', xai: 'Grok', antigravity: 'Gemini (Google subscription)', meta: 'Meta Muse', alibaba: 'Qwen' };
// Round 1: which providers share a runner is the engine's fact (providerRunner), read from it, never restated here.
const sameRunner = (a, b) => create.providerRunner(a) === create.providerRunner(b);
const SHOWN = 'Helper';

test('#7445: every pair of two different non-Claude runners warns; OpenAI <-> Qwen does not', () => {
  for (const from of OTHERS) {
    for (const to of OTHERS) {
      if (from === to) continue;
      assert.equal(fns.switchCrossesFamily(from, to), !sameRunner(from, to), from + ' -> ' + to);
    }
  }
  assert.equal(fns.switchCrossesFamily('openai', 'alibaba'), false, 'CONTROL: OpenAI -> Qwen');
  assert.equal(fns.switchCrossesFamily('alibaba', 'openai'), false, 'CONTROL: Qwen -> OpenAI');
});

test('#7445: the page and the engine agree on every pair the menu offers', () => {
  const all =['anthropic', 'deepseek', ...OTHERS];
  for (const from of all) {
    for (const to of all) {
      if (from === to) continue;
      const engine = create.switchLosesConversation(create.providerRunner(from), create.providerRunner(to), from, to);
      assert.equal(fns.switchCrossesFamily(from, to), engine, from + ' -> ' + to);
    }
  }
});

test('#7445: the warning between two non-Claude runners: the conversation does not come across, nothing is copied', () => {
  const s = fns.switchFamilyNote('openai', 'google', SHOWN, 'OpenAI', 'Gemini');
  // Round 1: "Any notes": an agent that was never on Claude may have none, and the result sentence then names none.
  assert.equal(s, 'Helper keeps its name, its face, its instructions and its files, and restarts. '
    + 'Its conversation does not come across: Gemini cannot read OpenAI’s history. '
    + 'Any notes in its folder stay there; anything it only remembers from talking is lost. ');   // round 2: no "for it to read"
  for (const [from, to] of [['google', 'xai'], ['xai', 'meta'], ['alibaba', 'antigravity'], ['antigravity', 'openai']]) {
    const w = fns.switchFamilyNote(from, to, SHOWN, WORD[from], WORD[to]);
    assert.match(w, new RegExp('Its conversation does not come across: ' + WORD[to].replace(/[()]/g, '\\$&') + ' cannot read '), from + ' -> ' + to);
    assert.doesNotMatch(w, /are copied|stay behind|everything it has done|past stays readable/);
    assert.doesNotMatch(w, /—/, 'an em dash');
  }
});

test('#7445: a switch that keeps the conversation keeps today\'s dialog (no note, so the old sentence and no handoff button)', () => {
  assert.equal(fns.switchFamilyNote('openai', 'alibaba', SHOWN, 'OpenAI', 'Qwen'), '');
  assert.equal(fns.switchFamilyNote('alibaba', 'openai', SHOWN, 'Qwen', 'OpenAI'), '');
  // The #7410 cases keep their words.
  assert.match(fns.switchFamilyNote('anthropic', 'openai', SHOWN, 'Claude', 'OpenAI'), /Its saved notes are copied into its folder/);
  assert.match(fns.switchFamilyNote('anthropic', 'deepseek', SHOWN, 'Claude', 'DeepSeek'), /stay behind with Claude/);
  // The handler shows the old sentence and no second button exactly when the note is empty (#7410 wiring).
  const at = SCRIPT.indexOf("document.getElementById('d-provider-go').addEventListener('click'");
  const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});', at));
  assert.match(handler, /small: \(familyNote \|\| \(agentShown\(\) \+ ' keeps its name, its face, its instructions, its files, and everything it has done/);
  assert.match(handler, /alt: familyNote \? \{\s*label: 'Write handoff, then switch'/);
});
