'use strict';
/**
 * #4420 (Josh, 2026-09-28 15:29): a Gemini agent saved a file for him in its own folder (the one above Files), so it
 * never showed on its page, then said it was in the files panel. The Files block did reach its GEMINI.md (measured),
 * but at the END of a long file. So: a one-line pointer at the TOP for every non-Claude runner, and two sentences in
 * the block that make the mistake and the false claim explicit.
 *
 *   node --test engine/dmfiles.top-4420.test.js
 */
// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dmfiles-top-4420-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const dm = require('./dmfiles');
const projects = require('./projects');
const store = require('./store');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const LONG = 'Some instruction line about the job.\n'.repeat(300);
function agent(name, provider, file) {
  store.writeProfile(name, { displayName: name, provider });
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, file);
  fs.writeFileSync(f, '# ' + name + '\nYou are a project manager.\n' + LONG);
  return f;
}
const count = (s, needle) => s.split(needle).length - 1;

test('#4420: every non-Claude agent gets the pointer right under its first heading, naming its own Files folder', () => {
  for (const [name, provider, file] of [['gem', 'google', 'GEMINI.md'], ['agyx', 'antigravity', 'AGENTS.md'], ['cody', 'openai', 'AGENTS.md'], ['groky', 'xai', 'AGENTS.md']]) {
    const f = agent(name, provider, file);
    const r = dm.tellAgent(name, null, { trusted: true });
    assert.equal(r.state, projects.TOLD.TOLD, name + ': ' + JSON.stringify(r));
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    assert.equal(lines[0], '# ' + name, name + ': the heading moved');
    assert.equal(lines[2], dm.TOP_START, name + ': the pointer is not at the top (it is what a model reads first)');
    assert.match(lines[3], new RegExp('go directly in `' + path.join(path.dirname(f), 'Files').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '`, never your own folder above it'));
    const text = lines.join('\n');
    assert.equal(count(text, dm.START), 1, name + ': the full block is missing');
    assert.ok(text.indexOf(dm.TOP_START) < text.indexOf(dm.START), name + ': the pointer is below the block it points to');
    assert.equal(fs.existsSync(path.join(path.dirname(f), 'CLAUDE.md')), false, name + ': a CLAUDE.md was invented');
  }
});

test('#4420: a Claude agent gets no pointer, and one left from another runner is taken out', () => {
  const f = agent('claudy', 'anthropic', 'CLAUDE.md');
  assert.equal(dm.tellAgent('claudy', null, { trusted: true }).state, projects.TOLD.TOLD);
  const text = fs.readFileSync(f, 'utf8');
  assert.equal(count(text, dm.TOP_START), 0, 'a Claude agent got the pointer (the fleet\'s own CLAUDE.md files would change)');
  assert.equal(count(text, dm.START), 1, 'control: the block itself is still written');
  fs.writeFileSync(f, dm.spliceTop(text, '/x/Files'));
  assert.equal(dm.tellAgent('claudy', null, { trusted: true }).state, projects.TOLD.TOLD);
  assert.equal(count(fs.readFileSync(f, 'utf8'), dm.TOP_START), 0, 'a pointer left from a previous runner stayed');
});

test('#4420: a second sync changes nothing, and two pointers are refused unchanged', () => {
  const f = agent('gem2', 'google', 'GEMINI.md');
  dm.tellAgent('gem2', null, { trusted: true });
  const once = fs.readFileSync(f, 'utf8');
  dm.tellAgent('gem2', null, { trusted: true });
  assert.equal(fs.readFileSync(f, 'utf8'), once, 'not idempotent: every boot would rewrite the file');
  const two = once.replace(dm.TOP_END, dm.TOP_END + '\n' + dm.TOP_START + '\nx\n' + dm.TOP_END);
  fs.writeFileSync(f, two);
  const r = dm.tellAgent('gem2', null, { trusted: true });
  assert.equal(r.state, projects.TOLD.COULD_NOT);
  assert.equal(fs.readFileSync(f, 'utf8'), two, 'an ambiguous file was changed');
});

test('#4420: the block says where NOT to save and forbids claiming a file is under Files when it is not', () => {
  const flat = dm.blockBody('/Users/someone/work/workers/writer/Files').replace(/\s+/g, ' ');
  assert.match(flat, /Directly inside that folder: not in your own folder above it, and not in a subfolder\./);
  assert.match(flat, /Only files there appear on your page; a file anywhere else is invisible to the person\./);
  assert.match(flat, /Never tell them a file is under Files unless you saved it at that exact path\./);
  assert.doesNotMatch(flat, /Files folder is inside your own folder/, 'the phrase that points a model at the folder above');
});

test('#4420: the pointer\'s markers are registered (every neutraliser guards them) and birth uses the same composition', () => {
  const all = projects.ALL_MARKERS();
  assert.ok(all.includes(dm.TOP_START) && all.includes(dm.TOP_END));
  const create = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.match(create, /const spliced = dmMod\.applyTo\(text, name, runner\);/, 'a new agent is born without the pointer');
});
