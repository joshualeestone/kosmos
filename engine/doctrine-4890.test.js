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
  assert.match(born, /<!-- Kosmos added the working rules below on 1 Oct 2026, when it set up this agent\./);
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
  // An edit in the MIDDLE, so the anchor heading is still there and the byte match itself must refuse it.
  const mid = OLD.indexOf('\n', Math.floor(OLD.length / 2));
  const edited = OLD.slice(0, mid) + ' My own note.' + OLD.slice(mid);
  assert.ok(edited.startsWith(defaults.sections()[0].heading) && edited.length === OLD.length + 13);
  assert.notEqual(doctrine.planFor(`# Mine\n\n${edited}\n`, NOW, OLD_TABLE).replacing, true, 'an edited copy was replaced');
  // Words typed onto the copy's LAST line are an edit too.
  assert.notEqual(doctrine.planFor(`# Mine\n\n${OLD} My own addition.\n`, NOW, OLD_TABLE).replacing, true, 'an addition on the last line was replaced');
  assert.equal(doctrine.planFor(`# Mine\n\n${OLD}`, NOW, OLD_TABLE).replacing, true, 'a copy at the very end of the file is not offered');
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
  assert.equal((server.match(/updating: st\.updating === true,/g) || []).length, 2, 'GET /doctrine or the fleet list no longer sends updating');
  // #4890 review 10: the fleet list says what the fleet click does with a replace (leaves it), in the click's words.
  assert.match(server, /state: st\.declined === true && st\.state === 'refresh' \? 'declined' : doctrine\.fleetLeaves\(st\) \? 'could_not' :/,
    'the fleet list does not check a Not now first, as the fleet click does');
  assert.match(server, /\(doctrine\.fleetLeaves\(st\) \|\| st\.because \|\| null\),/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /\(plan\.replacing\s*\n\s*\? 'Your words stay exactly as they are\. The older copy of these rules that Kosmos added is replaced with '/,
    'the consent dialog no longer says the older copy is replaced');
});

test('#4890 review: a heading the person also carries outside the old copy is not written twice', () => {
  const third = defaults.sections()[2];
  const file = `# Mine\n\n${third.heading}\nMy own version.\n\n${OLD}\n`;
  const plan = doctrine.planFor(file, NOW, OLD_TABLE);
  assert.equal(plan.replacing, true);
  assert.equal(plan.fileNext.split(third.heading).length - 1, 1, 'the person\'s heading was duplicated');
  assert.ok(!plan.sections.some((s) => s.heading === third.heading));
});

test('#4890 review: an agent with a span AND a plain old copy has the copy folded into the span', () => {
  // A span from an earlier refresh that added only one missing heading, beside the plain old copy.
  const last = defaults.sections()[defaults.sections().length - 1];
  const oldWithout = OLD.replace('\n' + last.text, () => '');
  const table = [{ version: 1, length: oldWithout.length, sha256: sha(oldWithout) }];
  const file = `# Mine\n\n${oldWithout}\n\n${doctrine.START}\n${doctrine.spanBody([last], NOW)}\n${doctrine.END}\n`;
  const plan = doctrine.planFor(file, NOW, table);
  assert.equal(plan.state, 'refresh');
  assert.equal(plan.replacing, true);
  assert.ok(!plan.fileNext.includes(oldWithout), 'the plain old copy stayed');
  assert.ok(plan.fileNext.includes(BLOCK), 'the span does not hold every current section');
  assert.equal(projects.findBlock(plan.fileNext, doctrine.START, doctrine.END).ambiguous, undefined);
  assert.equal(doctrine.planFor(plan.fileNext, NOW, table).state, 'current', 'the click does not settle it');
});

test('#4890 review: earlier rules INSIDE a span are the span path\'s, never cut out as a plain copy', () => {
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const plan = doctrine.planFor(born, NOW, OLD_TABLE);
  assert.equal(plan.state, 'refresh');
  assert.notEqual(plan.replacing, true, 'a span\'s own earlier rules were treated as a plain copy');
  assert.equal(projects.findBlock(plan.fileNext, doctrine.START, doctrine.END).ambiguous, undefined);
});

test('#4890 review 3: earlier rules inside a span do not hide a plain old copy after it', () => {
  const spanFirst = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const file = `${spanFirst}\n${OLD}\n`;
  const plan = doctrine.planFor(file, NOW, OLD_TABLE);
  assert.equal(plan.replacing, true, 'the plain copy after the span was not seen');
  assert.equal(plan.fileNext.split(OLD).length - 1, 0, 'an old copy stayed');
  assert.ok(plan.fileNext.includes(BLOCK));
});

