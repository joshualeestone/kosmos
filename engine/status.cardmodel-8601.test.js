'use strict';
/**
 * kosmos#8601 (the first half of #8466, measured on the Windows box 11-16): after a model change the card named the OLD
 * model until the agent's next turn. The change rewrites the job and restarts the agent, and until its next reply the
 * newest transcript still names the OLD model, which readModel returned as current. Now a transcript last written
 * before the job, whose model the job no longer names, is read as an earlier reading (the #6716 shape): `model` stays
 * null and the card shows the job's model.
 *
 * Review 1: the file time alone is not a model change (every Windows start or stop moves the task file's time, and an
 * account move rewrites the job on every platform), so a rewritten job naming the SAME model, no model, or a short name
 * leaves the reading as it was.
 *
 * The job file is the platform's own (plist, systemd unit, Scheduled Task file) and its model comes from
 * create.plannedModelOf; the tests point both at the sandbox, so the same assertions hold on every platform.
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

/* The platform's job-file lookup and the job's model, pointed at the sandbox for the whole file and put back after. */
const lookup = process.platform === 'linux' ? [require('./linuxjob'), 'unitPath']
  : process.platform === 'win32' ? [require('./win32job'), 'taskFilePath']
    : [create, 'plistPath'];
const realLookup = lookup[0][lookup[1]];
const realPlanned = create.plannedModelOf;
const jobModel = new Map();   // name -> the model its job names (absent: none)
lookup[0][lookup[1]] = (name) => path.join(JOBS, `job-${name}`);
create.plannedModelOf = (name) => (jobModel.has(name) ? { id: jobModel.get(name), isDefault: false } : null);
test.after(() => {
  lookup[0][lookup[1]] = realLookup;
  create.plannedModelOf = realPlanned;
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
/* The agent's job, written `ageSec` ago, naming `model` (or none). */
function job(name, ageSec, model) {
  const f = path.join(JOBS, `job-${name}`);
  fs.writeFileSync(f, 'a job\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(f, t, t);
  if (model) jobModel.set(name, model); else jobModel.delete(name);
  return f;
}
const replied = (model) => [{ type: 'assistant', message: { model } }];
const current = (model) => ({ model, confidence: 'structured' });

test('kosmos#8601: a job rewritten after the transcript to name ANOTHER model makes the reading an earlier one', () => {
  session('switched', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('switched', 5, 'claude-haiku-5-5');   // the model change; the agent has not replied since
  assert.deepEqual(status.readModel('switched'), { model: 'claude-opus-4-8', confidence: 'structured', earlierSession: true });
  // The snapshot's call, with its session, reads the same.
  assert.equal(status.readModel('switched', 'switched').earlierSession, true);
  // On the card that is not the model, so the job's model shows (server.js plannedFor reads it when modelName is null).
  assert.deepEqual(status.splitModelReading(status.readModel('switched')), { model: null, earlierModelName: 'Claude Opus 4.8' });
});

test('kosmos#8601 review 1 CONTROL: an account move, a provider switch or (Windows) a stop and start rewrites the job with the SAME model: the reading stands', () => {
  session('restarted', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('restarted', 5, 'claude-opus-4-8');
  assert.deepEqual(status.readModel('restarted'), current('claude-opus-4-8'));
});

test('kosmos#8601 review 1 CONTROL: a rewritten job that names no model (an agent from before the picker) leaves the reading', () => {
  session('nomodel', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('nomodel', 5, null);
  assert.deepEqual(status.readModel('nomodel'), current('claude-opus-4-8'));
});

test('kosmos#8601 review 1 CONTROL: a short name in the job cannot be compared, so the reading stands', () => {
  session('alias', 'old.jsonl', replied('claude-opus-5-5'), 600);
  job('alias', 5, 'opus');
  assert.deepEqual(status.readModel('alias'), current('claude-opus-5-5'));
});

test('kosmos#8601 review 1 CONTROL: the same model spelled with a [1m] suffix or a date is the same model', () => {
  session('wide', 'old.jsonl', replied('claude-opus-5'), 600);
  job('wide', 5, 'claude-opus-5[1m]');
  assert.deepEqual(status.readModel('wide'), current('claude-opus-5'));
  session('dated', 'old.jsonl', replied('claude-haiku-4-5-20251001'), 600);
  job('dated', 5, 'claude-haiku-4-5');
  assert.deepEqual(status.readModel('dated'), current('claude-haiku-4-5-20251001'));
});

/* Review 4: Claude Code writes the person's prompt row as soon as it is sent, before any reply, so the file is newer
   than the job while the newest REPLY is still the old model's. The reply row's own timestamp decides. */
const at = (secAgo) => new Date(Date.now() - secAgo * 1000).toISOString();
test('kosmos#8601 review 4: a prompt sent after the change does not bring the old model back before the first reply', () => {
  session('prompted', 'old.jsonl', [
    { type: 'assistant', message: { model: 'claude-opus-4-8' }, timestamp: at(600) },
    { type: 'user', message: { content: 'hello after the change' }, timestamp: at(2) },   // sent after the change
  ], 2);   // so the FILE is newer than the job
  job('prompted', 300, 'claude-haiku-5-5');
  assert.deepEqual(status.readModel('prompted'), { model: 'claude-opus-4-8', confidence: 'structured', earlierSession: true });
});

test('kosmos#8601 review 4 CONTROL: a reply timestamped after the job is the current model, whatever the file time says', () => {
  session('repliedafter', 'old.jsonl', [
    { type: 'assistant', message: { model: 'claude-opus-4-8' }, timestamp: at(60) },   // a reply after the rewrite
  ], 600);   // a file time older than the job (copied back, say): the row's own time wins
  job('repliedafter', 300, 'claude-haiku-5-5');
  assert.deepEqual(status.readModel('repliedafter'), current('claude-opus-4-8'));
});

/* Review 6: modelInText prefers an id the name table knows over a newer one it does not, so after a change to a model
   not in the table yet the READ model stays the old one. Any reply after the job means the agent has answered since
   the change, so the reading is not "earlier", however many replies follow. */
test('kosmos#8601 review 6: replies on a model not in the name table yet end the earlier reading', () => {
  session('newfamily', 'old.jsonl', [
    { type: 'assistant', message: { model: 'claude-opus-4-8' }, timestamp: at(900) },
    { type: 'assistant', message: { model: 'claude-opus-9' }, timestamp: at(60) },
    { type: 'assistant', message: { model: 'claude-opus-9' }, timestamp: at(10) },
  ], 10);
  job('newfamily', 300, 'claude-opus-9');
  assert.notEqual(status.readModel('newfamily').earlierSession, true, 'the agent replied after the change and still read as earlier');
});

test('kosmos#8601 review 6: a <synthetic> row after the change is not a reply', () => {
  session('synth', 'old.jsonl', [
    { type: 'assistant', message: { model: 'claude-opus-4-8' }, timestamp: at(900) },
    { type: 'assistant', message: { model: '<synthetic>' }, timestamp: at(10) },
  ], 10);
  job('synth', 300, 'claude-haiku-5-5');
  assert.equal(status.readModel('synth').earlierSession, true);
});

/* Review 7: the job is filed under the board name; a different session read under that name (foo / foo-discord) is not
   the session the job starts, so its reading stands. The agent's own session (no session given, or the same name in
   any case) still gets the rule. */
test('kosmos#8601 review 7: another session sharing the board name is never judged against that name\'s job', () => {
  session('shared', 'old.jsonl', replied('claude-fable-5'), 600);
  job('shared', 5, 'claude-opus-5');
  assert.deepEqual(status.readModel('shared', 'shared-discord'), current('claude-fable-5'));
  // The agent's own session: the rule applies, whether the session is given or not, in any case.
  assert.equal(status.readModel('shared').earlierSession, true);
  assert.equal(status.readModel('shared', 'shared').earlierSession, true);
  assert.equal(status.readModel('shared', 'SHARED').earlierSession, true);
});

/* Review 7: an API-error row carrying a real model is not a reply (hasReplied's own test), so it does not end the
   window. */
test('kosmos#8601 review 7: an API error row is not a reply', () => {
  session('apierr', 'old.jsonl', [
    { type: 'assistant', message: { model: 'claude-opus-4-8' }, timestamp: at(900) },
    // A failed request after the change, carrying a real model other than the job's: the model read is this row's
    // (modelInText does not skip it), so without the exclusion its time would count as a reply after the job.
    { type: 'assistant', message: { model: 'claude-sonnet-5' }, isApiErrorMessage: true, timestamp: at(10) },
  ], 10);
  job('apierr', 300, 'claude-haiku-5-5');
  assert.equal(status.readModel('apierr').earlierSession, true);
});

/* Review 5 (flipped from review 3's "accepted"): a model the name table does not know yet still matches its own dated
   form, either way round, so a routine rewrite (an account move) does not hide its reading. A different model still
   reads as another. */
test('kosmos#8601 review 5 CONTROL: an unknown model\'s dated and undated ids are the same model', () => {
  session('unknowndate', 'old.jsonl', replied('claude-zeta-9-20991231'), 600);
  job('unknowndate', 5, 'claude-zeta-9');
  assert.deepEqual(status.readModel('unknowndate'), current('claude-zeta-9-20991231'));
  session('unknownat', 'old.jsonl', replied('claude-zeta-9'), 600);
  job('unknownat', 5, 'claude-zeta-9@20991231');
  assert.deepEqual(status.readModel('unknownat'), current('claude-zeta-9'));
  session('unknownother', 'old.jsonl', replied('claude-zeta-9-20991231'), 600);
  job('unknownother', 5, 'claude-zeta-10');
  assert.equal(status.readModel('unknownother').earlierSession, true, 'a different unknown model read as the same');
});

/* Review 5: a naming reply whose timestamp cannot be read falls back to the file's time, as before review 4. */
test('kosmos#8601 review 5: an unreadable timestamp on the naming reply falls back to the file time', () => {
  session('badts', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' }, timestamp: 'not a time' }], 600);
  job('badts', 5, 'claude-haiku-5-5');
  assert.equal(status.readModel('badts').earlierSession, true);
});

test('kosmos#8601 CONTROL: a job older than the transcript leaves the reading, whatever model it names', () => {
  session('steady', 'old.jsonl', replied('claude-opus-5-5'), 5);
  job('steady', 600, 'claude-haiku-5-5');   // a /model switch inside the session after the job was written
  assert.deepEqual(status.readModel('steady'), current('claude-opus-5-5'));
});

test('kosmos#8601 CONTROL: with no job file (a fleet agent, an untied pane) the reading is unchanged', () => {
  session('nojob', 'old.jsonl', replied('claude-opus-5-5'), 600);
  jobModel.set('nojob', 'claude-haiku-5-5');   // even if a model were read, no job file means no rewrite
  assert.deepEqual(status.readModel('nojob'), current('claude-opus-5-5'));
});

test('kosmos#8601: after the first reply on the new model, that reply is the current model again', () => {
  session('replies', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('replies', 300, 'claude-haiku-5-5');
  session('replies', 'new.jsonl', replied('claude-haiku-5-5'), 5);   // its first reply since the change
  assert.deepEqual(status.readModel('replies'), current('claude-haiku-5-5'));
});
