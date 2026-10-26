'use strict';

/**
 * kosmos#7248: at board start, Kosmos names any of its own JSON stores that a crash left empty, filled with NUL bytes
 * or unreadable, in board.log and on the person's screen (GET /api/board/damaged-files), offers the newest good copy
 * when one exists, and changes nothing by itself.
 *
 * The card's "done when": write an empty file and an all-NUL file in place of two stores, boot the board, see both
 * named in the board log and on the screen, and nothing else touched. Runs the REAL server as a child process, as
 * server.you-refresh-1071 does, because the boot path is behind `require.main === module`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const store = require('./engine/store');
const { stopBoard } = require('./test-support/board-child');

const REPO = __dirname;

function sandbox() {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-storecheck-7248-'));
  const root = path.join(sb, 'data', store.APP);
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(sb, 'workers'), { recursive: true });
  fs.writeFileSync(path.join(sb, 'panes.txt'), '');
  fs.writeFileSync(path.join(root, 'projects.json'), Buffer.alloc(64));          // all NUL, as a crash leaves it
  fs.writeFileSync(path.join(root, 'removed.json'), '');                         // empty
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ timezone: 'America/Chicago' }));   // CONTROL: good
  // A crash's leftover write that still reads: the good copy Kosmos can offer for projects.json.
  fs.writeFileSync(path.join(root, 'projects.json.kosmos-4242-1793000000000-1.tmp'), JSON.stringify({ projects: [{ id: 'kept', name: 'Kept' }] }));
  return { sb, root };
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

async function bootAndAsk(sb) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    const url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('the board did not start in 60 s:\n' + out + '\n' + err)), 60000);
      const look = () => {
        const m = /Kosmos on (http:\/\/[^\s]+)/.exec(out);
        if (m) { clearTimeout(t); resolve(m[1].replace(/\/$/, '')); }
      };
      child.stdout.on('data', look);
      child.on('exit', () => { clearTimeout(t); reject(new Error('the board exited before it started:\n' + out + '\n' + err)); });
    });
    const res = await fetch(url + '/api/board/damaged-files');
    const body = await res.json();
    return { status: res.status, body, log: out + err };
  } finally {
    await stopBoard(child);
  }
}

test('kosmos#7248: an empty and an all-NUL store are named in board.log and on the screen, and nothing is touched', async () => {
  const { sb, root } = sandbox();
  try {
    const before = snapshot(root);
    const got = await bootAndAsk(sb);

    // The board log names both, says what each holds, and that it left them.
    assert.match(got.log, /Kosmos found a damaged file at start: projects\.json is blank, as a crash can leave a file \(it holds your projects, their tasks and who is on them\)\. Kosmos left it as it is\./,
      'projects.json (all NUL) is not named in the board log:\n' + got.log);
    assert.match(got.log, /Kosmos found a damaged file at start: removed\.json is empty \(it holds the agents you removed\)\. Kosmos left it as it is\. No good copy of it was found\./,
      'removed.json (empty) is not named in the board log');
    assert.match(got.log, /projects\.json[^\n]*A good copy saved [^\n]* is at projects\.json\.recovered-/, 'the good copy is not offered in the log');
    assert.doesNotMatch(got.log, /damaged file at start: settings\.json/, 'CONTROL: a good store was named as damaged');
    // No absolute path in the lines it writes: the sandbox's own path is the one that would show (review 1).
    for (const line of got.log.split('\n').filter((l) => /damaged file at start|good copy/.test(l))) {
      assert.ok(!line.includes(sb) && !line.includes(fs.realpathSync(sb)), 'a path reached the board log: ' + line);
    }

    // The screen's route lists both, with the copy for projects.json.
    assert.equal(got.status, 200);
    const files = got.body.files.map((f) => f.file).sort();
    assert.deepEqual(files, ['projects.json', 'removed.json'], 'the screen does not list exactly the two damaged stores: ' + JSON.stringify(got.body));
    const proj = got.body.files.find((f) => f.file === 'projects.json');
    assert.equal(proj.problem, 'nul');
    assert.equal(proj.savedOver, false, 'a store nothing wrote is said to be saved over');
    assert.ok(proj.backup && /^projects\.json\.recovered-/.test(proj.backup.file), 'no good copy offered on the screen: ' + JSON.stringify(proj));
    assert.equal(got.body.files.find((f) => f.file === 'removed.json').backup, null);

    // Nothing that was there is changed; the only new file beside them is the kept copy. The crash's temp file is the
    // exception, by design: Kosmos's own write path deletes a dead writer's temp (engine/securewrite.js), which is why
    // the check keeps it first, so the kept copy must hold exactly its bytes.
    const after = snapshot(root);
    const TMP = 'projects.json.kosmos-4242-1793000000000-1.tmp';
    for (const [f, h] of Object.entries(before)) if (f !== TMP) assert.equal(after[f], h, f + ' was changed by the board start');
    const kept = Object.keys(after).find((f) => /^projects\.json\.recovered-/.test(f));
    assert.equal(after[kept], before[TMP], 'the kept copy is not the crash\'s good write, byte for byte');
    const added = Object.keys(after).filter((f) => !(f in before) && /^(projects|removed|settings)\.json/.test(f));
    assert.deepEqual(added.map((f) => f.replace(/recovered-.*$/, 'recovered-*')), ['projects.json.recovered-*'],
      'something other than the kept good copy appeared beside the stores: ' + JSON.stringify(added));
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
});

test('kosmos#7248: putting the good copy back happens only on request, and keeps the damaged file aside', () => {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-storecheck-7248-unit-'));
  const prev = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = path.join(sb, 'data');
  try {
    const root = store.ROOT;
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'projects.json'), Buffer.alloc(16));
    fs.writeFileSync(path.join(root, 'projects.json.bak'), JSON.stringify({ projects: [] }));
    delete require.cache[require.resolve('./engine/storecheck')];
    const sc = require('./engine/storecheck');
    const lines = [];
    sc.atStart({}, (l) => lines.push(l));
    assert.equal(fs.readFileSync(path.join(root, 'projects.json')).every((b) => b === 0), true, 'the check itself changed the store');
    assert.equal(sc.current().length, 1);
    assert.deepEqual(sc.restore('settings.json', () => {}), { ok: false, why: 'that file is not one Kosmos found damaged' });
    fs.chmodSync(path.join(root, 'projects.json'), 0o600);
    const r = sc.restore('projects.json', (l) => lines.push(l));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8')), { projects: [] });
    const aside = fs.readdirSync(root).filter((n) => n.startsWith('projects.json.damaged-'));
    assert.equal(aside.length, 1, 'the damaged file was not kept aside');
    assert.equal(fs.readFileSync(path.join(root, aside[0])).every((b) => b === 0), true);
    assert.equal(fs.statSync(path.join(root, aside[0])).mode & 0o777, 0o600, 'the kept-aside copy is not as private as the store');
    assert.equal(sc.current().length, 0, 'a store that was put back is still listed');
    // Review 2: a store saved over since start is never replaced by an older copy; the reply says where the copy is.
    fs.writeFileSync(path.join(root, 'removed.json'), '');
    fs.writeFileSync(path.join(root, 'removed.json.bak'), '[]');
    delete require.cache[require.resolve('./engine/storecheck')];
    const sc2 = require('./engine/storecheck');
    sc2.atStart({}, () => {});
    fs.writeFileSync(path.join(root, 'removed.json'), JSON.stringify(['newer']));
    assert.equal(sc2.current()[0].savedOver, true, 'a store saved over since start is not said to be');
    const refused = sc2.restore('removed.json', () => {});
    assert.equal(refused.ok, false);
    assert.match(refused.why, /saved since Kosmos started, so Kosmos left it; the copy is kept at removed\.json\.bak/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'removed.json'), 'utf8')), ['newer'], 'newer data was replaced');
    // CONTROL: classify tells the three kinds and a good value apart.
    assert.deepEqual([sc.classify(Buffer.from('')), sc.classify(Buffer.alloc(3)), sc.classify(Buffer.from('{ no')), sc.classify(Buffer.from('[]'))], ['empty', 'nul', 'unreadable', null]);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = prev;
    fs.rmSync(sb, { recursive: true, force: true });
  }
});

test('kosmos#7248: the check is the FIRST thing the board does at start, before anything reads or writes a store', () => {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const at = src.indexOf("if (require.main === module) {\n  /* kosmos#7248");
  assert.notEqual(at, -1, 'the start block does not open with the kosmos#7248 check');
  const block = src.slice(at);   // the start block runs to the end of the file
  const first = block.indexOf("require('./engine/storecheck').atStart(");
  assert.ok(first > 0 && first < 1200, 'storecheck.atStart is not at the top of the start block');
  // The start writers that come after it are really there, and really after it (review 2: the old loop found none).
  for (const later of ['communityswitch.migrate(', 'wireDefaultHooks', 'installSupervisor(', 'syncEveryone(']) {
    const i = block.indexOf(later);
    assert.ok(i > first, later + ' was not found after the store check in the start block');
  }
});

test('kosmos#7248: a store holding a secret is named, with no copy kept or offered', () => {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-storecheck-7248-secret-'));
  const prev = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = path.join(sb, 'data');
  try {
    const root = store.ROOT;
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'service-keys.json'), '');
    fs.mkdirSync(path.join(root, 'webhooks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'webhooks', 'webhooks.json'), '');
    fs.writeFileSync(path.join(root, 'webhooks', 'webhooks.json.bak'), '[]');
    fs.writeFileSync(path.join(root, 'service-keys.json.kosmos-4242-1793000000000-1.tmp'), JSON.stringify({ k: 'secret' }));
    delete require.cache[require.resolve('./engine/storecheck')];
    const sc = require('./engine/storecheck');
    const lines = [];
    sc.atStart({}, (l) => lines.push(l));
    const d = sc.current().find((x) => x.file === 'service-keys.json');
    assert.ok(d, 'service-keys.json not named');
    assert.equal(sc.current().find((x) => x.file === path.join('webhooks', 'webhooks.json')).backup, null, 'an older webhooks copy was offered (review 2)');
    assert.equal(d.backup, null, 'a copy of a secret was offered');
    assert.equal(d.secret, true);
    assert.equal(fs.readdirSync(root).some((n) => n.includes('.recovered-')), false, 'a copy of a secret was kept');
    assert.match(lines.join('\n'), /It holds a key or something you can take back, so Kosmos keeps no copy of it to put back\./);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = prev;
    fs.rmSync(sb, { recursive: true, force: true });
  }
});