test('#4890 review 3: where only the plain block fits under the cap, birth writes the plain block, never none', () => {
  const mine = '# Mine\n';
  const plain = defaults.appendTo(mine);
  assert.equal(doctrine.atBirth(mine, NOW, Buffer.byteLength(plain, 'utf8') + 10), plain, 'over the cap, the rules were not written plain');
  assert.notEqual(doctrine.atBirth(mine, NOW, 10 * 1024 * 1024), plain, 'CONTROL: with room, birth did not write the span');
});

test('#4890 review 3: the dialog title says Update when it replaces', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /textContent = \(plan\.replacing \|\| plan\.updating\)\n\s*\? 'Update the working rules in ' \+ who/);
});

test('#4890 review 4: two plain copies settle in ONE click, to one copy of the current rules', () => {
  const OLD2 = BLOCK.replace(LINE, () => LINE + ' (a still older wording)');
  const table = [...OLD_TABLE, { version: 0, length: OLD2.length, sha256: sha(OLD2) }];
  for (const [label, file] of [['two earlier copies', `# Mine\n\n${OLD}\n\n${OLD2}\n`], ['an earlier copy and today\'s', `# Mine\n\n${OLD}\n\n${BLOCK}\n`]]) {
    const plan = doctrine.planFor(file, NOW, table);
    assert.equal(plan.state, 'refresh', label + ': nothing was offered');
    assert.equal(plan.replacing, true, label);
    assert.ok(!plan.fileNext.includes(OLD) && !plan.fileNext.includes(OLD2), label + ': an old copy stayed');
    assert.equal(plan.fileNext.split(defaults.sections()[1].heading).length - 1, 1, label + ': the rules are in the file more than once');
    assert.ok(plan.sections.length > 0, label + ': the dialog lists nothing it writes');
    assert.equal(doctrine.planFor(plan.fileNext, NOW, table).state, 'current', label + ': the click does not settle it');
  }
});

test('#4890 review 4: a copy beside a span that is already current lists the sections the file keeps', () => {
  const file = `${doctrine.atBirth('# Mine\n', NOW)}\n${OLD}\n`;
  const plan = doctrine.planFor(file, NOW, OLD_TABLE);
  assert.equal(plan.replacing, true);
  assert.ok(!plan.fileNext.includes(OLD));
  assert.equal(plan.sections.length, defaults.sections().length, 'the dialog lists nothing for a click that deletes a copy');
});

test('#4890 review 4: the dialog says an edit inside the marked block is set to the current rules', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(page.includes("+ (plan.updating ? 'Anything changed inside the marked block is set to the current rules. ' : '')"));
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /updating: st\.updating === true,/);
  // The flag is set exactly when the click rewrites an existing span, and never for a span-less file.
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  assert.equal(doctrine.planFor(born, NOW).updating, true, 'an existing span\'s update does not say so');
  assert.notEqual(doctrine.planFor('# Mine\n', NOW).updating, true, 'a file with no span claims a marked block');
});

