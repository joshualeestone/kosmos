'use strict';
/**
 * #2096 -- /api/status carries `dependsOnClaude` so an OpenAI-only machine is not
 * warned about a missing Claude subscription. True iff a Claude account is
 * configured OR an agent is not positively a codex runner; false only when we can
 * positively confirm neither. This pins the SERVER half (the frontend guard is in
 * web.openai-only-banner-2096.test.js).
 *
 *   node --test server.depends-on-claude-2096.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

function statusWith({ claudeAccount }) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-doc-2096-'));
  const HOME = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });
  // A default Claude account is a `.claude.json` beside ~/.claude. Absent = OpenAI-only.
  if (claudeAccount) {
    fs.writeFileSync(nodePath.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'her@example.com' } }));
  }
  fs.mkdirSync(nodePath.join(sb, 'workers'), { recursive: true });
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => { process.stdout.write(s); srv.close(); process.exit(0); });
      });
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
      AGENT_WORKFORCE_HOME: HOME,
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
      AGENT_WORKFORCE_CLAUDE_CONFIG: nodePath.join(sb, 'claude-config.json'),
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

test('a configured Claude account -> dependsOnClaude true (the warning is warranted)', () => {
  assert.equal(statusWith({ claudeAccount: true }).dependsOnClaude, true);
});

test('OpenAI-only (no Claude account, no non-codex agents) -> dependsOnClaude false (no warning)', () => {
  assert.equal(statusWith({ claudeAccount: false }).dependsOnClaude, false);
});
