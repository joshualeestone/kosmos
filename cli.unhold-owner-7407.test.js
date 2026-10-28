'use strict';

/**
 * #7407: taking a task off hold keeps whoever is on it, and the answer says who has it now (or that the next idle agent
 * will get it, and how to choose), from both commands (Mac install/kosmos, Windows tools/windows/kosmos-cli.js), against a
 * real board and the real task engine.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.unhold-owner-7407.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdowner-cli-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const taskchat = require('./engine/taskchat');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');
const assigner = require('./engine/assigner');
const assignerSetting = require('./engine/assigner-setting');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Unhold' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));   // kai is NOT on it
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const taskOf = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n);
const isDone = (n) => tasks.progressOf(taskOf(n)).closed;
const token = (name) => sendertoken.mint(name).token;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, text: out.concat(err).join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '', port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];

const make = (label, who, made) => tasks.create(projectId, { sentence: 'Unhold ' + label, ...(who ? { who } : {}), ...(made ? { made } : {}) }).number;
const holdThenUnhold = async (run, n) => {
  const h = await run(['task', 'hold', projectId, String(n)], token('mara'));
  assert.equal(h.code, 0, h.text);
  assert.doesNotMatch(h.text, /stays with|Nobody is on it/, 'a hold says nothing about who gets it: ' + h.text);
  return run(['task', 'unhold', projectId, String(n)], token('mara'));
};

test('#7407: a task taken off hold keeps whoever was on it, and both commands say so', async () => {
  for (const [label, run] of BOTH) {
    const n = make('kept ' + label, 'otto');
    const r = await holdThenUnhold(run, n);
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /^\s*It stays with otto\.$/m, label + ': ' + r.text);
    assert.doesNotMatch(r.text, /kosmos task assign/, label + ': no assign command when someone has it');
    assert.deepEqual(tasks.whoOf(taskOf(n)), ['otto'], label + ': the owner changed');
    assert.equal(assigner.handOutable(taskOf(n)), false, label + ': the Assigner could hand it to someone else');
  }
});

test('#7407: a task nobody is on says the next idle agent will get it, and how to choose', async () => {
  for (const [label, run] of BOTH) {
    const n = make('nobody ' + label);
    const r = await holdThenUnhold(run, n);
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /^\s*Nobody is on it, so Kosmos will give it to a free agent on the project in its turn \(soonest due first, then oldest\)\. To choose who, assign it now\.$/m, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*kosmos task assign ' + projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ' + n + ' <agent>$', 'm'), label + ': ' + r.text);
    // Review 1: CONTROL against the Assigner itself, not the function the sentence reads: pick gives it out.
    const p = projects.readAll().find((x) => x.id === projectId);
    const only = { ...p, tasks: [taskOf(n)] };
    assert.equal((assigner.pick('mara', [only], new Set()) || {}).n, n, label + ': pick hands it to an idle agent');
  }
});

test('#7407: with the Assigner off, or a task it never hands out, the answer does not promise a hand-out', async () => {
  for (const [label, run] of BOTH) {
    const w = make('webhook ' + label, null, { via: 'webhook', by: 'hook' });
    const rw = await holdThenUnhold(run, w);
    assert.match(rw.text, /Nobody is on it, and Kosmos does not hand this one out on its own\. To choose who, assign it now\./, label + ': ' + rw.text);
    assert.match(rw.text, /kosmos task assign /, label + ': assigning is the only way it moves, so the command is shown');
    assert.equal(assigner.handOutable(taskOf(w)), false, label);
    assignerSetting.setOn(false);
    try {
      const n = make('off ' + label);
      const r = await holdThenUnhold(run, n);
      assert.match(r.text, /Nobody is on it, and the Assigner is off, so it waits for a person\. To choose who, assign it now\./, label + ': ' + r.text);
    } finally {
      assignerSetting.setOn(true);
    }
  }
});

test('#7407: the route answers next only when a task comes off hold', async () => {
  const n = make('route', 'otto');
  const hold = await (await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/hold`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":true}' })).json();
  assert.equal('next' in hold, false);
  const off = await (await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/hold`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":false}' })).json();
  assert.equal(off.next, 'It stays with otto.');
});

const unholdNext = async (n) => {
  const url = `${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/hold`;
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":true}' });
  return (await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":false}' })).json()).next;
};
const projectNow = () => projects.readAll().find((x) => x.id === projectId);

test('#7407 review 1: someone who finished a part does not have the task; nobody on its open parts is said, and the Assigner agrees', async () => {
  const n = make('finished part', 'otto');
  const second = tasks.addPart(projectId, n, { sentence: 'the rest' });
  const first = tasks.progressOf(taskOf(n)).parts.find((x) => x.who === 'otto');
  tasks.setPartClosed(projectId, n, first.id, new Date().toISOString());
  assert.ok(second, 'setup: a second part');
  const next = await unholdNext(n);
  assert.doesNotMatch(next, /stays with otto/, next);
  assert.match(next, /^Nobody is on its open parts, and Kosmos does not hand out a task someone has worked on\. To choose who, assign it now\.$/, next);
  assert.equal(assigner.pick('mara', [{ ...projectNow(), tasks: [taskOf(n)] }], new Set()), null, 'CONTROL: pick does not hand it out either');
});

test('#7407 review 1: no agent that takes work here, a paused project, or a parent whose subtasks go first: no hand-out is promised', async () => {
  // Every agent on the project has swarm work switched off.
  projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['mara', 'otto'] }));
  try {
    const n = make('swarm off');
    const next = await unholdNext(n);
    assert.match(next, /^Nobody is on it, and no agent on the project can be given it now .*To choose who, assign it now\.$/, next);
    assert.equal(assigner.pick('mara', [{ ...projectNow(), tasks: [taskOf(n)] }], new Set()), null, 'CONTROL: pick agrees');
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
  }
  // A parent with an open subtask that will move: the subtask goes first.
  const parent = make('parent');
  const child = make('child');
  tasks.setParent(projectId, child, parent);
  const pn = await unholdNext(parent);
  // Review 6: subtasks first resolves on its own, and is said so.
  assert.match(pn, /^Nobody is on it\. Its open subtasks go first; once they are done, Kosmos can give it to a free agent here in its turn \(soonest due first, then oldest\)\. To choose who, assign it now\.$/, pn);
  assert.equal(assigner.subtasksFirst(projectNow(), taskOf(parent)), true, 'CONTROL: the Assigner holds it back for its subtask');
  // Paused: said as paused, with what happens on resume.
  const paused = make('paused');
  projects.mutate(projectId, (p) => ({ ...p, paused: true }));
  try {
    if (projects.isPaused(projectNow())) {
      const next = await unholdNext(paused);
      assert.match(next, /^Nobody is on it\. The project is paused; when it is resumed, Kosmos will give it to a free agent on the project in its turn \(soonest due first, then oldest\)\. To choose who, assign it now\.$/, next);
    } else {
      assert.fail('setup: could not pause the project with paused: true; find the field projects.isPaused reads');
    }
  } finally {
    projects.mutate(projectId, (p) => { const q = { ...p }; delete q.paused; return q; });
  }
});

test('#7407 review 1: with failover on, "stays with" says a limited holder\'s part may move', async () => {
  const n = make('failover', 'otto');
  const was = assignerSetting.read();
  assignerSetting.setFailover && assignerSetting.setFailover(true);
  try {
    if (assignerSetting.read().failover !== true) assert.fail('setup: could not switch failover on');
    const next = await unholdNext(n);
    assert.match(next, /^It stays with otto\. If they hit a usage limit, Kosmos may move it to an idle agent\.$/, next);
  } finally {
    assignerSetting.setFailover && assignerSetting.setFailover(was.failover === true);
  }
});

test('#7407 review 2: one agent, a subset, archived, a paused project nobody could take, a running-roster check, and failover only where it moves work', async () => {
  // One agent: otto is swarm-off, so only mara can be given it.
  projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['otto'] }));
  try {
    const n = make('one');
    const next = await unholdNext(n);
    assert.match(next, /^Nobody is on it, so Kosmos will give it to mara when they are free, in its turn \(soonest due first, then oldest\)\. To choose who, assign it now\.$/, next);
    assert.equal((assigner.pick('mara', [{ ...projectNow(), tasks: [taskOf(n)] }], new Set()) || {}).n, n, 'CONTROL: pick gives mara it');
    assert.equal(assigner.pick('otto', [{ ...projectNow(), tasks: [taskOf(n)] }], new Set()), null, 'CONTROL: and never otto');
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
  }
  // A member this board does not run (no roster card) is never promised the task.
  projects.mutate(projectId, (p) => ({ ...p, agents: [...p.agents, 'ghost'], swarmOff: ['mara', 'otto'] }));
  try {
    const n = make('ghost');
    const next = await unholdNext(n);
    assert.doesNotMatch(next, /ghost/, next);
    assert.match(next, /^Nobody is on it, and no agent on the project can be given it now/, next);
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, agents: p.agents.filter((a) => a !== 'ghost'), swarmOff: [] }));
  }
  // Paused, and nobody could take it even resumed.
  projects.mutate(projectId, (p) => ({ ...p, paused: true, swarmOff: ['mara', 'otto'] }));
  try {
    const n = make('paused-none');
    const next = await unholdNext(n);
    assert.match(next, /^Nobody is on it, and the project is paused\. Even resumed, no agent on the project can be given it now/, next);
  } finally {
    projects.mutate(projectId, (p) => { const q = { ...p, swarmOff: [] }; delete q.paused; return q; });
  }
  // Failover never moves a part of a task marked built: no caveat, though failover is on.
  const was = assignerSetting.read();
  assignerSetting.setFailover(true);
  try {
    const w = make('built-held', 'otto');
    projects.mutate(projectId, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === w ? { ...t, builtAt: new Date().toISOString() } : t)) }));
    const next = await unholdNext(w);
    assert.equal(next, 'It stays with otto.', next);
    assert.equal(assigner.stallable(taskOf(w)), false, 'CONTROL: stalledParts skips it');
  } finally {
    assignerSetting.setFailover(was.failover === true);
  }
  // A holder beside a part nobody is on: the loose part is said.
  const m = make('loose', 'otto');
  tasks.addPart(projectId, m, { sentence: 'the rest' });
  assert.match(await unholdNext(m), /^It stays with otto\. Its part nobody is on waits for a person to assign it\.$/);
});

test('#7407 review 3: a subset, archived, a sole holder, and the nobody-can-take-it words through both commands', async () => {
  // A subset: kai joins, otto is switched off, so mara and kai of the three can take it.
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto', 'kai'], swarmOff: ['otto'] }));
  try {
    const n = make('subset');
    assert.match(await unholdNext(n), /^Nobody is on it, so Kosmos will give it to whichever of mara, kai is free first, in its turn \(soonest due first, then oldest\)\. To choose who, assign it now\.$/);
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'], swarmOff: [] }));
  }
  // Failover on: an archived project, or a holder nobody else could relieve, gets no caveat; CONTROL: a live one does.
  const was = assignerSetting.read();
  assignerSetting.setFailover(true);
  try {
    const live = make('caveat-control', 'otto');
    assert.match(await unholdNext(live), /If they hit a usage limit, Kosmos may move it/, 'CONTROL: mara could take it');
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['mara'] }));
    try {
      const sole = make('sole holder', 'otto');
      assert.equal(await unholdNext(sole), 'It stays with otto.', 'nobody else here could take it');
    } finally {
      projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
    }
    const arch = make('archived', 'otto');
    projects.mutate(projectId, (p) => ({ ...p, archived: true }));
    try {
      assert.equal(await unholdNext(arch), 'It stays with otto.', 'failover never looks at an archived project');
      const none = make('archived nobody');
      assert.match(await unholdNext(none), /^Nobody is on it, and the project is archived, so Kosmos will not give it to anyone\. To choose who, assign it now\.$/);
    } finally {
      projects.mutate(projectId, (p) => { const q = { ...p }; delete q.archived; return q; });
    }
  } finally {
    assignerSetting.setFailover(was.failover === true);
  }
  // The nobody-can-take-it words (an apostrophe in them) arrive whole through both commands.
  projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['mara', 'otto'] }));
  try {
    for (const [label, run] of BOTH) {
      const n = make('none ' + label);
      const r = await holdThenUnhold(run, n);
      assert.equal(r.code, 0, label + ': ' + r.text);
      assert.match(r.text, /Nobody is on it, and no agent on the project can be given it now \(no running agent here takes work\)\. To choose who, assign it now\./, label + ': ' + r.text);
      assert.match(r.text, /^\s*kosmos task assign /m, label);
    }
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
  }
});

test('#7407 review 4: a subtask of a tree someone holds is said as waiting on their work, and pick agrees both ways', async () => {
  const parent = make('tree parent', 'mara');
  const child = make('tree child');
  tasks.setParent(projectId, child, parent);
  const next = await unholdNext(child);
  assert.doesNotMatch(next, /give it to mara/, next);
  assert.match(next, new RegExp("^Nobody is on it\\. It is part of work mara is doing on task " + parent + "'s tree \\(one builder per task tree\\), so Kosmos will not give it out until they are done there\\. To choose who, assign it now\\.$"), next);
  // CONTROL against pick: while mara holds the tree, otto is not given the subtask...
  const scope = () => ({ ...projectNow(), tasks: [taskOf(parent), taskOf(child)] });
  assert.notEqual((assigner.pick('otto', [scope()], new Set()) || {}).n, child, 'otto is not given a subtask of mara\'s tree');
  // ...and once mara's part closes, the tree is open and otto is.
  const part = tasks.progressOf(taskOf(parent)).parts.find((x) => x.who === 'mara');
  tasks.setPartClosed(projectId, parent, part.id, new Date().toISOString());
  assert.equal((assigner.pick('otto', [scope()], new Set()) || {}).n, child, 'once mara is done there, anyone may be given it');
});

test('#7407 review 5: with failover on, two holders on one task get no caveat (a part stays inside its tree), and a root task names its subtasks', async () => {
  const was = assignerSetting.read();
  assignerSetting.setFailover(true);
  try {
    projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto', 'kai'] }));
    const n = make('two holders', 'otto');
    tasks.addPart(projectId, n, { sentence: 'her half', who: 'mara' });
    assert.equal(await unholdNext(n), 'It stays with otto, mara.', 'failover never moves a part out of a tree another builder holds');
    // CONTROL: one holder, someone else free to take it: the caveat stands.
    const one = make('one holder', 'otto');
    assert.match(await unholdNext(one), /^It stays with otto\. If they hit a usage limit, Kosmos may move it to an idle agent\.$/);
  } finally {
    assignerSetting.setFailover(was.failover === true);
    projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
  }
  // A root task nobody is on, whose subtask mara is busy on.
  const root = make('root');
  const sub = make('sub', 'mara');
  tasks.setParent(projectId, sub, root);
  assert.match(await unholdNext(root), /^Nobody is on it\. It is part of work mara is doing on its subtasks \(one builder per task tree\)/);
});

test('#7407 review 6: the unhold answer reads the roster (a snapshot of every pane) only where a sentence needs it', () => {
  const { unholdNext } = require('./server');
  let reads = 0;
  const rosterOf = () => { reads += 1; return []; };
  assignerSetting.setOn(false);
  try {
    const n = make('no roster');
    assert.match(unholdNext(projectId, taskOf(n), rosterOf), /the Assigner is off/);
    assert.equal(reads, 0, 'the Assigner is off: no roster read');
  } finally {
    assignerSetting.setOn(true);
  }
  const k = make('kept no roster', 'otto');
  assert.equal(unholdNext(projectId, taskOf(k), rosterOf), 'It stays with otto.');
  assert.equal(reads, 0, 'failover off: no roster read for a kept task');
  // CONTROL: a task nobody is on asks who is running here, once.
  const m = make('needs roster');
  unholdNext(projectId, taskOf(m), rosterOf);
  assert.equal(reads, 1, 'read once where needed');
});

test('#7407 review 7: subtasks-first and a held tree promise nothing when nobody else here could take it', async () => {
  // Everyone switched off: a parent with an open child does not promise a hand-out after its subtasks.
  const parent = make('p-off');
  const child = make('c-off');
  tasks.setParent(projectId, child, parent);
  projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['mara', 'otto'] }));
  try {
    const pn = await unholdNext(parent);
    assert.doesNotMatch(pn, /once they are done, Kosmos can give it/, pn);
    assert.match(pn, /^Nobody is on it, and no agent on the project can be given it now/, pn);
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
  }
  // A tree mara holds, with otto switched off: only mara can be given it.
  const tp = make('held-only', 'mara');
  const tc = make('held-only-child');
  tasks.setParent(projectId, tc, tp);
  projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['otto'] }));
  try {
    const next = await unholdNext(tc);
    assert.match(next, /\(one builder per task tree\), so only they can be given it, when they are free\. To choose who, assign it now\.$/, next);
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
  }
  // CONTROL: otto switched on again, the held tree says it waits until mara is done there.
  assert.match(await unholdNext(tc), /so Kosmos will not give it out until they are done there\./);
});

test('#7430: the unhold sentence names an agent by its name, as Who is on it does, and still reads no roster for a kept task', () => {
  const { unholdNext } = require('./server');
  const dir = path.join(fleet.workersRoot(), 'otto');
  const file = path.join(dir, 'CLAUDE.md');
  const had = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const madeDir = !fs.existsSync(dir);
  let reads = 0;
  const rosterOf = () => { reads += 1; return []; };
  const k = make('kept, named', 'otto');
  // CONTROL: with no identity, the machine name (the fallback, and what every other test here reads).
  assert.equal(unholdNext(projectId, taskOf(k), rosterOf), 'It stays with otto.');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, 'You are **Otto Brandt**, a builder.\n');
  try {
    assert.equal(unholdNext(projectId, taskOf(k), rosterOf), 'It stays with Otto Brandt.');
    assert.equal(reads, 0, 'naming reads the identity file, never the roster (review 6)');
    // Review 3: a typed name is cleaned like any typed text the CLIs print (a line separator, a run of spaces).
    fs.writeFileSync(file, 'You are **Otto\u2028  Brandt**, a builder.\n');
    assert.equal(unholdNext(projectId, taskOf(k), rosterOf), 'It stays with Otto Brandt.');
    fs.writeFileSync(file, 'You are **Otto Brandt**, a builder.\n');
    // Review 1: the tree sentence names its builder the same way.
    const root = make('named root');
    const sub = make('named sub', 'otto');
    tasks.setParent(projectId, sub, root);
    assert.match(unholdNext(projectId, taskOf(root), () => null), /^Nobody is on it\. It is part of work Otto Brandt is doing on its subtasks/);
  } finally {
    if (had === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, had);
    if (madeDir) fs.rmSync(dir, { recursive: true, force: true });   // review 7: leave no folder behind
  }
});

test('#7430 review 5: the page turns the route\'s closing ask into Choose who by its exact words, so the two copies stay one', () => {
  const { unholdNext } = require('./server');
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = /const TK_HOLD_ASSIGN = '([^']+)';/.exec(page);
  assert.ok(m, 'web/index.html declares TK_HOLD_ASSIGN');
  assignerSetting.setOn(false);
  try {
    const n = make('the ask');
    const next = unholdNext(projectId, taskOf(n), () => null);
    assert.match(next, /assign it now\.$/, 'CONTROL: this sentence is one that asks: ' + next);
    assert.ok(next.endsWith(m[1]), 'the route ends with the page\'s TK_HOLD_ASSIGN: ' + JSON.stringify([next, m[1]]));
  } finally {
    assignerSetting.setOn(true);
  }
});
