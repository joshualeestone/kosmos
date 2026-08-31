'use strict';

/**
 * Every agent's reports-to block is refreshed when the board starts (#1676).
 *
 * 🛑 THE SAME DEFECT AS THE CONNECTIONS REFRESH, ONE MODULE OVER.
 * `reports.syncEveryone` had exactly ONE caller, `PUT /api/you`, so an edit to
 * `blockBody()` reached an agent that already existed only when the person
 * happened to save their own About-you details.
 *
 * ⚠️ AND IT IS EASY TO MISREAD AS ALREADY COVERED. `policyEngine.syncEveryone`
 * has three callers a few hundred lines above, with the same method name on a
 * different object. Measured on origin/main before this landed: reports 1,
 * policyEngine 3. Reading the wrong object's line numbers makes the gap look
 * solved, and nearly produced a "just rename any agent" workaround that would
 * have delivered nothing.
 *
 * ⚠️ IT ASSERTS THE FILE, NOT THE AGENT, deliberately, and for the reason the
 * connections test gives: `engine/instructions.js` reads an instruction file ONCE
 * at session start, so nothing this product does can make a LIVE agent know
 * something new. What the fix buys is that the file is already right at the
 * agent's next start.
 *
 * ⚠️ RUNS THE REAL SERVER as a child process, because the behaviour lives behind
 * `require.main === module` and is unreachable from a require.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = __dirname;
const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');

/* The wording #1673/#1676 added. Asserted here because it is asserted NOWHERE
   else in the tree - measured, with a control of 4 test files mentioning
   `reportsTo` - so today it can be deleted and nothing goes red. */
const SAYS_NOT_SPOKEN_TO = 'not the same as being spoken to by them';
const SAYS_ANSWER_SENDER = 'You answer whoever sent the message';

/* ⚠️ THE `-discord` SUFFIX IS LOAD-BEARING. `status.isNamedOurs` recognises an
   agent either by a tmux user option Kosmos sets at creation, which a fixture
   cannot fake, or by that legacy suffix. Without it every fixture agent is
   anonymous, `syncEveryone` skips it, and the file passes vacuously. */
function sandbox(agents) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-rep-1676-'));
  const workers = path.join(sb, 'workers');
  const profiles = path.join(sb, 'data', 'AgentWorkforce', 'profiles');
  fs.mkdirSync(workers, { recursive: true });
  fs.mkdirSync(profiles, { recursive: true });
  const lines = [];
  for (const a of agents) {
    const bare = a.name.replace(/-discord$/, '');
    if (a.file !== null) {
      /* 🔑 THE FOLDER DROPS THE SUFFIX, as the connections fixture records. */
      const dir = path.join(workers, bare);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), a.file);
    }
    if (a.profile) fs.writeFileSync(path.join(profiles, bare + '.json'), JSON.stringify(a.profile));
    lines.push(fleet.line({ session: a.name }));
  }
  fs.writeFileSync(path.join(sb, 'panes.txt'), lines.join('\n') + '\n');
  return sb;
}

function boot(sb) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      /* 🛑 BOTH, and the TMUX_BIN is the one that matters: without it the roster
         resolves the REAL fleet and a boot-time WRITE path meets real agents. */
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let out = ''; let err = '';
    const done = () => { try { child.kill(); } catch { /* already gone */ } resolve({ out, err }); };
    child.stdout.on('data', (b) => { out += b; if (/Kosmos on http/.test(out)) setTimeout(done, 300); });
    child.stderr.on('data', (b) => { err += b; });
    setTimeout(done, 8000);
  });
}

test('#1676: an agent with a reportsTo gets the block on a plain board start', async () => {
  const sb = sandbox([{
    name: 'pp-rep-discord',
    file: '# I am an agent\n\nSome prose.\n',
    profile: { role: 'Engineer', reportsTo: 'marcus' },
  }]);
  const f = path.join(sb, 'workers', 'pp-rep', 'CLAUDE.md');

  assert.equal(fs.readFileSync(f, 'utf8').includes(projects.REPORTS_START), false,
    'precondition: the agent starts WITHOUT the block, or this test proves nothing');

  await boot(sb);

  const after = fs.readFileSync(f, 'utf8');
  assert.equal(after.includes(projects.REPORTS_START), true,
    'a plain board start must put the reports-to block into an existing agent, with nobody saving a form');

  /* The two sentences are the POINT of the delivery, not incidental. An agent
     that gains an old block is not fixed. */
  assert.equal(after.includes(SAYS_NOT_SPOKEN_TO), true,
    'the delivered block must separate reporting to someone from being spoken to by them');
  assert.equal(after.includes(SAYS_ANSWER_SENDER), true,
    'the delivered block must tell the agent to answer whoever sent the message');

  fs.rmSync(sb, { recursive: true, force: true });
});

test('#1676 CONTROL: an agent whose file we never created is not invented', async () => {
  /* The negative arm for the write. Booting must not CREATE an instructions file
     for an agent that has none: a fix that started writing files for agents would
     be a worse bug than the one being fixed. */
  const sb = sandbox([{ name: 'pp-repnofile-discord', file: null, profile: { reportsTo: 'marcus' } }]);
  await boot(sb);
  assert.equal(fs.existsSync(path.join(sb, 'workers', 'pp-repnofile', 'CLAUDE.md')), false,
    'the board must not create an instructions file for an agent that has none');
  fs.rmSync(sb, { recursive: true, force: true });
});
