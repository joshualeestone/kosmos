'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-doctrine-4890-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const defaults = require('./defaults');
const projects = require('./projects');
const doctrine = require('./doctrine');
const PAST = require('./doctrine-past');

const NOW = new Date(2026, 9, 1);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const BLOCK = defaults.block();
// An earlier copy of the rules: today's with one sentence changed, as a same-heading edit leaves it.
const LINE = defaults.sections()[1].text.split('\n').find((l) => l.length > 20);
const OLD = BLOCK.replace(LINE, () => LINE + ' (an older wording)');   // a function: the rules contain `$`
const OLD_TABLE = [{ version: 1, length: OLD.length, sha256: sha(OLD) }];

test('#4890: an agent is born with the rules inside the managed span, and is current from birth', () => {
  const born = doctrine.atBirth('# Mine\n\nMy words.\n', NOW);
  const span = projects.findBlock(born, doctrine.START, doctrine.END);
  assert.ok(span && !span.ambiguous, 'birth wrote no managed span');
  assert.ok(born.startsWith('# Mine\n\nMy words.\n'), 'the person\'s words moved');
  assert.ok(born.slice(span.start, span.end).includes('\n' + BLOCK + '\n'), 'the span does not hold the rules whole');
  assert.match(born, /<!-- Kosmos added the working rules below on 1 Oct 2026, when it made this agent\./);
  assert.equal(doctrine.planFor(born, NOW).state, 'current', 'a newborn agent is offered an update');
  assert.equal(doctrine.atBirth(born, NOW), born, 'the rules were added twice');
});

test('#4890 (the card): a change under an EXISTING heading reaches an agent born before it', () => {
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);   // born under the older wording
  assert.notEqual(born, doctrine.atBirth('# Mine\n', NOW));
  const plan = doctrine.planFor(born, NOW);
  assert.equal(plan.state, 'refresh', 'a same-heading change did not reach an agent born before it');
  assert.ok(plan.fileNext.includes(BLOCK) && !plan.fileNext.includes(OLD));
  assert.ok(plan.fileNext.startsWith('# Mine\n'));
});

test('#4890: an unedited plain copy of an earlier block is offered the current rules, in its place', () => {
  const file = `# Mine\n\nMy words.\n\n${OLD}\n\nWords after.\n`;
  const plan = doctrine.planFor(file, NOW, OLD_TABLE);
  assert.equal(plan.state, 'refresh');
  assert.equal(plan.replacing, true);
  assert.equal(plan.sections.length, defaults.sections().length, 'the dialog does not list every section it writes');
  assert.equal(plan.fileNext, `# Mine\n\nMy words.\n\n${doctrine.START}\n${plan.spanNext}\n${doctrine.END}\n\nWords after.\n`,
    'anything but the old copy moved');
  assert.equal(doctrine.planFor(plan.fileNext, NOW, OLD_TABLE).state, 'current', 'the click does not settle it');
  // CONTROL: the same file with the shipped table only (no OLD in it) is not a replace, so the table is what decided.
  assert.notEqual(doctrine.planFor(file, NOW).replacing, true);
});

test('#4890: a copy the person edited, or today\'s own copy, is never replaced', () => {
  const edited = OLD.replace('## How you work', () => '## How you work, my way');
  assert.notEqual(doctrine.planFor(`# Mine\n\n${edited}\n`, NOW, OLD_TABLE).replacing, true, 'an edited copy was replaced');
  const one = OLD.slice(0, -1) + (OLD.slice(-1) === '.' ? '!' : '.');
  assert.notEqual(doctrine.planFor(`# Mine\n\n${one}\n`, NOW, OLD_TABLE).replacing, true, 'a one-character edit was replaced');
  assert.equal(doctrine.planFor(`# Mine\n\n${BLOCK}\n`, NOW).state, 'current', 'today\'s plain copy was offered for nothing');
  assert.equal(doctrine.pastBlockIn(`x${OLD}\n`, OLD_TABLE), null, 'a copy not at the start of a line matched');
});

test('#4890: text that already holds a doctrine marker gets the plain block at birth, not a span among them', () => {
  const pasted = `# Mine\n\n${doctrine.START}\nsomething\n`;
  assert.equal(doctrine.atBirth(pasted, NOW), defaults.appendTo(pasted));
});

test('#4890: the shipped table holds today\'s block and every version before it (run tools/doctrine-past.js)', () => {
  assert.ok(PAST.some((r) => r.length === BLOCK.length && r.sha256 === sha(BLOCK)),
    'engine/doctrine-past.js does not hold the current block: run node tools/doctrine-past.js');
  for (let v = 3; v <= defaults.DOCTRINE_VERSION; v += 1) assert.ok(PAST.some((r) => r.version === v), 'no row for version ' + v);
  for (const r of PAST) assert.ok(Number.isInteger(r.length) && /^[0-9a-f]{64}$/.test(r.sha256), JSON.stringify(r));
});

test('#4890: the board passes `replacing` through, and the dialog says the older copy is replaced in place', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.equal((server.match(/replacing: st\.replacing === true,/g) || []).length, 2, 'GET /doctrine or the fleet list no longer sends replacing');
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /\(plan\.replacing\s*\n\s*\? 'Your words stay exactly as they are\. The older copy of these rules that Kosmos added is replaced with '/,
    'the consent dialog no longer says the older copy is replaced');
});