test('#4890 review 6: an earlier block that is a PREFIX of a longer copy does not match it', () => {
  const sections = defaults.sections();
  const prefix = BLOCK.slice(0, BLOCK.lastIndexOf('\n' + sections[sections.length - 1].heading));
  const table = [{ version: 1, length: prefix.length, sha256: sha(prefix) }];
  assert.equal(doctrine.planFor(`# Mine\n\n${BLOCK}\n`, NOW, table).state, 'current', 'today\'s plain copy was offered for nothing');
  // Edited in the MIDDLE of the appended section, so the file does not start with today's block: only the
  // goes-on-into-another-section rule can refuse it.
  const lastText = sections[sections.length - 1].text;
  const cut = lastText.indexOf('\n', lastText.indexOf('\n') + 1);
  const longerEdited = prefix + '\n' + lastText.slice(0, cut) + ' My own edit.' + lastText.slice(cut);
  assert.ok(!longerEdited.startsWith(BLOCK) && cut > 0);
  assert.notEqual(doctrine.planFor(`# Mine\n\n${longerEdited}\n`, NOW, table).replacing, true, 'an edited longer copy was cut at its prefix');
  // An earlier block that is today's minus its last LINE (not a section): only the today's-block rule refuses it.
  const minusLine = BLOCK.slice(0, BLOCK.lastIndexOf('\n'));
  assert.ok(!/^\s*### /.test(BLOCK.slice(minusLine.length + 1)), 'this fixture needs a last line that is not a heading');
  const t2 = [{ version: 1, length: minusLine.length, sha256: sha(minusLine) }];
  assert.equal(doctrine.planFor(`# Mine\n\n${BLOCK}\n`, NOW, t2).state, 'current', 'today\'s copy was matched as an earlier prefix');
  // CONTROL: the prefix alone still matches.
  assert.equal(doctrine.planFor(`# Mine\n\n${prefix}\n`, NOW, table).replacing, true);
});

test('#4890 review 6: a role template carrying today\'s block inline is framed in the span at birth', () => {
  const own = 'You are Sam.\n\n## Make this yours\n\nEverything above this line is a starting point.\n\n' + BLOCK;
  const born = doctrine.atBirth(own, NOW);
  assert.ok(born.startsWith('You are Sam.\n'), 'the template text moved');
  assert.ok(projects.findBlock(born, doctrine.START, doctrine.END), 'the inline rules were left plain');
  assert.equal(born.split(defaults.sections()[1].heading).length - 1, 1, 'the rules are in the file twice');
  assert.equal(doctrine.planFor(born, NOW).state, 'current');
  // The real templates, through roles.js.
  const roles = require('./roles');
  for (const key of ['own', 'setup']) {
    const r = (roles.ROLES || []).find((x) => x.key === key);
    const text = r && r.instructions;
    assert.equal(typeof text, 'string', 'the ' + key + ' template is not where this test looks');
    assert.ok(projects.findBlock(doctrine.atBirth(text, NOW), doctrine.START, doctrine.END), key + ' was born with plain rules');
  }
  const edited = own.replace('## How you work', () => '## How I work');
  assert.equal(doctrine.atBirth(edited + '\n' + defaults.RULES_PHRASE, NOW), edited + '\n' + defaults.RULES_PHRASE, 'text carrying the phrase but not today\'s block was changed');
});

test('#4890 review 6: an update to an existing span has its own title and sentence', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(page.includes("? 'Your words outside the marked block stay exactly as they are. The working rules in it are brought up to date. '"));
  assert.ok(page.includes("+ ((plan.replacing || plan.updating) ? 'This restarts ' : 'Adding them restarts ')"));
  assert.ok(page.includes("#doc-go').textContent = (plan.replacing || plan.updating) ? 'Update & Restart' : 'Add & Restart';"),
    'the confirm button names a different act from the title');
});

test('#4890 review 7: a heading of the person\'s own right after an unedited copy keeps it unmatched (safe, named)', () => {
  // Accepted miss, pinned so it is a decision: the copy-goes-on rule cannot tell their heading from an appended
  // section, and it errs toward leaving the copy as it is (today's missing-headings rule).
  const plan = doctrine.planFor(`# Mine\n\n${OLD}\n\n### My own notes\nSomething.\n`, NOW, OLD_TABLE);
  assert.notEqual(plan.replacing, true);
  assert.ok(!plan.fileNext || plan.fileNext.includes('### My own notes\nSomething.'));
});

const fleet = require('../test-support/fleet');
function rosterOf(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const roster = board.agents;
  board.restore();
  return roster;
}
function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return path.join(dir, 'CLAUDE.md');
}

test('#4890 review 9: cutting an older copy needs the per-agent dialog\'s hash; the fleet click leaves it', () => {
  const text = `# Mine\n\n${OLD}\n`;
  const file = agentFile('fleetcut', text);
  const fleetClick = doctrine.refresh('fleetcut', rosterOf('fleetcut'), { now: NOW, past: OLD_TABLE });
  assert.equal(fleetClick.state, 'could_not');
  assert.equal(fleetClick.because, doctrine.FLEET_LEAVES_REPLACE);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'the fleet click wrote');
  const plan = doctrine.planFor(text, NOW, OLD_TABLE);
  const ownPage = doctrine.refresh('fleetcut', rosterOf('fleetcut'), { now: NOW, past: OLD_TABLE, expectHash: plan.hash });
  assert.equal(ownPage.state, 'added', 'CONTROL: the per-agent click with the hash did not write');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(OLD));
});

test('#4890 review 9: an imported file carrying today\'s rules is left as it is', () => {
  const mine = `# Mine\n\n${BLOCK}\n`;
  assert.equal(doctrine.atBirth(mine, NOW, undefined, { frameInline: false }), mine, 'the import framed the person\'s own file');
  assert.notEqual(doctrine.atBirth(mine, NOW), mine, 'CONTROL: creation no longer frames an inline copy');
  const discover = fs.readFileSync(path.join(__dirname, 'discover.js'), 'utf8');
  assert.match(discover, /atBirth\(text, undefined, MAX_BYTES, \{ frameInline: false \}\)/);
});

