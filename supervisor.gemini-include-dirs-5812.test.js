'use strict';
/**
 * #5812: bin/agent-supervisor.sh launches a gemini agent with --include-directories for each
 * folder of a project it is on (engine/geminidirs.js). This EXECUTES the shipped script from a
 * temp tree (engine symlinked beside it, as installed) with a recorder fake tmux, and reads the
 * launch argv tmux was given.
 *
 *   node --test supervisor.gemini-include-dirs-5812.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-gemdirs-5812-')));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function run({ runner = 'gemini', projects, trust, session = 'gem-agent', world }) {
  const tree = fs.mkdtempSync(nodePath.join(SANDBOX, 'tree-'));
  fs.mkdirSync(nodePath.join(tree, 'bin'), { recursive: true });
  fs.symlinkSync(nodePath.join(__dirname, 'engine'), nodePath.join(tree, 'engine'));
  fs.symlinkSync(SUP, nodePath.join(tree, 'bin', 'agent-supervisor.sh'));
  const work = nodePath.join(tree, 'work');
  fs.mkdirSync(work);
  const data = nodePath.join(tree, 'data');
  const env = { PATH: process.env.PATH, HOME: tree, AGENT_WORKFORCE_HOME: tree, AGENT_WORKFORCE_DATA: data, REC: nodePath.join(tree, 'rec.txt') };
  if (world) env.KOSMOS_WORLD = world;
  /* The store root the supervisor's own node will read: the world's, when it has one. */
  const root = spawnSync(process.execPath, ['-e',
    'require(process.argv[1]).applyAgentWorldEnv(process.env); process.stdout.write(require(process.argv[2]).ROOT)',
    nodePath.join(__dirname, 'engine', 'worlds.js'), nodePath.join(__dirname, 'engine', 'store.js')], { env, encoding: 'utf8' }).stdout;
  assert.ok(root && root.startsWith(data), 'the store root is in the sandbox: ' + root);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(nodePath.join(root, 'projects.json'), JSON.stringify(projects));
  if (trust) {
    fs.mkdirSync(nodePath.join(tree, '.gemini'), { recursive: true });
    fs.writeFileSync(nodePath.join(tree, '.gemini', 'trustedFolders.json'), JSON.stringify(trust));
  }
  const fake = nodePath.join(tree, 'rec-tmux.sh');
  /* new-session's argv, one argument per line in $REC.args, so an argument holding a space shows whole. */
  fs.writeFileSync(fake, ['#!/bin/bash', 'case "$1" in', '  new-session) printf "%s\\n" "$*" >> "$REC"; printf "%s\\n" "$@" >> "$REC.args"; exit 0 ;;', '  has-session) exit 1 ;;', '  *) exit 0 ;;', 'esac'].join('\n') + '\n', { mode: 0o755 });
  const r = spawnSync('/bin/bash', [nodePath.join(tree, 'bin', 'agent-supervisor.sh'), session, work, '/usr/bin/true', fake, '', 'gemini-2.5-flash', runner], { env, encoding: 'utf8', timeout: 30000 });
  const rec = fs.existsSync(env.REC) ? fs.readFileSync(env.REC, 'utf8') : '';
  const theirFile = nodePath.join(tree, '.gemini', 'trustedFolders.json');
  const theirs = fs.existsSync(theirFile) ? JSON.parse(fs.readFileSync(theirFile, 'utf8')) : null;
  const m = /-e GEMINI_CLI_TRUSTED_FOLDERS_PATH=(\S+)/.exec(rec);
  const agentFile = m ? m[1] : null;
  const agentTrust = agentFile && fs.existsSync(agentFile) ? JSON.parse(fs.readFileSync(agentFile, 'utf8')) : null;
  const args = fs.existsSync(env.REC + '.args') ? fs.readFileSync(env.REC + '.args', 'utf8').split('\n') : [];
  return { rec, args, stderr: r.stderr || '', tree, root, theirs, agentFile, agentTrust };
}

