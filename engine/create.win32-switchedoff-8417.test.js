'use strict';
/**
 * kosmos#8417: on Windows, an agent whose Scheduled Task is switched off shows as switched off.
 *
 * 🛑 THE DEFECT. `create.disabledJobsResult` had a Linux arm and otherwise ran `/bin/launchctl print-disabled`, so
 * Windows fell into the Mac arm: no launchctl, the call failed, `{ ok: false }`, and `disabledJobs()` made that an
 * empty set. The board's `jobSwitchedOff` was never true there, and a switched-off agent read as a plain stopped one.
 *
 * 🔑 THE PLATFORM IS INJECTED ('win32') so a Mac drives the arm, and win32job's runner is stubbed, so the real
 * schtasks is never asked. The scheduler below answers the two reads the arm makes: the folder list (CSV, one row per
 * task, with its localized Status word) and each task's definition (`/Query /XML`, the real writer's XML).
 *
 *   node --test engine/create.win32-switchedoff-8417.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* SANDBOX EVERY ROOT BEFORE ANY REQUIRE (convention 2): store.ROOT freezes at require. */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'create-win32-switchedoff-')));
for (const d of ['home', 'data', 'workers', 'launch', 'projects']) fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.KOSMOS_WORLD;

const create = require('./create');
const job = require('./win32job');

const XML_ENV = { USERNAME: 'kitty', USERDOMAIN: 'BOX', SystemRoot: 'C:\\Windows' };
const NO_SUCH = { ok: false, out: 'ERROR: The system cannot find the file specified.' };

function taskFor(name, fields) {
  return { name, cwd: 'C:\\work\\' + name, node: 'C:\\n.exe', supervisor: 'C:\\s.js', ...fields };
}

/**
 * A Task Scheduler holding `tasks` (task name -> { spec, off, status }). `off` switches the definition off
 * (`<Enabled>false</Enabled>`); `status` is the CSV Status word (default Ready/Disabled from `off`). `o.listFails`
 * fails the folder query, `o.xmlFails` (a set of task names) fails those definition reads. Returns the calls made.
 */
function scheduler(tasks, opts) {
  const o = opts || {};
  const calls = [];
  job.setRunner((args) => {
    calls.push(args.slice());
    const tn = args[args.indexOf('/TN') + 1];
    if (args[0] === '/Query' && args.includes('CSV')) {
      assert.equal(tn, 'Kosmos\\', 'the arm lists the Kosmos folder, not one task');
      if (o.listFails) return { ok: false, out: o.listFails };
      const names = Object.keys(tasks);
      if (!names.length) return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
      return {
        ok: true,
        out: names.map((n) => {
          const t = tasks[n];
          const status = t.status || (t.off ? 'Disabled' : 'Ready');
          return `"\\${n}","N/A","${status}"`;
        }).concat(o.dupRows ? [`"\\${names[0]}","N/A","Ready"`] : []).join('\r\n') + '\r\n',
      };
    }
    if (args[0] === '/Query' && args.includes('/XML')) {
      if (o.xmlFails && o.xmlFails.has(tn)) return { ok: false, out: 'ERROR: Access is denied.' };
      const t = tasks[tn];
      if (!t) return NO_SUCH;
      let xml = job.taskXml({ ...t.spec, enabled: !t.off }, XML_ENV);
      // `noArgs`: a definition whose argument line cannot be read (the spec half fails), its switch still readable.
      if (t.noArgs) xml = xml.replace(/<Arguments>[\s\S]*?<\/Arguments>/, '');
      // `unreadable`: a switch that is neither true nor false, so the definition says nothing about it.
      return { ok: true, out: t.unreadable
        ? xml.replace(/<Settings>([\s\S]*?)<\/Settings>/, (m, inner) => '<Settings>' + inner.replace(/<Enabled>(?:true|false)<\/Enabled>/, '') + '<Enabled>maybe</Enabled></Settings>')
        : xml };
    }
    return { ok: true, out: '' };
  });
  return calls;
}
const xmlReads = (calls) => calls.filter((a) => a[0] === '/Query' && a.includes('/XML')).map((a) => a[a.indexOf('/TN') + 1]);

