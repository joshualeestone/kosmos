'use strict';

/**
 * `PUT /api/you` must not report a complete success when a managed block it
 * also writes did not land (kosmos#1684).
 *
 * 🛑 THE DEFECT THIS PINS. The route runs THREE syncs and builds its answer
 * from ONE of them:
 *
 *     you.syncEveryone(roster)          -> becomes `told`, sent to the screen
 *     reports.syncEveryone(roster)      -> verdicts DISCARDED, throw swallowed
 *     connections.syncEveryone(roster)  -> verdicts DISCARDED, throw swallowed
 *
 * ⇒ the reports-to block could fail for EVERY agent and the person saving the
 * form would be told every agent was told. The old code called that "carried by
 * the marker, not here". The marker is #323's STALE-BLOCK marker: it marks a
 * block stale IN THE AGENT'S FILE, to be found later. It cannot answer the
 * person standing at the form.
 *
 * ⚠️ ISOLATING ONE MODULE IS THE WHOLE DIFFICULTY, and a fixture that fails all
 * three proves nothing: `you` would report COULD_NOT by itself and the route
 * would look correct without the fix. The three refusal paths are near
 * identical (no folder, not editable, unreadable) and fire together.
 *
 * ✅ THE ONE CONDITION THAT SEPARATES THEM: each module splices a DIFFERENT
 * marker pair, and `projects.findBlock` answers `ambiguous` when a file holds
 * MORE THAN ONE pair (engine/projects.js:1875). So a file carrying two copies
 * of the REPORTS block refuses in `reports` and writes cleanly in `you` and
 * `connections`. That is not a contrived state either: it is what a person gets
 * by hand-copying a chunk of their agent's instructions.
 *
 * ⚠️ RUNS THE REAL SERVER as a child process, same as
 * server.connections-refresh-1649.test.js, because the route lives behind
 * `require.main === module`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = __dirname;
const fleet = require('./test-support/fleet');
const reports = require('./engine/reports');
const projects = require('./engine/projects');

/* 🔑 The `-discord` suffix is load-bearing and the folder DROPS it -- both traps
   are documented at length in server.connections-refresh-1649.test.js. Without
   the suffix `isNamedOurs` is false, syncEveryone skips the agent, and this file
   would pass vacuously against a fleet of zero. */
function sandbox(files) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1684-'));
  const workers = path.join(sb, 'workers');
  fs.mkdirSync(workers, { recursive: true });
  const lines = [];
  for (const [name, body] of Object.entries(files)) {
    const dir = path.join(workers, name.replace(/-discord$/, ''));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
    lines.push(fleet.line({ session: name }));
  }
  fs.writeFileSync(path.join(sb, 'panes.txt'), lines.join('\n') + '\n');
  return sb;
}

/** Boot the real server on an ephemeral port and hand back its base URL. */
function boot(sb) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      /* 🛑 TMUX_BIN is the one that sandboxes the ROSTER READ. Without it the
         roster resolves the REAL fleet -- see the long note in
         server.connections-refresh-1649.test.js. */
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('server never announced a port:\n' + out)); }, 15000);
    child.stdout.on('data', (b) => {
      out += b;
      const m = out.match(/http:\/\/[^\s]*?:(\d+)/);
      if (m) { clearTimeout(t); resolve({ child, base: `http://127.0.0.1:${m[1]}` }); }
    });
  });
}

/** A file carrying TWO reports blocks: ambiguous for `reports`, clean for the others. */
function twoReportsBlocks() {
  const one = `${reports.START}\n## Who you report to\n\nsomething\n${reports.END}\n`;
  return `# An agent\n\nProse.\n\n${one}\nMore prose.\n\n${one}`;
}

test('#1684: a block that did not land is not reported as told', async () => {
  const sb = sandbox({ 'mk-dup-discord': twoReportsBlocks() });
  const file = path.join(sb, 'workers', 'mk-dup', 'CLAUDE.md');

  /* PRECONDITION, and without it this test can pass for the wrong reason: the
     fixture must actually be ambiguous to `reports`. If findBlock stops calling
     two pairs ambiguous, this file must fail loudly rather than go green. */
  const found = projects.findBlock(fs.readFileSync(file, 'utf8'), reports.START, reports.END);
  assert.equal(found && found.ambiguous, true,
    'precondition: the fixture must be AMBIGUOUS for reports, or nothing is being isolated');

  const { child, base } = await boot(sb);
  try {
    const res = await fetch(`${base}/api/you`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Josh', does: 'runs things', know: '' }),
    });
    assert.equal(res.status, 200, 'the save itself still succeeds: this is non-gating');
    const body = await res.json();

    /* 🔑 THE ROW IS KEYED WITHOUT THE SUFFIX. The fleet line says
       `mk-dup-discord`, and `told` comes back keyed `mk-dup`: the roster
       normalises the session name before syncEveryone ever sees it. Measured,
       not assumed -- an earlier draft of this test looked up the suffixed name,
       found nothing, and failed while the product was behaving correctly. Both
       sides of the route's own merge use that same value, so they agree. */
    const row = (body.told || []).find((t) => t && t.agent === 'mk-dup');
    assert.ok(row, 'the agent must appear in told at all');

    /* THE ASSERTION THE OLD CODE FAILS. `you` writes this file cleanly, so
       before the fix this row reads `told` and the person is told everything
       landed, while the reports-to block was refused. */
    assert.notEqual(row.state, projects.TOLD.TOLD,
      'an agent whose reports-to block was REFUSED must not be reported as told');
    assert.equal(row.state, projects.TOLD.COULD_NOT);

    /* And it must say WHICH block, or the person looks at the wrong thing. */
    assert.match(String(row.because || ''), /who they report to/,
      'the reason must name the block that failed, not just say it failed');
  } finally { try { child.kill(); } catch {} }
  fs.rmSync(sb, { recursive: true, force: true });
});

test('#1684 CONTROL: an agent whose blocks all land is still reported as told', async () => {
  /* The negative arm. A fix that downgraded every row would satisfy the test
     above and be far worse than the bug, so this must stay green: a clean agent
     keeps its `told`. */
  const sb = sandbox({ 'mk-clean-discord': '# An agent\n\nProse.\n' });
  const { child, base } = await boot(sb);
  try {
    const res = await fetch(`${base}/api/you`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Josh', does: 'runs things', know: '' }),
    });
    const body = await res.json();
    const row = (body.told || []).find((t) => t && t.agent === 'mk-clean');
    assert.ok(row, 'the clean agent must appear in told');
    assert.equal(row.state, projects.TOLD.TOLD,
      'an agent whose blocks all landed must still be reported as told');
  } finally { try { child.kill(); } catch {} }
  fs.rmSync(sb, { recursive: true, force: true });
});
