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

function boardWithSeededIds() {
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
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          process.stdout.write(s); srv.close(); process.exit(0);
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
      AGENT_WORKFORCE_DATA: data,
      AGENT_WORKFORCE_WORKERS: workers,
      AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

test('#170: the board carries this install\'s agent ids and refuses to speak another install\'s', () => {
  const status = boardWithSeededIds();
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
