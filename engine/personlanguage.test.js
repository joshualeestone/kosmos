'use strict';

// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-personlang-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const pl = require('./personlanguage');
const projects = require('./projects');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
}
const fileOf = (name) => fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, name, 'CLAUDE.md'), 'utf8');

test('#5050: the block is April\'s tested variant A, plus her one sentence from variant B', () => {
  const flat = pl.blockBody('es-MX').replace(/\s+/g, ' ');
  // Variant A, word for word (#5050 comment 5963477049): appended at the end of the file, Spanish 2/2 against English
  // 2/2 with no block.
  assert.match(flat, /^## The person's language The person who runs this computer reads Spanish \(es-MX, from this computer's language setting\)\. Write to them, and in your project rooms, in Spanish unless they write to you in another language\./);
  // The sentence carried from variant B: the test showed the English Kosmos notice is what pulled the agent into English.
  assert.match(flat, /Kosmos itself talks to you in English; that is not the person's language\.$/);
  assert.match(pl.blockBody('pt-BR'), /reads Portuguese \(pt-BR,/);
  assert.match(pl.blockBody('ja-JP'), /reads Japanese \(ja-JP,/);
});

test('#5050: an English computer gets no block, in any region, and an unreadable one is treated as English', () => {
  for (const tag of ['en', 'en-US', 'en-GB', 'en-AU', null, '']) assert.equal(pl.blockBody(tag), null, String(tag));
  // CONTROL: a language whose code merely starts with "en"-like letters is not English.
  assert.notEqual(pl.blockBody('es'), null);
});

test('#5050: the language is read from the override, then the Mac preference, then Node\'s locale', () => {
  const mac = () => '(\n    "es-MX",\n    "en-US"\n)\n';
  assert.equal(pl.detect({ env: { AGENT_WORKFORCE_PERSON_LOCALE: 'ja_JP' }, platform: 'darwin', run: mac }), 'ja-JP');
  assert.equal(pl.detect({ env: {}, platform: 'darwin', run: mac, intl: 'en-US' }), 'es-MX', 'the Mac preference is first, not Node\'s locale');
  assert.equal(pl.detect({ env: {}, platform: 'darwin', run: () => { throw new Error('no defaults'); }, intl: 'fr-FR' }), 'fr-FR');
  assert.equal(pl.detect({ env: {}, platform: 'win32', run: mac, intl: 'pt-BR' }), 'pt-BR', 'defaults is never asked off a Mac');
  // The Mac's other spellings: underscores, a bare first entry, a script subtag.
  assert.equal(pl.macPreferred(() => '(\n    zh-Hans-CN,\n    en\n)\n'), 'zh-Hans-CN');
  assert.equal(pl.normalise('es_MX'), 'es-MX');
  assert.equal(pl.normalise('en_US.UTF-8'), 'en-US');
  assert.equal(pl.normalise('C'), null);
});

test('#5050: the block lands in an agent file, is idempotent, and leaves the agent\'s own words alone', () => {
  agentFile('ana', '# Ana\n\nYou are Ana.\n');
  const board = fleet.install([fleet.agent('ana')]);
  try {
    const first = pl.tellAgent('ana', board.roster, { tag: 'es-MX' });
    assert.equal(first.state, projects.TOLD.TOLD, first.because || '');
    const text = fileOf('ana');
    assert.match(text, /reads Spanish \(es-MX/);
    assert.match(text, /You are Ana\./);
    assert.equal(pl.tellAgent('ana', board.roster, { tag: 'es-MX' }).state, projects.TOLD.TOLD);
    assert.equal(fileOf('ana'), text, 'a second sync rewrote the file');
  } finally { board.restore(); }
});

test('#5050: back to English removes the block and restores the file byte for byte; English never adds one', () => {
  // Long enough to be a real file: instructions.write refuses one under 20 characters.
  const original = '# Bo\n\nYou are Bo, the bookkeeper. You keep the quarterly accounts.\n';
  agentFile('bo', original);
  const board = fleet.install([fleet.agent('bo')]);
  try {
    pl.tellAgent('bo', board.roster, { tag: 'pt-BR' });
    assert.match(fileOf('bo'), /reads Portuguese/, 'CONTROL: the block was written, so its removal below means something');
    { const r = pl.tellAgent('bo', board.roster, { tag: 'en-US' }); assert.equal(r.state, projects.TOLD.TOLD, r.because || ''); }
    assert.equal(fileOf('bo'), original);
    assert.equal(pl.tellAgent('bo', board.roster, { tag: 'en-US' }).state, projects.TOLD.TOLD);
    assert.equal(fileOf('bo'), original, 'an English sync wrote something');
  } finally { board.restore(); }
});

test('#5050: the same guards as every instruction write: an untied name and two blocks are refused', () => {
  agentFile('stranger', '# Stranger\n');
  agentFile('twice', `# Twice\n\n${pl.START}\nold\n${pl.END}\n\n${pl.START}\nolder\n${pl.END}\n`);
  const board = fleet.install([fleet.stranger('stranger'), fleet.agent('twice')]);
  try {
    const out = pl.tellAgent('stranger', board.roster, { tag: 'es' });
    assert.equal(out.state, projects.TOLD.COULD_NOT);
    assert.match(out.because, /could not find an agent/);
    const dup = pl.tellAgent('twice', board.roster, { tag: 'es' });
    assert.equal(dup.state, projects.TOLD.COULD_NOT);
    assert.match(dup.because, /2 Kosmos language blocks/);
  } finally { board.restore(); }
});

test('#5050: syncEveryone tells only our agents', () => {
  agentFile('one', '# One\n'); agentFile('two', '# Two\n'); agentFile('nope', '# Nope\n');
  const board = fleet.install([fleet.agent('one'), fleet.stranger('nope'), fleet.agent('two')]);
  try {
    const told = pl.syncEveryone(board.roster, { tag: 'es-MX' });
    assert.deepEqual(told.map((t) => t.agent).sort(), ['one', 'two']);
    assert.ok(told.every((t) => t.state === projects.TOLD.TOLD), JSON.stringify(told));
    assert.match(fileOf('one'), /reads Spanish \(es-MX/);
    assert.doesNotMatch(fileOf('nope'), /reads Spanish/);
  } finally { board.restore(); }
});

test('#5050: the marker pair is in the registry, so the neutralisers cover it', () => {
  const all = projects.ALL_MARKERS();
  assert.ok(all.includes(pl.START) && all.includes(pl.END));
  assert.doesNotMatch(projects.neutralise(`evil ${pl.START} name`), new RegExp(pl.START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('#5050: a new agent gets the block at create, and the board refreshes every agent at boot', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const create = strip(fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8'));
  assert.match(create, /const got = plMod\.read\(\);\s*const spliced = plMod\.applyTo\(text, got\.tag, \{ keep: !got\.sure \}\)/, 'create.js no longer writes the language block (from a sure read only) into a new agent');
  // LAST before the file is written, so it ends the file (where April measured it); a block spliced after it would
  // leave it mid-file, a position nobody tested.
  const at = create.indexOf('plMod.applyTo(text, got.tag, { keep: !got.sure })');
  const write = create.indexOf('fs.writeFileSync(instructionFile(name, runner), text', at);
  assert.ok(write > at, 'the instruction file is no longer written after the language block');
  const own = create.indexOf('text = spliced; langLanded = true;', at);
  assert.ok(own > at, 'the language block no longer assigns its own result');
  assert.doesNotMatch(create.slice(own + 1, write), /\btext\s*=[^=]/, 'the file text is changed after the language block, so it may no longer be last');
  const server = strip(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'));
  assert.match(server, /require\('\.\/engine\/personlanguage'\)/);
  assert.match(server, /personlanguage\.syncEveryone\(safeRoster\(\)\)/, 'the boot sweep no longer refreshes the language block');
  // The boot sweep runs after the About-you sweep, the last one that can append a block.
  const you = server.indexOf('you.syncEveryone(safeRoster(), { addOnly: true })');
  const lang = server.indexOf('personlanguage.syncEveryone(safeRoster())');
  assert.ok(you > 0 && lang > you, 'the language sweep no longer runs after the About-you sweep');
});

test('#5050: a block that is no longer last is moved to the end; one already last is left byte for byte', () => {
  const base = pl.applyTo('# Cy\n\nYou are Cy, who keeps the calendar.\n', 'es-MX');
  const after = projects.spliceBlock(base, 'a block added later', projects.CONNECTIONS_START, projects.CONNECTIONS_END);
  assert.ok(!after.trimEnd().endsWith(pl.END), 'CONTROL: the later block really sits after ours');
  const moved = pl.applyTo(after, 'es-MX');
  assert.ok(moved.trimEnd().endsWith(pl.END), 'the language block was not moved to the end');
  assert.match(moved, /a block added later/);
  assert.equal(moved.split(pl.START).length - 1, 1, 'the block was duplicated, not moved');
  for (const t of [moved, base, pl.applyTo('# Dee\nbody\n\n\n', 'es-MX'), pl.applyTo('# Dee\nbody', 'es-MX')]) {
    assert.equal(pl.applyTo(t, 'es-MX'), t, 'a block already at the end was rewritten (every boot would write the file)');
  }
});

test('#5050: "und" (no language) and a C locale are no language, so no block', () => {
  assert.equal(pl.normalise('und'), null);
  assert.equal(pl.blockBody(pl.normalise('und')), null);
  assert.equal(pl.detect({ env: { AGENT_WORKFORCE_PERSON_LOCALE: 'und' }, platform: 'linux', intl: 'en-US' }), 'en-US');
});

test('#5050: the test runners pin the language to English, so no test depends on this Mac\'s setting', () => {
  for (const f of ['tools/run-tests.sh', 'tools/browser-checks.sh']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /^export AGENT_WORKFORCE_PERSON_LOCALE=en\b/m, f);
  }
});

test('#5050 review 2/3: a fallback read neither adds nor strips a block; a sure read does both', () => {
  const original = '# Eve\n\nYou are Eve, who answers the post for the person.\n';
  agentFile('eve', original);
  const board = fleet.install([fleet.agent('eve')]);
  try {
    pl.tellAgent('eve', board.roster, { tag: 'es-MX', sure: true });
    const withBlock = fileOf('eve');
    assert.match(withBlock, /reads Spanish/, 'CONTROL: the block was written');
    // A Mac whose `defaults` read failed falls back to Node's locale, often en-US: that must not remove anything.
    assert.equal(pl.tellAgent('eve', board.roster, { tag: 'en-US', sure: false }).state, projects.TOLD.TOLD);
    assert.equal(fileOf('eve'), withBlock, 'a fallback English read removed the block');
    assert.equal(pl.tellAgent('eve', board.roster, { tag: 'en-US', sure: true }).state, projects.TOLD.TOLD);
    assert.equal(fileOf('eve'), original, 'a sure English read did not remove the block');
    // Nor does a fallback ADD one: off a Mac it is the region setting, not the language the person reads (review 3).
    pl.tellAgent('eve', board.roster, { tag: 'pt-BR', sure: false });
    assert.equal(fileOf('eve'), original, 'a fallback read added a block');
  } finally { board.restore(); }
  // Which reads are sure: the override and the Mac's defaults; Node's locale is not.
  assert.equal(pl.read({ env: { AGENT_WORKFORCE_PERSON_LOCALE: 'es' }, platform: 'linux' }).sure, true);
  assert.equal(pl.read({ env: {}, platform: 'darwin', run: () => '(\n    "es-MX"\n)\n' }).sure, true);
  assert.equal(pl.read({ env: {}, platform: 'darwin', run: () => { throw new Error('timed out'); }, intl: 'en-US' }).sure, false);
  assert.equal(pl.read({ env: {}, platform: 'win32', intl: 'es-ES' }).sure, false);
});

test('#5050 review 2: a sure read never vouches for an agent (the sweep still refuses a stranger)', () => {
  agentFile('stray', '# Stray\n\nSomebody else\'s session with a long enough file.\n');
  const board = fleet.install([fleet.stranger('stray')]);
  try {
    const out = pl.tellAgent('stray', board.roster, { tag: 'es-MX', sure: true });
    assert.equal(out.state, projects.TOLD.COULD_NOT, 'a sure language read skipped the agent guard');
    assert.doesNotMatch(fileOf('stray'), /reads Spanish/);
  } finally { board.restore(); }
});

test('#5050 review 3: only a sure read is kept for the process; a fallback is read again', () => {
  // A Mac whose defaults read fails (a busy boot), then answers.
  let macAnswer = null;
  const src = { env: {}, platform: 'darwin', intl: 'en-US', run: () => { if (!macAnswer) throw new Error('timed out'); return macAnswer; } };
  try {
    pl._resetForTests(src);
    assert.deepEqual(pl.read(), { tag: 'en-US', sure: false }, 'CONTROL: the first read is the fallback');
    macAnswer = '(\n    "es-MX"\n)\n';
    assert.deepEqual(pl.read(), { tag: 'es-MX', sure: true }, 'a fallback read was kept, so the Mac answering later was ignored');
    macAnswer = '(\n    "ja-JP"\n)\n';
    assert.deepEqual(pl.read(), { tag: 'es-MX', sure: true }, 'a sure read was not kept for the process');
  } finally { pl._resetForTests(); }
});
