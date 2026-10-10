'use strict';

// #5080: the person's choice in Settings ("The language your agents write to you in"). Every root sandboxed BEFORE any
// require, the same rule personlanguage.test.js states, so the choice file is never the real one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-langpicker-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const pl = require('./personlanguage');

test.after(() => { pl._resetForTests(); fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
}
const fileOf = (name) => fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, name, 'CLAUDE.md'), 'utf8');
const clearChoice = () => fs.rmSync(pl.CHOICE_FILE, { force: true });
// The machine the no-argument read sees: no test override (the runners force en), so the choice is what decides.
const LINUX = { env: {}, platform: 'linux', intl: 'es-ES' };
const SPANISH_MAC = { env: {}, platform: 'darwin', run: () => '(\n    "es-MX"\n)\n' };

test('#5080: the choice file lives under the sandboxed data root, never the real one', () => {
  assert.ok(pl.CHOICE_FILE.startsWith(SANDBOX + path.sep), pl.CHOICE_FILE);
});

test('#5080: no file is Automatic, and Automatic reads exactly as before the picker', () => {
  clearChoice();
  assert.deepEqual(pl.readChoice(), { choice: 'auto', ok: true });
  pl._resetForTests(LINUX);
  assert.deepEqual(pl.read(), { tag: 'es-ES', sure: false, from: 'computer', auto: true }, 'off a Mac, Automatic is still not sure');
  pl._resetForTests(SPANISH_MAC);
  assert.deepEqual(pl.read(), { tag: 'es-MX', sure: true, from: 'computer' });
});

test('#5080: a choice is sure on every platform, and beats the Mac\'s setting', () => {
  clearChoice();
  pl._resetForTests(LINUX);
  assert.equal(pl.read().sure, false, 'CONTROL: before the choice, Linux is not sure');
  assert.deepEqual(pl.setChoice('pt-BR'), { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(pl.CHOICE_FILE, 'utf8')), { choice: 'pt-BR' });
  assert.deepEqual(pl.read(), { tag: 'pt-BR', sure: true, from: 'settings' }, 'setChoice did not drop the cached read');
  pl._resetForTests(SPANISH_MAC);
  pl.setChoice('en');
  assert.deepEqual(pl.read(), { tag: 'en', sure: true, from: 'settings' }, 'the Mac\'s Spanish beat the person\'s English');
  pl.setChoice('auto');
  assert.deepEqual(pl.read(), { tag: 'es-MX', sure: true, from: 'computer' }, 'Automatic did not go back to the Mac');
  clearChoice();
});

test('#5080: a sure Mac read that is cached gives way to a new choice at once', () => {
  clearChoice();
  pl._resetForTests(SPANISH_MAC);
  assert.equal(pl.read().tag, 'es-MX', 'CONTROL: the Mac read is cached for the process');
  pl.setChoice('en');
  assert.equal(pl.read().tag, 'en');
  clearChoice();
});

test('#5080: only the list is accepted, and a refused choice leaves the file as it was', () => {
  clearChoice();
  pl.setChoice('es-419');
  const before = fs.readFileSync(pl.CHOICE_FILE, 'utf8');
  for (const bad of ['fr', 'es', 'EN', '', null, undefined, 42, { tag: 'en' }, 'auto ']) {
    const r = pl.setChoice(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.because, 'that is not one of the languages Kosmos offers');
  }
  assert.equal(fs.readFileSync(pl.CHOICE_FILE, 'utf8'), before);
  assert.deepEqual(pl.CHOICES.map((c) => c.tag), ['en', 'es-419', 'pt-BR']);
  clearChoice();
});

