'use strict';
/**
 * kosmos#8601 (the first half of #8466, measured on the Windows box 11-16): after a model change the card named the OLD
 * model until the agent's next turn. The change rewrites the job and restarts the agent; Claude Code writes the new
 * session's file only at its first reply, so the newest transcript is the OLD session naming the OLD model, and
 * readModel returned it as current. Now a transcript last written before the job was is read as an earlier reading
 * (the #6716 shape): `model` stays null and the card shows the job's planned model.
 *
 * The job file is the platform's own (plist, systemd unit, Scheduled Task file); the tests point the platform's lookup
 * at a file in the sandbox, so the same assertions hold on every platform.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cardmodel-8601-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'config');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');

const create = require('./create');
const status = require('./status');
const JOBS = path.join(SB, 'jobs');
fs.mkdirSync(JOBS, { recursive: true });

/* The platform's job-file lookup, pointed at the sandbox for the whole file and put back after. */
const lookup = process.platform === 'linux' ? [require('./linuxjob'), 'unitPath']
  : process.platform === 'win32' ? [require('./win32job'), 'taskFilePath']
    : [create, 'plistPath'];
const realLookup = lookup[0][lookup[1]];
lookup[0][lookup[1]] = (name) => path.join(JOBS, `job-${name}`);
test.after(() => {
  lookup[0][lookup[1]] = realLookup;
  fs.rmSync(SB, { recursive: true, force: true });
});

function session(name, file, rows, ageSec) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  const proj = path.join(SB, 'config', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true });
  const full = path.join(proj, file);
  fs.writeFileSync(full, rows.map((r) => JSON.stringify({ cwd: real, ...r })).join('\n') + '\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(full, t, t);
  return full;
}
function job(name, ageSec) {
  const f = path.join(JOBS, `job-${name}`);
  fs.writeFileSync(f, 'a job\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(f, t, t);
  return f;
}
const replied = (model) => [{ type: 'assistant', message: { model } }];

test('kosmos#8601: a job written after the newest transcript makes its model an earlier reading, not the current one', () => {
  session('switched', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('switched', 5);   // the model change rewrote the job; the agent has not replied since
  assert.deepEqual(status.readModel('switched'), { model: 'claude-opus-4-8', confidence: 'structured', earlierSession: true });
  // The snapshot's call, with its session, reads the same.
  assert.equal(status.readModel('switched', 'switched').earlierSession, true);
});

test('kosmos#8601: on the card that reading is not the model, so the planned model can show', () => {
  session('cardview', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('cardview', 5);
  assert.deepEqual(status.splitModelReading(status.readModel('cardview')), { model: null, earlierModelName: 'Claude Opus 4.8' });
});

test('kosmos#8601 CONTROL: a job older than the transcript leaves the reading as the current model, as before', () => {
  session('steady', 'old.jsonl', replied('claude-opus-5-5'), 5);
  job('steady', 600);
  assert.deepEqual(status.readModel('steady'), { model: 'claude-opus-5-5', confidence: 'structured' });
  assert.deepEqual(status.splitModelReading(status.readModel('steady')), { model: 'claude-opus-5-5', earlierModelName: null });
});

test('kosmos#8601 CONTROL: with no job file (a fleet agent, an untied pane) the reading is unchanged', () => {
  session('nojob', 'old.jsonl', replied('claude-opus-5-5'), 600);
  assert.deepEqual(status.readModel('nojob'), { model: 'claude-opus-5-5', confidence: 'structured' });
});

test('kosmos#8601: after the first reply on the new model, that reply is the current model again', () => {
  session('replies', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('replies', 300);
  session('replies', 'new.jsonl', replied('claude-haiku-5-5'), 5);   // its first reply since the change
  assert.deepEqual(status.readModel('replies'), { model: 'claude-haiku-5-5', confidence: 'structured' });
});
