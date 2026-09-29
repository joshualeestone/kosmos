'use strict';
/**
 * #4420 (Josh, 2026-09-28 15:29): a Gemini agent saved a file for him in its own folder (the one above Files), so it
 * never showed on its page, then said it was in the files panel. The Files block did reach its GEMINI.md (measured),
 * but at the END of a long file, and the doctrine's earlier "Where the files you make go" said "your own folder"
 * (the agent stopped there, by its own account). So: a one-line pointer in EVERY agent's file, before its working rules, the doctrine
 * section rewritten, and two sentences in the block that make the mistake and the false claim explicit.
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

test('#4420: every agent, Claude included, gets the pointer naming its own Files folder; with no working rules in the file it is appended, and the person\'s text is untouched (#1071)', () => {
  for (const [name, provider, file] of [['claudy', 'anthropic', 'CLAUDE.md'], ['gem', 'google', 'GEMINI.md'], ['agyx', 'antigravity', 'AGENTS.md'], ['cody', 'openai', 'AGENTS.md'], ['groky', 'xai', 'AGENTS.md']]) {
    const f = agent(name, provider, file);
    const r = dm.tellAgent(name, null, { trusted: true });
    assert.equal(r.state, projects.TOLD.TOLD, name + ': ' + JSON.stringify(r));
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(text.startsWith('# ' + name + '\nYou are a project manager.\n' + LONG), name + ': the person\'s own text changed (#1071: it passes through byte for byte)');
    const line = text.slice(text.indexOf(dm.TOP_START) + dm.TOP_START.length + 1).split('\n')[0];
    assert.equal(count(text, dm.TOP_START), 1, name + ': no pointer, or two');
    assert.match(line, new RegExp('goes directly in `' + path.join(path.dirname(f), 'Files').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '`'));
    assert.match(line, /the only folder they see on your page in Kosmos\. Your own folder above it is for your working notes\./);
    assert.equal(count(text, dm.START), 1, name + ': the full block is missing');
    if (file !== 'CLAUDE.md') assert.equal(fs.existsSync(path.join(path.dirname(f), 'CLAUDE.md')), false, name + ': a CLAUDE.md was invented');
  }
});

test('#4420: the pointer sits ABOVE the doctrine section that says "your own folder" (the one the agent obeyed)', () => {
  const doctrineText = require('./defaults').block();
  const f = agent('born', 'google', 'GEMINI.md');
  fs.writeFileSync(f, '# born\nYou are a project manager.\n' + doctrineText + '\n' + LONG);
  dm.tellAgent('born', null, { trusted: true });
  const text = fs.readFileSync(f, 'utf8');
  const rules = text.indexOf('## How you work, whatever the job');
  assert.ok(text.indexOf(dm.TOP_START) < text.indexOf('### Where the files you make go'), 'the pointer is below the earlier rule');
  assert.ok(text.indexOf(dm.TOP_END) < rules, 'the pointer came after the working rules, not before them');
  assert.ok(text.startsWith('# born\nYou are a project manager.\n'), 'the person\'s own words are no longer first (#591)');
});

test('#4420: the doctrine sends a file made for the person to Files, and names the rule that carries its path', () => {
  const flat = require('./defaults').sections().find((x) => x.heading === '### Where the files you make go').text.replace(/\s+/g, ' ');
  assert.match(flat, /A file you make for the person that is not a project\u2019s goes in your Files folder, the only place they see it on your page in Kosmos/);
  assert.match(flat, /"Where to save files you make for the person"/, 'the doctrine does not point at the section with the path');
  assert.match(flat, /Your own folder, the one above Files, is never where a file made for the person goes/);
  assert.doesNotMatch(flat, /your own folder is where it goes/, 'the sentence the agent stopped at is back');
  assert.equal(require('./defaults').DOCTRINE_VERSION, 16);
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
  assert.match(create, /const spliced = dmMod\.applyTo\(text, name\);/, 'a new agent is born without the pointer');
});

test('#4420: rules in a MANAGED span (a consented refresh): the pointer goes before the span, never inside it, and the refresh stays current', () => {
  const doctrine = require('./doctrine');
  const NOW = new Date('2026-09-28T12:00:00Z');
  const accepted = doctrine.planFor('# managed\nYou are a project manager.\n', NOW).fileNext;   // what an accepted refresh writes
  assert.equal(doctrine.planFor(accepted, NOW).state, 'current', 'precondition: the fixture is an up-to-date refresh');
  assert.ok(accepted.indexOf('\n## How you work, whatever the job') > accepted.indexOf(doctrine.START), 'precondition: the heading is INSIDE the span');
  const f = agent('managed', 'google', 'GEMINI.md');
  fs.writeFileSync(f, accepted);
  dm.tellAgent('managed', null, { trusted: true });
  const once = fs.readFileSync(f, 'utf8');
  assert.ok(once.indexOf(dm.TOP_END) < once.indexOf(doctrine.START), 'the pointer went inside the working-rules span');
  assert.equal(doctrine.planFor(once, NOW).state, 'current', 'the pointer made the rules read as out of date');
  dm.tellAgent('managed', null, { trusted: true });
  assert.equal(fs.readFileSync(f, 'utf8'), once, 'a second board start rewrote the file');
});

test('#4420: with the rules as plain text (the person\'s, #122) the pointer is INSERT-ONLY: cutting it out gives the file back byte for byte', () => {
  const doctrineText = require('./defaults').block();
  for (const before of ['# born\nYou are a project manager.\n', '# born\nYou are a project manager.\n\n', '']) {
    const original = before + doctrineText + '\nMy own closing line.\n';
    const spliced = dm.spliceTop(original, '/Users/x/work/workers/born/Files');
    const block = dm.TOP_START + '\n' + dm.topLine('/Users/x/work/workers/born/Files') + '\n' + dm.TOP_END;
    assert.equal(spliced.split(block + '\n\n').length, 2, 'the pointer is not in its one fixed shape');
    assert.equal(spliced.replace(block + '\n\n', ''), original, 'a byte of the person\'s file changed: ' + JSON.stringify(before));
    assert.ok(spliced.indexOf(block) < spliced.indexOf('## How you work, whatever the job'), 'the pointer is not before the rules');
  }
  // A heading line that only STARTS with the words is not the heading (the match is on a whole line).
  const lookalike = '# x\n## How you work, whatever the job, and more\n';
  assert.ok(dm.spliceTop(lookalike, '/f').endsWith(dm.TOP_END + '\n'), 'a lookalike heading drew the pointer into the middle');
});

test('#4420 review 2: a file with Windows line endings (CRLF) gets the pointer BEFORE the rules, in CRLF, and cuts back out byte for byte', () => {
  const dir = '/Users/x/work/workers/born/Files';
  const original = ('# born\nYou are a project manager.\n\n' + require('./defaults').block() + '\nMy own closing line.\n').replace(/\n/g, '\r\n');
  const spliced = dm.spliceTop(original, dir);
  const block = dm.TOP_START + '\r\n' + dm.topLine(dir) + '\r\n' + dm.TOP_END;
  assert.ok(spliced.indexOf(block) !== -1 && spliced.indexOf(block) < spliced.indexOf('## How you work, whatever the job'),
    'a CRLF file got the pointer appended after the rules (the placement this card fixes)');
  assert.equal(spliced.replace(block + '\r\n\r\n', ''), original, 'a byte of the CRLF file changed');
  assert.doesNotMatch(spliced.replace(/\r\n/g, ''), /\n/, 'a bare LF went into a CRLF file');
  assert.equal(dm.spliceTop(spliced, dir), spliced, 'a second sync of the CRLF file changed it');
});
