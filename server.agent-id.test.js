'use strict';

/**
 * #170: the board payload carries each agent's id, read-only, and never
 * speaks an id minted under another install.
 *
 * Same harness shape as server.leftover-removable.test.js: the real server
 * against a sandboxed store with a stub tmux reporting an empty fleet, so
 * both seeded agents land in the offline roster deterministically. The
 * install id is PINNED by seeding ping.json, because the whole distinction
 * under test is "this install's id" versus "some other install's id".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

/**
 * ⚠️ SLOW IS NOT MISSING (#704). This read the board ONCE, straight after
 * listen, and parsed whatever came back as a roster. Under load the stub
 * tmux's spawn stalled past the engine's 5-second look timeout, the board
 * answered 500 "we could not see what is running", and the assertion said
 * "the seeded agent is missing" about a roster that was never read (5092 ms,
 * 2026-08-24). The child now polls until both seeded names are on the board
 * or a deadline passes, and a failure names what last came back, so a look
 * that failed and an agent that is absent are different sentences.
 *
 * `tmuxScript` is the stub's body; the default reports an empty fleet.
 */
function boardWithSeededIds(tmuxScript) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-id-'));
  const data = nodePath.join(sb, 'data');
  const profiles = nodePath.join(data, 'AgentWorkforce', 'profiles');
  const workers = nodePath.join(sb, 'workers');
  fs.mkdirSync(profiles, { recursive: true });

  // Pin this sandbox's install id BEFORE the server ever runs.
  fs.writeFileSync(nodePath.join(data, 'ping.json'),
    JSON.stringify({ installId: 'install-under-test' }));

  // `homegrown`: minted HERE. The board must carry its id.
  fs.writeFileSync(nodePath.join(profiles, 'homegrown.json'),
    JSON.stringify({ role: 'PM', id: 'aabbccddeeff', idInstall: 'install-under-test' }));
  // `blowin`: the same file shape restored from ANOTHER machine. The board
  // must answer null, because speaking that id would name a different
  // agent (the decided restore semantics: fresh id on first local write).
  fs.writeFileSync(nodePath.join(profiles, 'blowin.json'),
    JSON.stringify({ role: 'PM', id: '112233445566', idInstall: 'someone-elses-install' }));
  // Worker folders, so the survey shows both as offline agents.
  fs.mkdirSync(nodePath.join(workers, 'homegrown'), { recursive: true });
  fs.mkdirSync(nodePath.join(workers, 'blowin'), { recursive: true });

  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), tmuxScript || '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    const WANT = ['homegrown', 'blowin'];
    const DEADLINE_MS = 20000, EVERY_MS = 250;
    const t0 = Date.now(); let tries = 0, last = null;
    const done = (why) => {
      process.stdout.write(JSON.stringify({ why, tries, ms: Date.now() - t0, code: last && last.code, body: last && last.body }));
      srv.close(); process.exit(0);
    };
    const look = () => {
      tries += 1;
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          let body = null; try { body = JSON.parse(s); } catch { body = { unparsable: s.slice(0, 200) }; }
          last = { code: res.statusCode, body };
          const names = new Set(((body && body.agents) || []).map((a) => a.sessionName));
          if (res.statusCode === 200 && WANT.every((n) => names.has(n))) return done('present');
          if (Date.now() - t0 > DEADLINE_MS) return done('deadline');
          setTimeout(look, EVERY_MS);
        });
      }).on('error', () => { last = { code: null, body: { error: 'the request itself failed' } }; setTimeout(look, EVERY_MS); });
    };
    srv.listen(0, '127.0.0.1', look);
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_DATA: data,
      AGENT_WORKFORCE_WORKERS: workers,
      AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

/* The sentence a failed poll leaves behind: which of "could not look" and
   "not on the board" it was, with the board's own words for the first. */
function explain(got) {
  const b = got.body || {};
  if (got.code !== 200 || b.error) {
    return 'the board could not be read after ' + got.tries + ' tries in ' + got.ms + ' ms: HTTP ' + got.code
      + ' ' + String(b.error || '') + (b.detail ? ' (' + b.detail + ')' : '') + '. That is a failed look, not a missing agent.';
  }
  return 'after ' + got.tries + ' tries in ' + got.ms + ' ms the board answered but the roster lacks a seeded name: '
    + JSON.stringify((b.agents || []).map((a) => a.sessionName));
}

test('#170: the board carries this install\'s agent ids and refuses to speak another install\'s', () => {
  const got = boardWithSeededIds();
  assert.equal(got.why, 'present', explain(got));
  const status = got.body;
  const row = (name) => (status.agents || []).find((a) => a.sessionName === name);

  const homegrown = row('homegrown');
  assert.ok(homegrown, 'the seeded agent is missing from the roster, so this proved nothing');
  assert.equal(homegrown.id, 'aabbccddeeff', 'the board dropped or rewrote the minted id');

  const blowin = row('blowin');
  assert.ok(blowin, 'the restored agent is missing from the roster, so this proved nothing');
  assert.equal(blowin.id, null,
    "the board spoke another install's id, which names a different agent (#170's decided restore semantics)");
  /* The embedded profile may still carry the foreign id verbatim; the
     top-level field is the filtered one consumers read. Pinned so a future
     "simplification" to `profile.id` goes red here. */
  assert.equal(blowin.profile && blowin.profile.id, '112233445566',
    'the fixture stopped seeding a foreign id, so the null above is vacuous');
});

test('#704: a look that fails and then recovers is waited out, not reported as a missing agent', () => {
  /* The stub refuses its first three calls (the engine answers 500 "we could
     not see what is running") and reports an empty fleet from the fourth. A
     single read would have called the seeded agents missing; the poll rides
     over the failed looks and reaches the roster. No sleep in the stub: the
     failed look is what is under test, not the timeout that causes one. */
  const stub = '#!/bin/sh\nC="$(dirname "$0")/calls"\nn=$(cat "$C" 2>/dev/null || echo 0)\nn=$((n+1))\necho $n > "$C"\n[ "$n" -le 3 ] && exit 1\nexit 0\n';
  const got = boardWithSeededIds(stub);
  assert.equal(got.why, 'present', explain(got));
  assert.ok(got.tries > 1, 'the stub was meant to fail first, but the first look succeeded: the seam did not engage');
  const names = got.body.agents.map((a) => a.sessionName).sort();
  assert.deepEqual(names, ['blowin', 'homegrown']);
});
