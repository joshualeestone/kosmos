'use strict';
/**
 * #2096 / #2128 -- /api/status carries `dependsOnClaude` so an OpenAI-only machine
 * is not warned about a missing Claude subscription.
 *
 * #2096 keyed it on (a Claude account is configured) OR (some agent is not
 * positively codex). #2128 REVERSES the account term: Josh's live OpenAI-only test
 * reddened every page because his dev box has a real ~/.claude account he depends
 * on for nothing. The rule is now AGENT-only, in `someAgentNeedsClaude`: true iff
 * some agent is not positively an OpenAI (codex) runner; an unknown runner
 * ('' / 'claude' / undefined) still counts, so a real Claude failure is never
 * hidden; no agents (fresh install) or every agent codex -> false.
 *
 * The four cases are pinned DIRECTLY against `someAgentNeedsClaude` (the HTTP
 * harness cannot inject agents). The HTTP arm then proves the server is wired to
 * that predicate and that a merely-configured account no longer forces the warning.
 * The frontend guard is in web.openai-only-banner-2096.test.js.
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
const { someAgentNeedsClaude } = require('./server.js');

// --- The four cases, pinned directly on the predicate (#2128). ---

test('some agent is not positively codex (unknown runner) -> true', () => {
  assert.equal(someAgentNeedsClaude([{ runner: 'codex' }, { runner: '' }]), true);
});

test('an agent with a claude runner -> true', () => {
  assert.equal(someAgentNeedsClaude([{ runner: 'claude' }]), true);
});

test('an agent with no runner field -> true (unknown counts as Claude-dependent)', () => {
  assert.equal(someAgentNeedsClaude([{ name: 'a' }]), true);
});

test('every agent positively codex -> false', () => {
  assert.equal(someAgentNeedsClaude([{ runner: 'codex' }, { runner: 'codex' }]), false);
});

test('no agents at all (fresh install) -> false', () => {
  assert.equal(someAgentNeedsClaude([]), false);
});

test('a non-array (defensive) -> false', () => {
  assert.equal(someAgentNeedsClaude(null), false);
  assert.equal(someAgentNeedsClaude(undefined), false);
});

// --- The HTTP arm: the server is wired to the predicate, and a merely-configured
//     Claude account no longer forces the warning (#2128's regression). Both
//     fixtures run with no agents, so both are false; the discriminator is the
//     direct cases above. ---

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

test('#2128: a configured Claude account with NO agents -> dependsOnClaude false (the regression Josh hit)', () => {
  assert.equal(statusWith({ claudeAccount: true }).dependsOnClaude, false);
});

test('OpenAI-only (no Claude account, no non-codex agents) -> dependsOnClaude false (no warning)', () => {
  assert.equal(statusWith({ claudeAccount: false }).dependsOnClaude, false);
});
