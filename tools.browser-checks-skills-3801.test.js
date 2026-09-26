'use strict';

/*
 * #3801: a browser check's fixture board must not read, or WRITE, the host's real global
 * skills. engine/skills.js globalDir() was AGENT_WORKFORCE_SKILLS_DIR || the REAL
 * ~/.claude/skills (os.homedir(), which lib-sandbox-home deliberately leaves alone), and the
 * board's DELETE /api/skills/:key removes from it recursively. Measured on Mortals: a
 * fixture listed 73 real skills in Settings. Two seals, each tested on its own below, each
 * against a real board: the lib names an empty skills folder, and the engine refuses the
 * real folder to any process whose data is in temp while its home is real (the same guard
 * status.js keeps for Claude's config roots).
 *
 *   node --test tools.browser-checks-skills-3801.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'docs', 'browser-checks', 'lib-sandbox-home.js');
const SERVER = path.join(__dirname, 'server.js');
const SKILL = 'planted-3801';
const ADDED = 'added-3801';

/* A "real" home: NOT under the temp dir, or the engine would already take it for a sandbox
   and the arms below would test nothing. Under the repo, removed after. */
function realLookingDir(t, prefix) {
  const d = fs.mkdtempSync(path.join(__dirname, prefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function plantSkill(home) {
  const dir = path.join(home, '.claude', 'skills', SKILL);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${SKILL}\ndescription: a real skill every agent loads\n---\nbody\n`);
  return dir;
}

/* Boot a real board in a child, as a check does: list the global skills, Add one, then press
   Remove on the planted one. `data` decides whether the process looks like a fixture. */
function board({ home, data, withLib }) {
  const code = `
    const fs = require('fs'), path = require('path');
    const D = ${JSON.stringify(data)};
    for (const d of ['data', 'workers', 'projects', 'launch']) fs.mkdirSync(path.join(D, d), { recursive: true });
    Object.assign(process.env, { AGENT_WORKFORCE_DRY_RUN: '1', AGENT_WORKFORCE_CLAUDE_BIN: '/bin/echo', AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_TMUX_BIN: ${JSON.stringify(path.join(__dirname, 'test-support', 'fake-tmux.sh'))},
      AGENT_WORKFORCE_DATA: path.join(D, 'data'), AGENT_WORKFORCE_WORKERS: path.join(D, 'workers'),
      AGENT_WORKFORCE_PROJECTS: path.join(D, 'projects'), AGENT_WORKFORCE_LAUNCH: path.join(D, 'launch'),
      AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(D, 'claude.json'), AGENT_WORKFORCE_HOME: path.join(D, 'home') });
    ${withLib ? `require(${JSON.stringify(LIB)});` : ''}
    const { start, server } = require(${JSON.stringify(SERVER)});
    (async () => {
      await start(0);
      const base = 'http://127.0.0.1:' + server.address().port;
      const list = await (await fetch(base + '/api/skills')).json();
      const add = await fetch(base + '/api/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '${ADDED}', body: 'do the thing' }) });
      const rm = await fetch(base + '/api/skills/${SKILL}', { method: 'DELETE' });
      process.stdout.write('\\nRESULT-3801 ' + JSON.stringify({ names: (list.skills || []).map((s) => s.name || s.slug), addStatus: add.status, removeStatus: rm.status }));
      server.close();
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });`;
  const env = { ...process.env, HOME: home };
  delete env.AGENT_WORKFORCE_SKILLS_DIR;
  const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  /* The board prints its own lines to stdout; the answer is the marked one. */
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT-3801 '));
  assert.ok(line, 'the child reported no result: ' + r.stdout.slice(-300));
  return JSON.parse(line.slice('RESULT-3801 '.length));
}

test('#3801 CONTROL: a board that is not a fixture lists the home\'s skills and Remove deletes one (the exposure is real, and users are unchanged)', (t) => {
  const home = realLookingDir(t, '.aw-3801-home-');
  const skill = plantSkill(home);
  const got = board({ home, data: realLookingDir(t, '.aw-3801-data-'), withLib: false });
  assert.ok(got.names.includes(SKILL), `the planted skill is listed, got ${JSON.stringify(got.names)}`);
  assert.equal(got.addStatus, 200);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', ADDED, 'SKILL.md')), true, 'Add really wrote into the home');
  assert.equal(got.removeStatus, 200);
  assert.equal(fs.existsSync(skill), false, 'and Remove really deleted it from the home');
});

/* What a fixture arm must show: nothing listed, the Add landed but not in the home, the
   Remove found nothing to remove, and the home's skills folder was not touched at all. */
function assertHomeUntouched(got, home, skill, mtimeBefore) {
  assert.deepEqual(got.names, [], '/api/skills is empty');
  assert.equal(got.addStatus, 200, 'the Add went somewhere');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', ADDED)), false, 'but not into the home');
  assert.notEqual(got.removeStatus, 200, 'Remove found no such skill');
  assert.equal(fs.existsSync(path.join(skill, 'SKILL.md')), true, 'the real skill survived a Remove');
  assert.equal(fs.statSync(path.join(home, '.claude', 'skills')).mtimeMs, mtimeBefore, 'the home skills folder is unchanged');
}

/* Data is real-looking here, NOT in temp, so the engine seal below stays off and this arm
   proves the lib's seal alone: without the lib's skills lines it goes red. */
test('#3801: a board requiring lib-sandbox-home lists none of the real home\'s skills, and Add and Remove cannot touch it', (t) => {
  const home = realLookingDir(t, '.aw-3801-home-');
  const skill = plantSkill(home);
  const mtimeBefore = fs.statSync(path.join(home, '.claude', 'skills')).mtimeMs;
  const got = board({ home, data: realLookingDir(t, '.aw-3801-data-'), withLib: true });
  assertHomeUntouched(got, home, skill, mtimeBefore);
});

test('#3801: without the lib, the engine alone still refuses the real folder to a fixture (data in temp, home real)', (t) => {
  const home = realLookingDir(t, '.aw-3801-home-');
  const skill = plantSkill(home);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-3801-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const mtimeBefore = fs.statSync(path.join(home, '.claude', 'skills')).mtimeMs;
  const got = board({ home, data, withLib: false });
  assertHomeUntouched(got, home, skill, mtimeBefore);
});

test('#3801: the lib names a fresh skills folder, replaces the real one, keeps a caller\'s, and removes only its own', () => {
  const real = path.join(os.homedir(), '.claude', 'skills');
  const run = (v) => {
    const env = { ...process.env };
    if (v === undefined) delete env.AGENT_WORKFORCE_SKILLS_DIR; else env.AGENT_WORKFORCE_SKILLS_DIR = v;
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(LIB)}); process.stdout.write(process.env.AGENT_WORKFORCE_SKILLS_DIR);`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const made = run(undefined);
  const tmps = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
  assert.ok(tmps.some((d) => made.startsWith(d)), `unset: a temp folder, got ${made}`);
  assert.equal(fs.existsSync(made), false, 'removed when the process exits');
  assert.notEqual(run(real), real, 'set to the real folder: replaced');
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-3801-mine-'));
  assert.equal(run(mine), mine, 'set to a sandbox: kept');
  assert.equal(fs.existsSync(mine), true, 'and never removed');
  fs.rmSync(mine, { recursive: true, force: true });
});

test('#3801: tools/browser-checks.sh exports its own skills folder before it boots a board', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'tools', 'browser-checks.sh'), 'utf8');
  const at = sh.search(/^if \[ -z "\$\{AGENT_WORKFORCE_SKILLS_DIR:-\}" \] \|\| \[ "\$\{AGENT_WORKFORCE_SKILLS_DIR%\/\}" = "\$\{HOME%\/\}\/\.claude\/skills" \]; then\n\s+export AGENT_WORKFORCE_SKILLS_DIR="\$RUN_DIR\/skills"$/m);
  assert.ok(at > 0, 'the runner exports a sandbox skills folder when none, or the real one, is set');
  assert.ok(at < sh.indexOf('node ./server.js'), 'before it boots its first board');
});

