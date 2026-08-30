'use strict';
/**
 * `/api/agent/connections` REFUSES A CROSS-SITE CALLER, AND STILL SERVES THE CLI.
 *
 * 🛑 WHY THIS FILE EXISTS. The guard it covers was added with no test, and a
 * review found that both its lines could be DELETED with the entire 3269-test
 * suite still green. Node's `fetch` sends neither `sec-fetch-site` nor
 * `referer`, so every existing test of this route drives the allowed path only.
 * A guard nothing exercises is indistinguishable from a guard nobody added.
 *
 * WHAT IT PROTECTS. The response is opaque to a web page (CORS blocks the read,
 * the Host guard closes DNS rebinding), so a drive-by page learns nothing. The
 * SIDE EFFECTS are the expensive half: a `claude auth status` subprocess per
 * Claude account and an authenticated `api.openai.com` request carrying the
 * person's real key per OpenAI account. A page the person merely visits could
 * loop that and spend their metered quota with nothing on their machine showing
 * why. So the refusal is asserted at the DOORS, not only in the status code: a
 * 403 that still swept would be the failure this guard exists to prevent.
 *
 * ⚠️ THE SECOND ARM IS NOT A FORMALITY. The comment beside the guard argues it
 * is safe because "the CLI sends neither header". Nothing pinned that. A future
 * tightening of `crossSiteRead` -- refusing requests with NO `sec-fetch-site`,
 * say -- would break `kosmos connections` on every machine with nothing going
 * red. This arm is what makes that tightening go red here instead.
 *
 *   node --test server.agent-crosssite-1034.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentxsite-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const github = require('./engine/github');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* Counts entries into the github door. `server.js` calls `github.state()` off
   the module object, so replacing the property is enough. */
function countedGithub() {
  const real = github.state;
  let entries = 0;
  github.state = async () => { entries += 1; return { connected: false }; };
  return { entries: () => entries, restore() { github.state = real; } };
}

const ask = (headers) => fetch(base + '/api/agent/connections', headers ? { headers } : undefined);

test('a cross-site caller is refused, and the doors are never swept', async () => {
  const g = countedGithub();
  try {
    /* Positive control FIRST: an ordinary call must reach the door, or the
       zero asserted below is the zero of an instrument that never worked. */
    const ok = await ask();
    assert.equal(ok.status, 200, 'the plain request was refused, so this file is measuring the wrong thing');
    const reached = g.entries();
    assert.ok(reached >= 1, 'the plain request never reached the github door, so a later zero would prove nothing');

    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { referer: 'https://evil.example/page' }]) {
      const before = g.entries();
      const res = await ask(headers);
      assert.equal(res.status, 403, `a caller sending ${JSON.stringify(headers)} was served instead of refused`);
      assert.equal(g.entries(), before,
        `the request was refused with 403 and STILL swept the doors for ${JSON.stringify(headers)}: the side effects are the expensive half, so a refusal that sweeps is not a refusal`);
    }
  } finally {
    g.restore();
  }
});

test('a request with no browser headers is still served, which is how the CLI calls it', async () => {
  /**
   * `install/kosmos` shells out to curl and sets neither header (measured:
   * `grep -c 'referer|sec-fetch' install/kosmos` = 0, against a control of 7
   * for headers it does set). If this ever goes red, the guard was tightened
   * and `kosmos connections` is broken on every machine.
   */
  const res = await ask();
  assert.equal(res.status, 200, 'a header-less caller was refused: the CLI path is broken');
  const body = await res.json();
  assert.ok(body && typeof body === 'object', 'the served answer was not an object');
});

test('same-origin and direct navigation are both allowed', async () => {
  for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }]) {
    const res = await ask(headers);
    assert.equal(res.status, 200, `a ${JSON.stringify(headers)} caller was refused; the board's own page sends same-origin`);
  }
});
