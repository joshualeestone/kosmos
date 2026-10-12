'use strict';
/**
 * kosmos#5883 slice 3: engine/backupagy.js stages Antigravity conversations for the company backup. A real agy home in
 * a sandbox: conversation_summaries.db with workspace URIs, and conversation databases in WAL mode, as agy keeps them.
 *   node --test engine/backupagy.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const agy = require('./backupagy');

function home() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agy-')));
  const h = path.join(base, 'antigravity-cli');
  fs.mkdirSync(path.join(h, 'conversations'), { recursive: true });
  const sums = new DatabaseSync(path.join(h, 'conversation_summaries.db'));
  sums.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, workspace_uris TEXT, title TEXT)');
  const add = (id, folders, rows = 3) => {
    sums.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run(id, JSON.stringify(folders.map((f) => pathToFileURL(f).href)), 'a title');
    const db = new DatabaseSync(path.join(h, 'conversations', `${id}.db`));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE steps (idx INTEGER, step_payload TEXT)');
    for (let i = 0; i < rows; i++) db.prepare('INSERT INTO steps VALUES (?, ?)').run(i, 'turn ' + i);
    db.close();
  };
  const mk = (...p) => { const d = path.join(base, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
  return { base, h, add, mk, sums, done: () => { sums.close(); fs.rmSync(base, { recursive: true, force: true }); } };
}

test('each agent gets only its own conversations, as consistent copies in the staging folder', async () => {
  const t = home();
  try {
    const ann = t.mk('workers', 'ann'), bob = t.mk('workers', 'bob');
    t.add('c-ann-1', [ann]); t.add('c-ann-2', [ann], 50); t.add('c-bob-1', [bob]); t.add('c-nobody', [t.mk('elsewhere')]);
    const stage = path.join(t.base, 'stage');
    const roots = await agy.stageAgy({ home: t.h, stageDir: stage, agents: [{ dir: ann, seg: 'ann' }, { dir: bob, seg: 'bob' }] });
    const by = Object.fromEntries(roots.map((r) => [r.name, r]));
    assert.deepEqual(Object.keys(by).sort(), ['sessions/ann/agy', 'sessions/bob/agy']);
    assert.deepEqual(by['sessions/ann/agy'].only, ['c-ann-1.db', 'c-ann-2.db']);
    assert.deepEqual(by['sessions/bob/agy'].only, ['c-bob-1.db']);
    assert.equal(fs.realpathSync(by['sessions/ann/agy'].path), fs.realpathSync(stage));
    assert.ok(!fs.existsSync(path.join(stage, 'c-nobody.db')), 'a conversation no agent owns was staged');
    // The staged copy is a whole, readable database with every row (not torn bytes).
    const copy = new DatabaseSync(path.join(stage, 'c-ann-2.db'), { readOnly: true });
    assert.equal(copy.prepare('SELECT count(*) AS n FROM steps').get().n, 50);
    copy.close();
    // The summaries db (every agent's titles) is never staged.
    assert.deepEqual(fs.readdirSync(stage).filter((f) => f.endsWith('.db')).sort(), ['c-ann-1.db', 'c-ann-2.db', 'c-bob-1.db']);
    agy.clearStage(stage);
    assert.equal(fs.existsSync(stage), false);
  } finally { t.done(); }
});

test('a conversation two agents claim is ONE staged file named by both; a linked database is never copied', async () => {
  const t = home();
  try {
    const ann = t.mk('workers', 'ann'), bob = t.mk('workers', 'bob');
    t.add('c-shared', [ann, bob]);
    t.add('c-linked', [ann]);
    const real = path.join(t.h, 'conversations', 'c-linked.db');
    fs.renameSync(real, path.join(t.base, 'outside.db'));
    fs.symlinkSync(path.join(t.base, 'outside.db'), real);
    const stage = path.join(t.base, 'stage');
    const roots = await agy.stageAgy({ home: t.h, stageDir: stage, agents: [{ dir: ann, seg: 'ann' }, { dir: bob, seg: 'bob' }] });
    const by = Object.fromEntries(roots.map((r) => [r.name, r.only]));
    assert.deepEqual(by, { 'sessions/ann/agy': ['c-shared.db'], 'sessions/bob/agy': ['c-shared.db'] });
    assert.ok(!fs.existsSync(path.join(stage, 'c-linked.db')), 'a linked conversation database was copied');
  } finally { t.done(); }
});

test('never throws: no home, no summaries db, a malformed row: nothing for it', async () => {
  const t = home();
  try {
    const ann = t.mk('workers', 'ann');
    assert.deepEqual(await agy.stageAgy({ home: path.join(t.base, 'nope'), stageDir: path.join(t.base, 's'), agents: [{ dir: ann, seg: 'ann' }] }), []);
    t.sums.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run('../escape', JSON.stringify([pathToFileURL(ann).href]), 'x');
    t.sums.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run('c-bad-json', 'not json', 'x');
    t.add('c-good', [ann]);
    const roots = await agy.stageAgy({ home: t.h, stageDir: path.join(t.base, 's2'), agents: [{ dir: ann, seg: 'ann' }] });
    assert.deepEqual(roots.map((r) => r.only), [['c-good.db']]);
  } finally { t.done(); }
});

test('a conversation being written (rows still in the WAL) is copied WHOLE: a raw copy of the .db would lose them', async () => {
  const t = home();
  let writer;
  try {
    const ann = t.mk('workers', 'ann');
    t.add('c-live', [ann], 5);
    // agy is mid-conversation: a writer holds the db open with automatic checkpoints off, so new rows sit in the WAL.
    writer = new DatabaseSync(path.join(t.h, 'conversations', 'c-live.db'));
    writer.exec('PRAGMA wal_autocheckpoint=0');
    for (let i = 5; i < 40; i++) writer.prepare('INSERT INTO steps VALUES (?, ?)').run(i, 'turn ' + i);
    const stage = path.join(t.base, 'stage');
    await agy.stageAgy({ home: t.h, stageDir: stage, agents: [{ dir: ann, seg: 'ann' }] });
    const copy = new DatabaseSync(path.join(stage, 'c-live.db'), { readOnly: true });
    assert.equal(copy.prepare('SELECT count(*) AS n FROM steps').get().n, 40, 'rows still in the WAL were lost');
    copy.close();
  } finally { try { if (writer) writer.close(); } catch { /* closed */ } t.done(); }
});

test('an id that walks out of conversations/ never stages that file (the summaries db holds every agent\'s titles)', async () => {
  const t = home();
  try {
    const ann = t.mk('workers', 'ann');
    t.sums.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run('../conversation_summaries', JSON.stringify([pathToFileURL(ann).href]), 'x');
    const stage = path.join(t.base, 'stage');
    const roots = await agy.stageAgy({ home: t.h, stageDir: stage, agents: [{ dir: ann, seg: 'ann' }] });
    assert.deepEqual(roots, []);
    assert.equal(fs.existsSync(stage) && fs.readdirSync(stage).length, false, 'something was staged');
  } finally { t.done(); }
});
