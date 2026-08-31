'use strict';

/**
 * #671: a true verdict with no next move. The composer's closed-box line and
 * the board's plain offline sentence were both honest and both full stops: a
 * stranger at the box had nothing to do next (witnessed on the first-run
 * journey walk, 2026-08-24, minute two).
 *
 * Two halves, one derivation:
 *  - the plain offline `because` (the one cause whose sentence ended at the
 *    diagnosis) now carries the launch model -- the agent starts itself --
 *    and, when that is not happening, the honest admission that this
 *    computer holds no reason. Gated on the job EXISTING: a job-less agent
 *    gets no self-starting claim, because nothing will start it.
 *  - the composer's line (`dmOffLine`) speaks the row's own cause-specific
 *    sentence at the decision point instead of the engine's subsumed
 *    no-card reason, so every offline cause's next move reaches the person
 *    standing at the box.
 *
 * Rows come from the real server against a sandboxed store (fixture
 * discipline: the row under test is asked for, never written here), with
 * launchd faked at the one seam every probe passes through, exactly as
 * server.socket-split.test.js does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;
const create = require('./engine/create');
const page = require('./test-support/page');

function boardWithStoppedAgent({ job, named = true }) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-nm-'));
  const profiles = nodePath.join(sb, 'data', 'AgentWorkforce', 'profiles');
  const launch = nodePath.join(sb, 'launch');
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(launch, { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'workers', 'quiet'), { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, 'quiet.json'),
    JSON.stringify(named ? { role: 'Researcher', displayName: 'Quiet' } : { role: 'Researcher' }));
  if (job) {
    fs.writeFileSync(nodePath.join(launch, 'com.kosmos.agent.quiet.plist'),
      create.plistFor('quiet', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'));
  }
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const create = require(${JSON.stringify(nodePath.join(REPO, 'engine', 'create.js'))});
    // launchd faked at the run() seam: the job is parked (no pid), and no
    // probe touches the launchd of the machine running this suite.
    create.setRunner((file, args) => {
      if (/launchctl$/.test(String(file)) && args && args[0] === 'list') {
        return { ok: true, stdout: 'PID\\tStatus\\tLabel\\n-\\t0\\tcom.kosmos.agent.quiet\\n' };
      }
      return { ok: true, stdout: '' };
    });
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          process.stdout.write(s);
          srv.close(); process.exit(0);
        });
      });
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      /* kosmos#1651: DRY_RUN stops tmux WRITES; the roster is a READ and only
         TMUX_BIN redirects one, so the whole-sandbox guard now requires it. */
      AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: launch,
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'), // sandboxed whole (#634)
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

test('#671: the plain offline sentence carries the launch model and the honest could-not-tell', () => {
  const row = (boardWithStoppedAgent({ job: true }).agents || []).find((a) => a.sessionName === 'quiet');
  assert.ok(row, 'the stopped agent fell out of the roster');
  assert.equal(row.running, false);
  assert.match(row.because, /nothing on this computer has a session for it/,
    'the diagnosis half of the sentence changed, which this fix has no business doing');
  assert.match(row.because, /starts itself when this computer is on/,
    'the next move is missing: the sentence still ends at the diagnosis (the #671 defect)');
  /* kosmos#1663. This half used to read "this computer is not saying why", and
     that was FALSE next to a Terminal tab holding the reason: Josh read it,
     stopped looking, and wiped his Mac while the trust prompt sat one tab over.
     Asserted as a PROPERTY rather than a new exact string: the sentence must
     still send the person somewhere (#671's intent, which this keeps), and must
     no longer claim that no explanation exists. */
  assert.match(row.because, /Terminal tab is where to look/,
    'the where-to-look half is missing: a person whose agent stays off is told nothing');
  assert.doesNotMatch(row.because, /not saying why/,
    'the sentence still asserts the cause is unknowable, beside the tab that holds it (#1663)');
});

test('#671: a job-less agent gets no self-starting claim, because nothing will start it', () => {
  const row = (boardWithStoppedAgent({ job: false }).agents || []).find((a) => a.sessionName === 'quiet');
  assert.ok(row, 'the job-less agent fell out of the roster');
  assert.doesNotMatch(row.because, /starts itself/,
    'the sentence promises a self-start to an agent with no job, which is false');
});

test('#671: the composer speaks the row\'s own cause at the decision point, and leaves live-pane reasons alone', () => {
  const PAGE_SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(REPO, 'web', 'index.html'), 'utf8'));
  // eslint-disable-next-line no-new-func
  const dmOffLine = new Function(
    page.lift(PAGE_SCRIPT, 'pjSentence') + '\n' + page.lift(PAGE_SCRIPT, 'dmOffLine') + '; return dmOffLine;',
  )();

  const row = (boardWithStoppedAgent({ job: true }).agents || []).find((a) => a.sessionName === 'quiet');
  assert.ok(row, 'no offline row to drive the composer with');
  const noCard = { presence: 'off', presenceBecause: 'we cannot see an agent by exactly this name on this computer right now' };
  const line = dmOffLine('Quiet', noCard, row);
  assert.match(line, /^Quiet cannot be handed a message: /);
  assert.match(line, /starts itself when this computer is on/,
    'the verdict at the box still ends without a next move (the #671 defect)');
  assert.doesNotMatch(line, /exactly this name/,
    'the engine\'s subsumed reason is said beside the row\'s own, so the failure is spoken twice in one line');

  /* Control: a live pane's reachability reason is the engine's own and stays.
     The row here is a RUNNING card (there is a pane; it is scrolled back),
     so the gate must not swap its sentence. */
  const scrolled = { presence: 'off', presenceBecause: 'its window is scrolled back right now, so what we typed would go to the scrollback' };
  const liveRow = { running: true, because: 'it is sitting at its prompt' };
  const liveLine = dmOffLine('Quiet', scrolled, liveRow);
  assert.match(liveLine, /scrolled back/,
    'a live-pane reachability reason was replaced, so the person loses the one sentence that explains the box');
  assert.doesNotMatch(liveLine, /sitting at its prompt/,
    'a live row\'s state line was spoken as a reachability reason');
});

test('#684: an offline agent with a chosen name is not disclosed as unnamed, and one without one is', () => {
  /* The offline mapper hardcoded nameDerived: false, so every offline agent
     WITH a chosen name wore the panel's no-name disclosure about a name
     somebody chose (witnessed on the first-run journey walk: a just-created
     agent's panel carried it). Same meaning as readIdentity's derived: true
     when a record supplied the name. */
  const withName = (boardWithStoppedAgent({ job: true }).agents || []).find((a) => a.sessionName === 'quiet');
  assert.ok(withName, 'the named offline agent fell out of the roster');
  assert.equal(withName.name, 'Quiet', 'the chosen name is not the one shown, so the disclosure claim cannot be judged');
  assert.equal(withName.nameDerived, true,
    'an offline agent with a chosen name still reads nameDerived false, so its panel discloses a no-name that is false (#684)');
  const nameless = (boardWithStoppedAgent({ job: true, named: false }).agents || []).find((a) => a.sessionName === 'quiet');
  assert.ok(nameless, 'the nameless offline agent fell out of the roster');
  assert.equal(nameless.nameDerived, false,
    'an offline agent with no chosen name claims one, so the honest disclosure never shows');
});