test('#5080: a choice file that cannot be read changes nothing, never falls back to Automatic', () => {
  const original = '# Ana\n\nYou are Ana, who keeps the calendar for the person.\n';
  agentFile('ana', original);
  const board = fleet.install([fleet.agent('ana')]);
  try {
    pl._resetForTests(SPANISH_MAC);
    for (const raw of ['{not json', '[]', '{"choice":"fr"}', '{"choice":null}', '"en"']) {
      fs.mkdirSync(path.dirname(pl.CHOICE_FILE), { recursive: true });
      fs.writeFileSync(pl.CHOICE_FILE, raw);
      pl._resetForTests(SPANISH_MAC);
      assert.deepEqual(pl.readChoice(), { choice: null, ok: false }, raw);
      assert.equal(pl.read().sure, false, raw + ': read as sure');
      pl.syncEveryone(board.roster);
      // Automatic on this Spanish Mac would have ADDED a block: the unreadable choice must not.
      assert.equal(fileOf('ana'), original, raw + ': an unreadable choice changed an agent');
    }
    clearChoice();
    pl._resetForTests(SPANISH_MAC);
    pl.syncEveryone(board.roster);
    assert.match(fileOf('ana'), /reads Spanish \(es-MX, from this computer's language setting\)/, 'CONTROL: Automatic adds it');
  } finally { board.restore(); clearChoice(); }
});

test('#5080: English in Settings is the opt-out (it removes the block); a language there writes its own source', () => {
  const original = '# Bo\n\nYou are Bo, who answers the shop\'s email for the person.\n';
  agentFile('bo', original);
  const board = fleet.install([fleet.agent('bo')]);
  try {
    clearChoice();
    pl._resetForTests(SPANISH_MAC);
    pl.syncEveryone(board.roster);
    assert.match(fileOf('bo'), /reads Spanish/, 'CONTROL: the Mac\'s Spanish wrote the block');
    pl.setChoice('en');
    const told = pl.syncEveryone(board.roster);
    assert.equal(fileOf('bo'), original, 'English in Settings did not remove the block');
    assert.equal(told[0].removed, true);
    pl._resetForTests(LINUX);
    pl.setChoice('es-419');
    pl.syncEveryone(board.roster);
    assert.match(fileOf('bo'), /reads Spanish \(es-419, chosen in Kosmos Settings\)\. Write to them/, 'a choice on Linux wrote nothing');
  } finally { board.restore(); clearChoice(); }
});

test('#5080: only the bracketed source differs; the computer\'s wording is byte-identical to before', () => {
  assert.equal(pl.blockBody('es-MX', 'computer'), pl.blockBody('es-MX'));
  const a = pl.blockBody('es-419');
  const b = pl.blockBody('es-419', 'settings');
  assert.equal(b, a.replace('(es-419, from this computer\'s language setting)', '(es-419, chosen in Kosmos Settings)'));
  assert.notEqual(a, b, 'CONTROL: the two differ at all');
  assert.equal(pl.blockBody('en', 'settings'), null);
});

test('#5080 review 1: Automatic after a choice, on a computer it cannot read, takes the chosen block out', () => {
  const original = '# Cy\n\nYou are Cy, who drafts the newsletter for the person.\n';
  agentFile('cy', original);
  const board = fleet.install([fleet.agent('cy')]);
  try {
    clearChoice();
    pl._resetForTests(LINUX);
    pl.setChoice('es-419');
    pl.syncEveryone(board.roster);
    assert.match(fileOf('cy'), /chosen in Kosmos Settings/, 'CONTROL: the choice wrote its block');
    pl.setChoice('auto');
    const told = pl.syncEveryone(board.roster);
    assert.equal(fileOf('cy'), original, 'Automatic left the old choice in place while the page says English');
    assert.equal(told[0].changed, true);
    // A block the computer's own setting wrote is not touched by an unsure Automatic, as before the picker.
    pl.tellAgent('cy', board.roster, { tag: 'es-MX', sure: true, from: 'computer' });
    const computerBlock = fileOf('cy');
    pl.syncEveryone(board.roster);
    assert.equal(fileOf('cy'), computerBlock, 'an unsure Automatic removed a block the computer\'s setting wrote');
    // And an unreadable choice still changes nothing, even over a Settings block.
    pl.setChoice('pt-BR');
    pl.syncEveryone(board.roster);
    const ptBlock = fileOf('cy');
    fs.writeFileSync(pl.CHOICE_FILE, '{broken');
    pl._resetForTests(LINUX);
    pl.syncEveryone(board.roster);
    assert.equal(fileOf('cy'), ptBlock, 'an unreadable choice removed a Settings block');
  } finally { board.restore(); clearChoice(); }
});

test('#5080 review 1: what Automatic reads is kept, so opening Settings does not ask `defaults` every time', () => {
  clearChoice();
  let calls = 0;
  pl._resetForTests({ env: {}, platform: 'darwin', intl: 'en-US', run: () => { calls += 1; return '(\n    "pt-BR"\n)\n'; } });
  assert.equal(pl.automatic().tag, 'pt-BR');
  pl.automatic(); pl.automatic();
  assert.equal(calls, 1, 'defaults was asked again for a sure Automatic read');
  // A failed read is asked again only after the window, as read() does.
  calls = 0;
  pl._resetForTests({ env: {}, platform: 'darwin', intl: 'en-US', run: () => { calls += 1; throw new Error('timed out'); } });
  pl.automatic(); pl.automatic();
  assert.equal(calls, 1, 'a failed defaults was asked again inside the window');
  pl._ageFallbackForTests();
  pl.automatic();
  assert.equal(calls, 2, 'CONTROL: it is asked again once the window passes');
  pl._resetForTests();
});

test('#5080 review 1: the edit history names Settings as the reason when the choice wrote it', () => {
  const instructions = require('./instructions');
  agentFile('dee', '# Dee\n\nYou are Dee, who sorts the receipts for the person.\n');
  const board = fleet.install([fleet.agent('dee')]);
  const file = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'dee', 'CLAUDE.md');
  try {
    clearChoice();
    pl._resetForTests(LINUX);
    pl.setChoice('es-419');
    pl.syncEveryone(board.roster);
    assert.equal((instructions.wroteBy('dee', fs.statSync(file).mtimeMs) || {}).because, 'the language the person chose in Settings (#5080)');
    pl.tellAgent('dee', board.roster, { tag: 'pt-BR', sure: true, from: 'computer' });
    assert.equal((instructions.wroteBy('dee', fs.statSync(file).mtimeMs) || {}).because, 'the person\'s language, from this computer\'s language setting (#5050)', 'CONTROL: the computer\'s reason');
  } finally { board.restore(); clearChoice(); }
});

test('#5080 review 1: a new agent\'s step names Settings when English came from the choice', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const create = strip(fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8'));
  assert.match(create, /label: got\.from === 'settings' \? 'took out a language section from its instructions, because you chose English in Settings' : 'took out a language section from its instructions, because this computer\\'s language is English'/);
});

test('#5080 review 2: only the bracketed Settings source marks a block as ours to take out', () => {
  const head = '# Eli\n\nYou are Eli, who books the travel for the person and keeps the receipts.\n\n';
  const pasted = head + projects_block('## The person\'s language\n\nNotes: the phrase chosen in Kosmos Settings appears here in prose.');
  agentFile('eli', pasted);
  const board = fleet.install([fleet.agent('eli')]);
  try {
    clearChoice();
    pl._resetForTests(LINUX);
    pl.syncEveryone(board.roster);
    assert.equal(fileOf('eli'), pasted, 'a block that only mentions the phrase was removed');
    // CONTROL: the same file with the block a choice writes IS taken out, so the check above could fail.
    const ours = head + projects_block(pl.blockBody('es-419', 'settings'));
    agentFile('eli', ours);
    pl.syncEveryone(board.roster);
    assert.doesNotMatch(fileOf('eli'), /chosen in Kosmos Settings/, 'CONTROL: the block a choice wrote was not taken out');
  } finally { board.restore(); clearChoice(); }
});
function projects_block(body) { return pl.START + '\n' + body + '\n' + pl.END + '\n'; }

test('#5080 review 3: an unsure Automatic says nothing about a file it cannot use (no boot noise off a Mac)', () => {
  clearChoice();
  pl._resetForTests(LINUX);
  const two = '# Fay\n\nYou are Fay, who plans the week for the person and keeps the list.\n\n'
    + projects_block('## The person\'s language\n\nOne.') + '\n' + projects_block('## The person\'s language\n\nTwo.');
  agentFile('fay', two);
  const board = fleet.install([fleet.agent('fay')]);
  try {
    const out = pl.tellAgent('fay', board.roster);
    assert.equal(out.state, require('./projects').TOLD.TOLD, 'two blocks under an unsure Automatic reported a failure');
    assert.equal(out.changed, false);
    assert.equal(fileOf('fay'), two);
    // CONTROL: a sure read on the same file does report it, so the check above could fail.
    assert.equal(pl.tellAgent('fay', board.roster, { tag: 'es-MX', sure: true }).state, require('./projects').TOLD.COULD_NOT);
  } finally { board.restore(); }
});