/* The same trap for projects: engine/projects.js reads AGENT_WORKFORCE_PROJECTS || the REAL
   ~/Kosmos/Projects. Without the lib, a check that forgets it is already stopped LOUDLY:
   server.js refuses to boot half-sandboxed (#634). With the lib it boots, and its project
   folder lands in a sandbox, never in the home. */
function boardMakesProject({ home, data, withLib }) {
  const code = `
    const fs = require('fs'), path = require('path');
    const D = ${JSON.stringify(data)};
    for (const d of ['data', 'workers', 'launch']) fs.mkdirSync(path.join(D, d), { recursive: true });
    Object.assign(process.env, { AGENT_WORKFORCE_DRY_RUN: '1', AGENT_WORKFORCE_CLAUDE_BIN: '/bin/echo', AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_TMUX_BIN: ${JSON.stringify(path.join(__dirname, 'test-support', 'fake-tmux.sh'))},
      AGENT_WORKFORCE_DATA: path.join(D, 'data'), AGENT_WORKFORCE_WORKERS: path.join(D, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(D, 'launch'),
      AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(D, 'claude.json'), AGENT_WORKFORCE_HOME: path.join(D, 'home') });
    ${withLib ? `require(${JSON.stringify(LIB)});` : ''}
    const { start, server } = require(${JSON.stringify(SERVER)});
    (async () => {
      await start(0);
      const base = 'http://127.0.0.1:' + server.address().port;
      const r = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Planted 3801' }) });
      const made = await r.json().catch(() => ({}));
      process.stdout.write('\\nRESULT-3801 ' + JSON.stringify({ status: r.status, folder: made.project && made.project.folder }));
      server.close();
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });`;
  const env = { ...process.env, HOME: home };
  delete env.AGENT_WORKFORCE_PROJECTS;
  const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) return { refused: r.stderr };
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT-3801 '));
  assert.ok(line, 'the child reported no result: ' + r.stdout.slice(-300));
  return JSON.parse(line.slice('RESULT-3801 '.length));
}

