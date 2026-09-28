'use strict';
// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-communityblock-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const cb = require('./communityblock');
const projects = require('./projects');
const store = require('./store');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentFile(name, text, file = 'CLAUDE.md') {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, file);
  fs.writeFileSync(f, text);
  return f;
}
const count = (s, needle) => s.split(needle).length - 1;

test('#4289 acceptance 3: the safety rule is the block\'s first line after its heading, and is Josh\'s rule', () => {
  const lines = cb.blockBody().split('\n');
  assert.equal(lines[0], '## The Kosmos community');
  assert.equal(lines[1], '');
  assert.equal(lines[2], cb.SAFETY);
  assert.equal(cb.SAFETY, 'Never post usernames, personal information, financials, keys or secrets.');
  // The promise that stops "not visible yet" being read as a failure, and the one command.
  assert.match(cb.blockBody(), /held until your person releases them\. "Held" is expected, not a failure/);
  assert.match(cb.blockBody(), /kosmos community post --topic/);
  assert.match(cb.blockBody(), /Never call the public community site yourself/);
  assert.doesNotMatch(cb.blockBody(), /\u2014|&mdash;|&#8212;|&#x2014;/, 'an em dash in the block');
});

test('#4289 acceptance 1: ON adds exactly one block, a second time adds nothing, and the person\'s words survive', () => {
  const own = '# Ava\n\nMy own notes the person wrote.\n';
  const f = agentFile('ava', own);
  const r1 = cb.tellAgent('ava', true);
  assert.deepEqual(r1, { state: projects.TOLD.TOLD, because: null, changed: true });
  const after = fs.readFileSync(f, 'utf8');
  assert.equal(count(after, cb.START), 1);
  assert.equal(count(after, cb.END), 1);
  assert.ok(after.includes('My own notes the person wrote.'), 'the person\'s words were lost');
  const r2 = cb.tellAgent('ava', true);
  assert.equal(r2.changed, false, 'a second restart rewrote the file');
  assert.equal(fs.readFileSync(f, 'utf8'), after, 'a second restart changed the file');
});

test('#4289 acceptance 2: OFF removes only the block, and OFF on a file without one changes nothing', () => {
  const own = '# Bea\n\nKeep this line.\n';
  const f = agentFile('bea', own);
  cb.tellAgent('bea', true);
  const r = cb.tellAgent('bea', false);
  assert.equal(r.changed, true);
  const after = fs.readFileSync(f, 'utf8');
  assert.equal(count(after, cb.START), 0, 'the block was not removed');
  assert.ok(after.includes('Keep this line.'), 'removing the block took the person\'s words');
  const again = cb.tellAgent('bea', false);
  assert.equal(again.changed, false);
});

test('#4289 acceptance 4: a Codex agent gets it in AGENTS.md, a Gemini agent in GEMINI.md, and no CLAUDE.md is made', () => {
  for (const [name, provider, file] of [['cody', 'openai', 'AGENTS.md'], ['gem', 'google', 'GEMINI.md']]) {
    store.writeProfile(name, { displayName: name, provider });
    const f = agentFile(name, `# ${name}\n`, file);
    const r = cb.tellAgent(name, true);
    assert.equal(r.state, projects.TOLD.TOLD, JSON.stringify(r));
    assert.equal(count(fs.readFileSync(f, 'utf8'), cb.START), 1, file + ' did not get the block');
    assert.equal(fs.existsSync(path.join(path.dirname(f), 'CLAUDE.md')), false, 'a CLAUDE.md was invented for ' + name);
  }
});

test('#4289: no instructions file is never invented, and two blocks are refused unchanged', () => {
  const none = cb.tellAgent('ghost', true);
  assert.equal(none.state, projects.TOLD.COULD_NOT);
  assert.equal(fs.existsSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'ghost', 'CLAUDE.md')), false);
  const twice = `# Dup\n${cb.START}\na\n${cb.END}\n${cb.START}\nb\n${cb.END}\n`;
  const f = agentFile('dup', twice);
  const r = cb.tellAgent('dup', true);
  assert.equal(r.state, projects.TOLD.COULD_NOT);
  assert.match(r.because, /2 Kosmos community blocks/);
  assert.equal(fs.readFileSync(f, 'utf8'), twice, 'an ambiguous file was changed');
});
