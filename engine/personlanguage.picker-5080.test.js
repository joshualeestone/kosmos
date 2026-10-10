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
  assert.deepEqual(pl.read(), { tag: 'es-ES', sure: false, from: 'computer' }, 'off a Mac, Automatic is still not sure');
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
