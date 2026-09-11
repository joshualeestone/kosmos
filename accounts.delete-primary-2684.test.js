'use strict';
/*
 * #2684: allow removing the PRIMARY/default (.claude) Claude connection.
 *
 * The primary's identity is the `oauthAccount` key in <HOME>/.claude.json, NOT
 * inside the `.claude` dir. So removing the primary must surgically delete ONLY
 * that key and leave the dir + every other config key intact. These are
 * FIXTURE-ONLY tests: AGENT_WORKFORCE_HOME is pointed at a fresh temp dir, so
 * nothing here ever reads or writes the real ~/.claude.json.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const accounts = require('./engine/accounts');

/* Build a throwaway HOME with a primary .claude dir + a .claude.json carrying an
   oauthAccount alongside unrelated config we must not lose. Returns the paths. */
function makeHome(extraConfig) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-delprimary-2684-'));
  const dir = path.join(home, '.claude');
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  /* a real transcript under projects/, to prove the dir (and any shared history
     under it) is never touched by clearing the identity. */
  fs.writeFileSync(path.join(dir, 'projects', 'keep.jsonl'), '{"kept":true}\n');
  const cfg = path.join(home, '.claude.json');
  const base = {
    oauthAccount: { emailAddress: 'josh@book.io', organizationName: 'Book.io' },
    mcpServers: { some: { command: 'x' } },
    projects: { '/work': { lastUsed: 1 } },
    numStartups: 42,
  };
  fs.writeFileSync(cfg, JSON.stringify(Object.assign(base, extraConfig || {}), null, 2) + '\n');
  return { home, dir, cfg };
}

function withHome(home, fn) {
  const prev = process.env.AGENT_WORKFORCE_HOME;
  process.env.AGENT_WORKFORCE_HOME = home;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = prev;
  }
}

test('removeAccount clears ONLY oauthAccount from .claude.json and leaves the dir + other keys', () => {
  const { home, dir, cfg } = makeHome();
  const res = withHome(home, () => accounts.removeAccount(dir, []));

  assert.strictEqual(res.ok, true, 'ok');
  assert.strictEqual(res.removed, true, 'removed');
  assert.strictEqual(res.wasDefault, true, 'wasDefault');
  assert.strictEqual(res.defaultCleared, true, 'defaultCleared (there was an identity)');

  // The config file survives, oauthAccount is gone, everything else round-trips.
  assert.ok(fs.existsSync(cfg), '.claude.json still exists');
  const after = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.ok(!('oauthAccount' in after), 'oauthAccount removed');
  assert.deepStrictEqual(after.mcpServers, { some: { command: 'x' } }, 'mcpServers preserved');
  assert.deepStrictEqual(after.projects, { '/work': { lastUsed: 1 } }, 'projects preserved');
  assert.strictEqual(after.numStartups, 42, 'numStartups preserved');

  // The dir and its history are untouched.
  assert.ok(fs.existsSync(dir), '.claude dir survives');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'projects', 'keep.jsonl'), 'utf8'), '{"kept":true}\n', 'history untouched');

  // The connection is now gone from the list.
  const gone = withHome(home, () => accounts.identityOf(dir));
  assert.strictEqual(gone, null, 'identityOf(primary) is null after removal');
});

test('forgetAccount (disconnect door) clears the primary identity the same way', () => {
  const { home, dir, cfg } = makeHome();
  const res = withHome(home, () => accounts.forgetAccount(dir, []));
  assert.strictEqual(res.ok, true, 'ok');
  assert.strictEqual(res.forgotten, true, 'forgotten');
  assert.strictEqual(res.wasDefault, true, 'wasDefault');
  const after = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.ok(!('oauthAccount' in after), 'oauthAccount removed');
  assert.strictEqual(after.numStartups, 42, 'unrelated config preserved');
  assert.ok(fs.existsSync(dir), '.claude dir survives');
});

test('CONTROL: a running agent on the primary REFUSES and leaves .claude.json untouched', () => {
  const { home, dir, cfg } = makeHome();
  const before = fs.readFileSync(cfg, 'utf8');
  const res = withHome(home, () => accounts.removeAccount(dir, ['lestrade']));
  assert.strictEqual(res.ok, false, 'refused');
  assert.strictEqual(res.removed, false, 'not removed');
  assert.deepStrictEqual(res.usedBy, ['lestrade'], 'names the agent');
  assert.match(res.because, /lestrade/, 'reason names the agent');
  assert.strictEqual(fs.readFileSync(cfg, 'utf8'), before, '.claude.json byte-identical (oauthAccount still present)');
  assert.ok(JSON.parse(before).oauthAccount, 'oauthAccount still present');
});

test('CONTROL: an unparseable .claude.json REFUSES rather than corrupting it', () => {
  const { home, dir, cfg } = makeHome();
  fs.writeFileSync(cfg, '{ this is : not json,,,'); // corrupt on purpose
  const before = fs.readFileSync(cfg, 'utf8');
  const res = withHome(home, () => accounts.removeAccount(dir, []));
  assert.strictEqual(res.ok, false, 'refused');
  assert.strictEqual(res.removed, false, 'not removed');
  assert.match(res.because, /could not read/i, 'says it could not read the config');
  assert.strictEqual(fs.readFileSync(cfg, 'utf8'), before, 'corrupt file left byte-identical, never rewritten');
});

test('a primary with NO oauthAccount is a quiet success (already disconnected), other keys intact', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-delprimary-2684-noid-'));
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(home, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { some: { command: 'x' } }, numStartups: 7 }, null, 2) + '\n');
  const res = withHome(home, () => accounts.removeAccount(dir, []));
  assert.strictEqual(res.ok, true, 'ok');
  assert.strictEqual(res.removed, true, 'removed');
  assert.strictEqual(res.defaultCleared, false, 'defaultCleared false: there was no identity to clear');
  const after = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.deepStrictEqual(after, { mcpServers: { some: { command: 'x' } }, numStartups: 7 }, 'config unchanged');
});

test('CONTROL: a SECONDARY account is still deleted by directory removal, not identity-clearing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-delprimary-2684-sec-'));
  const dir = path.join(home, '.claude-work');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'work@example.com' } }));
  // a primary must exist for homeDir semantics, but is irrelevant here
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'primary@example.com' } }, null, 2));
  const res = withHome(home, () => accounts.removeAccount(dir, []));
  assert.strictEqual(res.ok, true, 'ok');
  assert.strictEqual(res.removed, true, 'removed');
  assert.ok(!res.wasDefault, 'not the default');
  assert.ok(!fs.existsSync(dir), 'the secondary dir is deleted (dir-removal path, unchanged)');
  // the PRIMARY identity is untouched by a secondary delete
  const primary = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.ok(primary.oauthAccount, 'primary identity untouched');
});