test('a gemini agent on a project launches with that project\'s folder in its workspace', () => {
  const proj = nodePath.join(SANDBOX, 'proj-a');
  fs.mkdirSync(proj, { recursive: true });
  const other = nodePath.join(SANDBOX, 'proj-b');
  fs.mkdirSync(other, { recursive: true });
  const out = run({ projects: [{ name: 'A', folder: proj, agents: ['gem-agent'] }, { name: 'B', folder: other, agents: ['someone'] }] });
  assert.ok(out.rec.includes('new-session'), 'the gemini arm reached tmux: ' + out.stderr.slice(-400));
  assert.ok(out.rec.includes('--approval-mode yolo --skip-trust -m gemini-2.5-flash --include-directories ' + proj), out.rec);
  assert.ok(!out.rec.includes(other), 'a project the agent is not on is not included');
  assert.ok(out.agentFile && out.agentFile.startsWith(nodePath.join(out.root, 'gemini-trust')), 'the pane is given the agent\'s own trust file: ' + out.rec);
  assert.deepEqual(out.agentTrust, { [proj]: 'TRUST_FOLDER' }, 'holding its folder, so gemini asks nothing');
  assert.equal(out.theirs, null, 'the person\'s trust file is not created');
});

test('a missing project folder is left out of the launch and logged; the agent still launches', () => {
  const gone = nodePath.join(SANDBOX, 'gone-folder');
  const out = run({ projects: [{ name: 'G', folder: gone, agents: ['gem-agent'] }] });
  assert.ok(out.rec.includes('new-session'));
  assert.ok(!out.rec.includes('--include-directories'), out.rec);
  assert.ok(!out.rec.includes('GEMINI_CLI_TRUSTED_FOLDERS_PATH'), 'no folders, so gemini keeps its usual trust file');
  assert.match(out.stderr, /#5812: the project folder .*gone-folder was left out .*not there/);
});

test('a folder the person marked do not trust in Gemini is left out, logged, and its record kept', () => {
  const proj = nodePath.join(SANDBOX, 'proj-deny');
  fs.mkdirSync(proj, { recursive: true });
  const out = run({ projects: [{ name: 'D', folder: proj, agents: ['gem-agent'] }], trust: { [proj]: 'DO_NOT_TRUST' } });
  assert.ok(out.rec.includes('new-session'));
  assert.ok(!out.rec.includes('--include-directories'), out.rec);
  assert.match(out.stderr, /proj-deny was left out .*do not trust/);
  assert.deepEqual(out.theirs, { [proj]: 'DO_NOT_TRUST' }, 'their record kept as it was');
  assert.equal(out.agentFile, null, 'no folders, no trust file for the pane');
});

test('an agent in a named world is matched by its roster name, not its world launch key', () => {
  const proj = nodePath.join(SANDBOX, 'proj-world');
  fs.mkdirSync(proj, { recursive: true });
  const out = run({ projects: [{ name: 'W', folder: proj, agents: ['gem-agent'] }], session: 'gem-agent+w5812', world: 'w5812' });
  assert.ok(out.rec.includes('new-session'), out.stderr.slice(-400));
  assert.ok(out.rec.includes('--include-directories ' + proj), out.rec);
});

test('a -discord launch key is matched by its roster name too', () => {
  const proj = nodePath.join(SANDBOX, 'proj-discord');
  fs.mkdirSync(proj, { recursive: true });
  const out = run({ projects: [{ name: 'X', folder: proj, agents: ['gem-agent'] }], session: 'gem-agent-discord' });
  assert.ok(out.rec.includes('new-session'), out.stderr.slice(-400));
  assert.ok(out.rec.includes('--include-directories ' + proj), out.rec);
});

test('a project folder with spaces in its path reaches the launch as one argument', () => {
  const proj = nodePath.join(SANDBOX, 'My Projects', 'a b');
  fs.mkdirSync(proj, { recursive: true });
  const out = run({ projects: [{ name: 'S', folder: proj, agents: ['gem-agent'] }] });
  const i = out.args.indexOf('--include-directories');
  assert.ok(i >= 0 && out.args[i + 1] === proj, JSON.stringify(out.args.slice(-6)));
});

test('a grok agent gets no gemini folders', () => {
  const proj = nodePath.join(SANDBOX, 'proj-grok');
  fs.mkdirSync(proj, { recursive: true });
  const out = run({ runner: 'grok', projects: [{ name: 'K', folder: proj, agents: ['gem-agent'] }] });
  assert.ok(out.rec.includes('new-session'));
  assert.ok(!out.rec.includes('--include-directories'), out.rec);
});