test('#4890 review 12: a span the person edited at the version it carries raises no "updated rules" banner', () => {
  const store = require('./store');
  const born = doctrine.atBirth('# Mine\n', NOW).replace(LINE, () => LINE + ' My own edit.');
  agentFile('editedspan', born);
  store.writeProfile('editedspan', { doctrineVersion: defaults.DOCTRINE_VERSION });
  assert.equal(doctrine.status('editedspan', NOW).state, 'current', 'the person\'s own edit raised the banner');
  // CONTROL: carried an earlier version, so the update is offered.
  store.writeProfile('editedspan', { doctrineVersion: defaults.DOCTRINE_VERSION - 1 });
  assert.equal(doctrine.status('editedspan', NOW).state, 'refresh');
});

test('#4890 review 12: a born span saved with Windows line endings is still current', () => {
  const born = doctrine.atBirth('# Mine\n', NOW);
  assert.equal(doctrine.planFor(born.replace(/\n/g, '\r\n'), NOW).state, 'current');
});

test('#4890 review 12 (decided, pinned): a paragraph of the person\'s right after an unedited copy is kept, outside the span', () => {
  const plan = doctrine.planFor(`# Mine\n\n${OLD}\nMy own paragraph.\n`, NOW, OLD_TABLE);
  assert.equal(plan.replacing, true);
  assert.ok(plan.fileNext.includes(`${doctrine.END}\nMy own paragraph.\n`), 'the person\'s paragraph was lost or moved into the span');
});

test('#4890 review 13: the fleet click leaves a span the person edited at its carried version, as status() says', () => {
  const store = require('./store');
  const born = doctrine.atBirth('# Mine\n', NOW).replace(LINE, () => LINE + ' My own edit.');
  const file = agentFile('fleetedit', born);
  store.writeProfile('fleetedit', { doctrineVersion: defaults.DOCTRINE_VERSION });
  assert.equal(doctrine.refresh('fleetedit', rosterOf('fleetedit'), { now: NOW }).state, 'current');
  assert.equal(fs.readFileSync(file, 'utf8'), born, 'the fleet click overwrote the person\'s edit');
  // At an earlier carried version the edit is still the person's, so the fleet click leaves it too (review 15); the
  // unedited case is brought current, in the review 15 test.
  store.writeProfile('fleetedit', { doctrineVersion: defaults.DOCTRINE_VERSION - 1 });
  assert.equal(doctrine.refresh('fleetedit', rosterOf('fleetedit'), { now: NOW }).because, doctrine.FLEET_LEAVES_EDITED);
  assert.ok(fs.readFileSync(file, 'utf8').includes('My own edit.'));
});

test('#4890 review 15: the fleet click updates an UNEDITED span at an older version, and leaves an edited one', () => {
  const store = require('./store');
  const unedited = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const a = agentFile('fleetold', unedited);
  store.writeProfile('fleetold', { doctrineVersion: defaults.DOCTRINE_VERSION - 1 });
  assert.equal(doctrine.refresh('fleetold', rosterOf('fleetold'), { now: NOW, past: OLD_TABLE }).state, 'added');
  assert.ok(fs.readFileSync(a, 'utf8').includes(BLOCK) && !fs.readFileSync(a, 'utf8').includes(OLD));
  const edited = unedited.replace(OLD, () => OLD + ' My own edit.');
  const b = agentFile('fleetedited', edited);
  store.writeProfile('fleetedited', { doctrineVersion: defaults.DOCTRINE_VERSION - 1 });
  const got = doctrine.refresh('fleetedited', rosterOf('fleetedited'), { now: NOW, past: OLD_TABLE });
  assert.equal(got.state, 'could_not');
  assert.equal(got.because, doctrine.FLEET_LEAVES_EDITED);
  assert.equal(fs.readFileSync(b, 'utf8'), edited, 'the fleet click overwrote the person\'s edit');
  // CONTROL: the per-agent click (with the dialog's hash) does update it, and the dialog said so.
  const plan = doctrine.planFor(edited, NOW, OLD_TABLE);
  assert.equal(plan.edited, true);
  assert.equal(doctrine.refresh('fleetedited', rosterOf('fleetedited'), { now: NOW, past: OLD_TABLE, expectHash: plan.hash }).state, 'added');
});

test('#4890 review 16: an UNEDITED earlier block in a span at the carried version still gets the banner', () => {
  const store = require('./store');
  agentFile('restored', doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD));   // e.g. a .previous restored
  store.writeProfile('restored', { doctrineVersion: defaults.DOCTRINE_VERSION });
  const st = doctrine.status('restored', NOW, OLD_TABLE);
  assert.equal(st.state, 'refresh', 'an unedited earlier block was hidden as if the person had edited it');
});