test('#3801 CONTROL: without the lib, a board with no projects root refuses to start (#634), and makes nothing in the home', (t) => {
  const home = realLookingDir(t, '.aw-3801-home-');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-3801-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const got = boardMakesProject({ home, data, withLib: false });
  assert.match(got.refused || '', /will not start half-sandboxed[^\n]*AGENT_WORKFORCE_PROJECTS/, 'the half-sandbox refusal names the projects folder');
  assert.equal(fs.existsSync(path.join(home, 'Kosmos')), false);
});

test('#3801: with the lib, a check that forgets its projects root never makes a folder in the home', (t) => {
  const home = realLookingDir(t, '.aw-3801-home-');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-3801-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const got = boardMakesProject({ home, data, withLib: true });
  assert.equal(got.refused, undefined, 'the board booted');
  assert.equal(got.status, 200);
  assert.ok(got.folder && !got.folder.startsWith(home), `the folder is outside the home, got ${got.folder}`);
  assert.equal(fs.existsSync(path.join(home, 'Kosmos')), false, 'nothing was made in the home');
});

test('#3801: the lib names a fresh projects folder, replaces the real one, and keeps a caller\'s', () => {
  const real = path.join(os.homedir(), 'Kosmos', 'Projects');
  const run = (v) => {
    const env = { ...process.env };
    if (v === undefined) delete env.AGENT_WORKFORCE_PROJECTS; else env.AGENT_WORKFORCE_PROJECTS = v;
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(LIB)}); process.stdout.write(process.env.AGENT_WORKFORCE_PROJECTS);`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const made = run(undefined);
  const tmps = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
  assert.ok(tmps.some((d) => made.startsWith(d)), `unset: a temp folder, got ${made}`);
  assert.equal(fs.existsSync(made), false, 'removed when the process exits');
  assert.notEqual(run(real), real, 'set to the real folder: replaced');
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-3801-mine-'));
  assert.equal(run(mine), mine, 'set to a sandbox: kept');
  fs.rmSync(mine, { recursive: true, force: true });
});