test.after(() => {
  job.setRunner(null);
  delete process.env.KOSMOS_WORLD;
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#8417 a switched-off task is in the set, a switched-on one is not, and launchctl is never asked', () => {
  const calls = scheduler({
    'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true },
    'Kosmos\\agent-bo': { spec: taskFor('bo') },
  });
  let askedLaunchctl = 0;
  const launchctl = () => { askedLaunchctl += 1; throw new Error('launchctl asked on Windows'); };
  const r = create.disabledJobsResult(launchctl, 'win32');
  assert.equal(r.ok, true);
  assert.deepEqual([...r.jobs], ['ava']);
  assert.equal(askedLaunchctl, 0, 'the launchctl runner is never asked on Windows');
  assert.deepEqual([...create.disabledJobs('win32')], ['ava'], 'the board poll reads the same set');
  assert.ok(calls.some((a) => a[0] === '/Query' && a.includes('CSV')), 'CONTROL: the arm did ask Task Scheduler');
});

test('#8417 a folder that could not be listed is could-not-look, never "none switched off"', () => {
  scheduler({ 'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true } }, { listFails: 'ERROR: Access is denied.' });
  assert.deepEqual(create.disabledJobsResult(undefined, 'win32'), { ok: false });
  assert.deepEqual([...create.disabledJobs('win32')], [], 'the board poll fails soft to an empty set');
});

test('#8417 an empty Kosmos folder is a real "none switched off"', () => {
  scheduler({});
  const r = create.disabledJobsResult(undefined, 'win32');
  assert.equal(r.ok, true);
  assert.equal(r.jobs.size, 0);
});

test('#8417 a task switched off by hand is seen at the next poll, and an unchanged one costs no definition read', () => {
  const tasks = { 'Kosmos\\agent-ava': { spec: taskFor('ava') }, 'Kosmos\\agent-bo': { spec: taskFor('bo') } };
  const calls = scheduler(tasks);
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0, 'both on at first');
  assert.deepEqual(xmlReads(calls).sort(), ['Kosmos\\agent-ava', 'Kosmos\\agent-bo'], 'first sight reads each definition once');

  calls.length = 0;
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0);
  assert.deepEqual(xmlReads(calls), [], 'an unchanged Status word is answered from the cache: one folder query per poll');

  // Switched off in Task Scheduler: no Kosmos disable ran, so nothing busted the cache. The Status word moved.
  tasks['Kosmos\\agent-ava'].off = true;
  calls.length = 0;
  assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['ava'], 'the hand switch-off is seen');
  assert.deepEqual(xmlReads(calls), ['Kosmos\\agent-ava'], 'only the task whose word changed is read again');

  // And switched back on by hand.
  tasks['Kosmos\\agent-ava'].off = false;
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0, 'switched back on, it leaves the set');
});

test('#8417 the Status word is compared, never read: a German Windows works the same', () => {
  const tasks = { 'Kosmos\\agent-ava': { spec: taskFor('ava'), status: 'Bereit' } };
  scheduler(tasks);
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0);
  tasks['Kosmos\\agent-ava'].off = true;
  tasks['Kosmos\\agent-ava'].status = 'Deaktiviert';
  assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['ava']);
  // CONTROL: the word alone says nothing. "Disabled" over a definition that is on is not switched off.
  scheduler({ 'Kosmos\\agent-cy': { spec: taskFor('cy'), status: 'Disabled' } });
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0, 'the definition decides, not the word');
});

test('#8417 one definition that could not be read is left out; the rest still answer', () => {
  scheduler({
    'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true },
    'Kosmos\\agent-bo': { spec: taskFor('bo'), off: true },
  }, { xmlFails: new Set(['Kosmos\\agent-bo']) });
  const r = create.disabledJobsResult(undefined, 'win32');
  assert.equal(r.ok, true);
  assert.deepEqual([...r.jobs], ['ava'], 'an unread task is not said to be off');
});

