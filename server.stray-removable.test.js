'use strict';

/**
 * #500: a PROFILE-LESS leftover was absent from the enumeration entirely.
 *
 * #127 (#499) made a leftover with a profile visible whether it kept its
 * folder or its job. But the survey enumerated from profiles, so a folder or
 * a launchd job whose profile was deleted or never written was not merely
 * stale in the roster, it was invisible, while `create.js` still refused the
 * name: permanently unusable, with nothing on any screen saying why.
 *
 * The fix is disk enumeration reconciled against what is known, on the
 * foundation the card names: the birth record (#157, carrying #170's id) is
 * the append-only receipt that answers "did Kosmos ever create this name"
 * after every deletable file is gone, so a folder shows only when a created
 * or partial line vouches for it (the workers root is a plain directory and
 * holds checkouts that are not agents), and a plist in our own label
 * namespace (com.kosmos.agent.*) is ours by construction.
 *
 * Same harness as server.leftover-removable.test.js: the real server, a
 * sandboxed store, a stub tmux reporting an empty fleet. It fails against
 * enumeration-from-profiles-only: both strays are simply absent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;
const create = require('./engine/create');

/**
 * A board with: a stray FOLDER (birth-recorded, no profile), a stray JOB
 * (our label namespace, no profile), a stranger's checkout (no birth
 * record), and one profile-backed control. Returns the parsed status plus
 * the removal plans for both strays.
 */
function boardWithStrays() {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-stray-'));
  const profiles = nodePath.join(sb, 'data', 'AgentWorkforce', 'profiles');
  const launch = nodePath.join(sb, 'launch');
  const workers = nodePath.join(sb, 'workers');
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(launch, { recursive: true });

  // The control: a profile-backed agent, so absence-of-strays can never be
  // absence-of-everything.
  fs.writeFileSync(nodePath.join(profiles, 'control.json'),
    JSON.stringify({ role: 'Researcher', displayName: 'Control' }));
  fs.mkdirSync(nodePath.join(workers, 'control'), { recursive: true });

  // The stray folder: a directory plus the birth receipt, and NO profile.
  fs.mkdirSync(nodePath.join(workers, 'strayfolder'), { recursive: true });
  fs.writeFileSync(nodePath.join(sb, 'data', 'AgentWorkforce', 'created.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), name: 'strayfolder', outcome: 'created' }) + '\n');

  // The stranger's checkout: a directory, a valid name, and no birth line.
  fs.mkdirSync(nodePath.join(workers, 'checkout'), { recursive: true });

  // The stray job: our label namespace, and NO profile.
  fs.writeFileSync(nodePath.join(launch, 'com.kosmos.agent.strayjob.plist'),
    create.plistFor('strayjob', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'));

  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    const get = (path) => new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve(s));
      });
    });
    srv.listen(0, '127.0.0.1', async () => {
      const status = await get('/api/status');
      const folderPlan = await get('/api/agent/strayfolder/removal');
      const jobPlan = await get('/api/agent/strayjob/removal');
      process.stdout.write(JSON.stringify({ status, folderPlan, jobPlan }));
      srv.close(); process.exit(0);
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: workers,
      AGENT_WORKFORCE_LAUNCH: launch,
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  const three = JSON.parse(out);
  return {
    status: JSON.parse(three.status),
    folderPlan: JSON.parse(three.folderPlan),
    jobPlan: JSON.parse(three.jobPlan),
  };
}

const BOARD = boardWithStrays();

test('#500: both profile-less strays are visible, with the no-record sentence', () => {
  const rows = new Map(BOARD.status.agents.map((a) => [a.sessionName, a]));
  const sf = rows.get('strayfolder');
  assert.ok(sf, 'the birth-recorded stray folder is absent: the survey still enumerates from profiles only');
  /* The folder arm speaks through the birth receipt, which IS a record;
     "no record" belongs to the job arm alone. */
  assert.match(sf.because, /made this agent once/, sf.because);
  assert.match(sf.because, /only its folder remains/, sf.because);
  assert.doesNotMatch(sf.because, /free the name/,
    'the sentence promises name-freeing, which remove (not delete, ever) cannot deliver');
  assert.equal(sf.running, false);
  assert.equal(sf.id, null, 'a profile-less stray carried an id from nowhere');
  const sj = rows.get('strayjob');
  assert.ok(sj, 'the label-namespace stray job is absent: the survey still enumerates from profiles only');
  assert.match(sj.because, /no longer has this agent set up/, sj.because);
  assert.match(sj.because, /a startup job was found/, sj.because);
  assert.doesNotMatch(sj.because, /free the name/, sj.because);
});

test('#500: the stranger\'s checkout stays invisible, and the control is a normal row', () => {
  const rows = new Map(BOARD.status.agents.map((a) => [a.sessionName, a]));
  assert.equal(rows.has('checkout'), false,
    'a directory with no birth record reached the board: the roster-from-records ruling is broken');
  const control = rows.get('control');
  assert.ok(control, 'the profile-backed control is absent, so the stray assertions above prove nothing');
  assert.doesNotMatch(control.because || '', /no longer has this agent set up|made this agent once/,
    'the control wears a stray sentence');
});

test('#500: both strays have viable removal plans, the road to clearing them off the board', () => {
  for (const [label, plan] of [['folder', BOARD.folderPlan], ['job', BOARD.jobPlan]]) {
    assert.equal(plan.ok, true, label + ' plan: ' + JSON.stringify(plan));
  }
});