test('#8417 a definition whose switch could not be read is not said to be off', () => {
  scheduler({ 'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true, unreadable: true } });
  assert.equal(job.cachedTaskSpec('ava').enabled, undefined, 'CONTROL: the fixture really is unreadable');
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0);
});

test('#8417 the switch is read even when the argument line is not, and a failed read is not asked again at once', () => {
  const tasks = { 'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true, noArgs: true } };
  scheduler(tasks);
  assert.equal(job.cachedTaskSpec('ava').known, false, 'CONTROL: the definition really cannot be read as a spec');
  assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['ava'], 'its switch still says off');

  const again = scheduler({ 'Kosmos\\agent-bo': { spec: taskFor('bo'), off: true } }, { xmlFails: new Set(['Kosmos\\agent-bo']) });
  create.disabledJobsResult(undefined, 'win32');
  assert.equal(xmlReads(again).length, 1, 'first sight asks once');
  again.length = 0;
  create.disabledJobsResult(undefined, 'win32');
  assert.deepEqual(xmlReads(again), [], 'a failed read is not asked again on the next poll');
});

test('#8417 a failed read is asked again a minute later, and then answers', () => {
  let t = 1000000;
  job.setRunner(null);
  const opts = { xmlFails: new Set(['Kosmos\\agent-ava']) };
  const calls = scheduler({ 'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true } }, opts);
  job.setRunningClock(() => t);
  try {
    assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0, 'unread: not said to be off');
    opts.xmlFails.clear();   // the next read would answer
    t += 59999;
    calls.length = 0;
    assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0);
    assert.deepEqual(xmlReads(calls), [], 'not before the minute is up');
    t += 1;
    assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['ava'], 'retried at the minute, it says off');
    calls.length = 0;
    t += 600000;
    create.disabledJobsResult(undefined, 'win32');
    assert.deepEqual(xmlReads(calls), [], 'a switch that WAS read is not asked again on time alone');
  } finally { job.setRunningClock(null); }
});

test('#8417 at most four definitions are read per poll; the rest fill in on later polls', () => {
  const tasks = {};
  for (const n of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) tasks['Kosmos\\agent-' + n] = { spec: taskFor(n), off: true };
  const calls = scheduler(tasks);
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 4, 'four read on the first poll');
  assert.equal(xmlReads(calls).length, 4);
  calls.length = 0;
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 6, 'the other two on the next');
  assert.equal(xmlReads(calls).length, 2);
  // A word that moves past the cap drops what was read under the old word rather than reporting it.
  for (const n of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) { tasks['Kosmos\\agent-' + n].off = false; tasks['Kosmos\\agent-' + n].status = 'Ready'; }
  assert.equal(create.disabledJobsResult(undefined, 'win32').jobs.size, 0, 'the four re-read say on, the two unread are not said off');
});

test('#8417 a task listed twice is one task: one definition read', () => {
  const calls = scheduler({ 'Kosmos\\agent-ava': { spec: taskFor('ava'), off: true } }, { dupRows: true });
  assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['ava']);
  assert.equal(xmlReads(calls).length, 1);
});

test('#8417 a task that left the folder and came back is read again', () => {
  const tasks = { 'Kosmos\\agent-ava': { spec: taskFor('ava') } };
  const calls = scheduler(tasks);
  create.disabledJobsResult(undefined, 'win32');
  delete tasks['Kosmos\\agent-ava'];
  tasks['Kosmos\\agent-bo'] = { spec: taskFor('bo') };
  create.disabledJobsResult(undefined, 'win32');
  tasks['Kosmos\\agent-ava'] = { spec: taskFor('ava'), off: true, status: 'Ready' };   // same word as before it left
  calls.length = 0;
  assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['ava'], 'its new switch is read, not the remembered one');
  assert.deepEqual(xmlReads(calls), ['Kosmos\\agent-ava']);
});

test('#8417 another Kosmos\'s task in the same folder is not this board\'s', () => {
  scheduler({
    'Kosmos\\agent-ava+qa': { spec: taskFor('ava'), off: true },
    'Kosmos\\agent-bo': { spec: taskFor('bo'), off: true },
  });
  assert.deepEqual([...create.disabledJobsResult(undefined, 'win32').jobs], ['bo']);
});

test('#8417 the Windows sentence names Task Scheduler and the task, not System Settings', () => {
  const off = new Set(['ava']);
  const t = create.switchedOffSentence('ava', off, 'win32');
  assert.match(t, /switched off in Task Scheduler/);
  assert.match(t, /find agent-ava in the Kosmos folder and choose Enable/);
  assert.doesNotMatch(t, /System Settings|Login Items/);
  assert.doesNotMatch(t, /\.$/, 'the row adds its own full stop');
  assert.equal(create.switchedOffSentence('bo', off, 'win32'), null, 'CONTROL: not switched off, no sentence');
  // CONTROL: the Mac sentence is unchanged.
  assert.match(create.switchedOffSentence('ava', off, 'darwin'), /System Settings under Login Items/);
});

test('#8417 in a named Kosmos the sentence names that world\'s task', () => {
  process.env.KOSMOS_WORLD = 'qa';
  try {
    assert.match(create.switchedOffSentence('ava', new Set(['ava']), 'win32'), /find agent-ava\+qa in the Kosmos folder/);
  } finally { delete process.env.KOSMOS_WORLD; }
});
