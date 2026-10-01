'use strict';

/*
 * kosmos#4909 (found by April while fixing the red that aborted the 0.7.16 cut): tools/browser-checks.sh made ONE home
 * for the whole run, and lib-sandbox-home.js kept any home a caller had set, so every check that boots its own board
 * shared it. An OpenAI-only account one check left there flipped render-teamcreate-4557 on a correct page. Now the
 * runner marks its run-wide home and skills folder (KOSMOS_BC_RUN_HOME / KOSMOS_BC_RUN_SKILLS); the lib gives a check a
 * fresh one when it was handed the run's, and keeps a home set for that check alone. Boards the runner boots get their
 * own under their sandbox (board_home / board_skills).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'docs', 'browser-checks', 'lib-sandbox-home.js');
const RUNNER = path.join(__dirname, 'tools', 'browser-checks.sh');
const AMBIENT = ['AGENT_WORKFORCE_HOME', 'AGENT_WORKFORCE_SKILLS_DIR', 'AGENT_WORKFORCE_CLAUDE_CONFIG', 'KOSMOS_BC_RUN_HOME',
  'KOSMOS_BC_RUN_SKILLS', 'KOSMOS_BC_SEED_HOME', 'CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'GROK_HOME', 'CLAUDE_CONFIG_DIR'];

/* What a check process ends up with after requiring the lib, given the env it starts with. */
function afterLib(over) {
  const env = { ...process.env };
  for (const v of AMBIENT) delete env[v];
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(LIB)}); process.stdout.write(JSON.stringify({ home: process.env.AGENT_WORKFORCE_HOME, skills: process.env.AGENT_WORKFORCE_SKILLS_DIR }))`],
    { env: { ...env, ...over }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('#4909: a check handed the RUN\'s home or skills folder gets fresh ones; a home set for that check alone is kept', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-run-4909-'));
  try {
    const runHome = path.join(run, 'home');
    const runSkills = path.join(run, 'skills');
    fs.mkdirSync(runHome); fs.mkdirSync(runSkills);
    const handed = afterLib({ AGENT_WORKFORCE_HOME: runHome, KOSMOS_BC_RUN_HOME: runHome, AGENT_WORKFORCE_SKILLS_DIR: runSkills, KOSMOS_BC_RUN_SKILLS: runSkills });
    assert.notEqual(handed.home, runHome, 'a check kept the run-wide home, so it shares what other checks leave there');
    assert.notEqual(handed.skills, runSkills, 'a check kept the run-wide skills folder');
    // Two checks handed the same run home get two different homes.
    const other = afterLib({ AGENT_WORKFORCE_HOME: runHome, KOSMOS_BC_RUN_HOME: runHome });
    assert.notEqual(other.home, handed.home, 'two checks were given the same home');
    // CONTROL: the same home with no run marker is a caller's choice for this check, and is kept (as before #4909).
    const own = afterLib({ AGENT_WORKFORCE_HOME: runHome, AGENT_WORKFORCE_SKILLS_DIR: runSkills });
    assert.equal(own.home, runHome);
    assert.equal(own.skills, runSkills);
  } finally { fs.rmSync(run, { recursive: true, force: true }); }
});

test('#4909: the runner marks only the home and skills it made, and every board it boots has its own home and skills', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  assert.match(src, /export AGENT_WORKFORCE_HOME="\$RUN_DIR\/home"[\s\S]{0,600}export KOSMOS_BC_RUN_HOME="\$AGENT_WORKFORCE_HOME"/,
    'the run-wide home is not marked where the runner makes it');
  assert.match(src, /export AGENT_WORKFORCE_SKILLS_DIR="\$RUN_DIR\/skills"[\s\S]{0,200}export KOSMOS_BC_RUN_SKILLS=/);
  /* Every line that starts the board's server.js in a function body must be preceded, in the same command, by the
     own-home prefix. Counted, so a new boot function cannot be added without it. */
  const boots = src.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => /node \.\/server\.js/.test(l) && !/^\s*#/.test(l));
  assert.ok(boots.length >= 8, 'the scan found ' + boots.length + ' board boots; it is not seeing them');
  const lines = src.split('\n');
  for (const { i } of boots) {
    let j = i;
    while (j > 0 && /\\\s*$/.test(lines[j - 1])) j -= 1;   // back to the start of this continued command
    const cmd = lines.slice(j, i + 1).join('\n');
    // Its own home: through board_home, or one named for this board alone (AGENT_WORKFORCE_HOME="$sb8/home"), and
    // never the run's. Review 1: the sandbox named must be THIS boot's (the one its AGENT_WORKFORCE_DATA uses).
    const data = cmd.match(/AGENT_WORKFORCE_DATA="\$(\w+)\/data"/);
    assert.ok(data, 'a board boot at line ' + (i + 1) + ' names no data sandbox');
    const sb = data[1];
    const own = new RegExp('AGENT_WORKFORCE_HOME="(\\$\\(board_home "\\$' + sb + '"\\)|\\$' + sb + '\\/home)"');
    const ownSkills = new RegExp('AGENT_WORKFORCE_SKILLS_DIR="(\\$\\(board_skills "\\$' + sb + '"\\)|\\$' + sb + '\\/skills)"');
    assert.match(cmd, own, 'a board boot at line ' + (i + 1) + ' does not have its own home ($' + sb + ')');
    assert.match(cmd, ownSkills, 'a board boot at line ' + (i + 1) + ' does not have its own skills ($' + sb + ')');
    assert.doesNotMatch(cmd, /AGENT_WORKFORCE_HOME="\$RUN_DIR/, 'a board boot at line ' + (i + 1) + ' is given the run home');
  }
});

test('#4909: board_home gives a board its own home only when it would inherit the run\'s', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const fn = (name) => src.match(new RegExp('^' + name + '\\(\\) \\{[\\s\\S]*?^\\}', 'm'))[0];
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sb-4909-'));
  try {
    const run = (env) => spawnSync('bash', ['-c', 'set -uo pipefail\n' + fn('board_home') + '\nboard_home "$1"', 'x', sb], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }).stdout;
    assert.equal(run({ AGENT_WORKFORCE_HOME: '/run/home', KOSMOS_BC_RUN_HOME: '/run/home' }), sb + '/home');
    assert.ok(fs.existsSync(path.join(sb, 'home')), 'the board\'s own home was not made');
    // CONTROL: a home the caller set for this board is kept.
    assert.equal(run({ AGENT_WORKFORCE_HOME: '/mine', KOSMOS_BC_RUN_HOME: '/run/home' }), '/mine');
    assert.equal(run({ AGENT_WORKFORCE_HOME: '/mine' }), '/mine');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});

test('#4909 review 1: the control\'s seed reaches a check\'s own home when it was handed the run\'s, and only then', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-seed-4909-'));
  try {
    const runHome = path.join(run, 'home'); fs.mkdirSync(runHome);
    const seed = path.join(run, 'seed'); fs.mkdirSync(path.join(seed, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(seed, '.codex', 'auth.json'), '{"auth_mode":"chatgpt"}');
    const env = { ...process.env };
    for (const v of AMBIENT) delete env[v];
    const probe = `require(${JSON.stringify(LIB)}); const fs=require('fs'),p=require('path'); process.stdout.write(String(fs.existsSync(p.join(process.env.AGENT_WORKFORCE_HOME,'.codex','auth.json'))))`;
    const seeded = spawnSync(process.execPath, ['-e', probe], { env: { ...env, AGENT_WORKFORCE_HOME: runHome, KOSMOS_BC_RUN_HOME: runHome, KOSMOS_BC_SEED_HOME: seed }, encoding: 'utf8' });
    assert.equal(seeded.stdout, 'true', 'the seed did not reach the check\'s own home: ' + seeded.stderr);
    // CONTROL: no seed, no account.
    const clean = spawnSync(process.execPath, ['-e', probe], { env: { ...env, AGENT_WORKFORCE_HOME: runHome, KOSMOS_BC_RUN_HOME: runHome }, encoding: 'utf8' });
    assert.equal(clean.stdout, 'false');
  } finally { fs.rmSync(run, { recursive: true, force: true }); }
});

test('#4909 review 1: release.sh clears the seed at both page-check sites, so a cut is never a seeded run', () => {
  const rel = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const sites = rel.split('\n').filter((l) => /bash tools\/browser-checks\.sh/.test(l) && !/^\s*#/.test(l));
  assert.ok(sites.length >= 2, 'found ' + sites.length + ' page-check sites');
  for (const l of sites) assert.match(l, /-u KOSMOS_BC_SEED_HOME/, 'a cut site keeps the seed: ' + l.trim());
});

test('#4909 review 2: board_home seeds the board\'s own home once; a failed copy is recorded for the summary, not an exit', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const fn = src.match(/^board_home\(\) \{[\s\S]*?^\}/m)[0];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-seedboard-4909-'));
  try {
    const sb = path.join(tmp, 'sb'); fs.mkdirSync(sb);
    const runDir = path.join(tmp, 'run'); fs.mkdirSync(runDir);
    const seed = path.join(tmp, 'seed'); fs.mkdirSync(path.join(seed, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(seed, '.codex', 'auth.json'), '{"auth_mode":"chatgpt"}');
    const run = (env) => spawnSync('bash', ['-c', 'set -uo pipefail\n' + fn + '\nboard_home "$1"', 'x', sb], { env: { PATH: process.env.PATH, RUN_DIR: runDir, AGENT_WORKFORCE_HOME: '/run/home', KOSMOS_BC_RUN_HOME: '/run/home', ...env }, encoding: 'utf8' });
    assert.equal(run({ KOSMOS_BC_SEED_HOME: seed }).stdout, sb + '/home');
    assert.ok(fs.existsSync(path.join(sb, 'home', '.codex', 'auth.json')), 'the board\'s own home was not seeded');
    // Once: a second boot on the same sandbox does not overwrite what the board wrote, nor restore what it removed.
    fs.writeFileSync(path.join(sb, 'home', '.codex', 'auth.json'), 'written by the board');
    run({ KOSMOS_BC_SEED_HOME: seed });
    assert.equal(fs.readFileSync(path.join(sb, 'home', '.codex', 'auth.json'), 'utf8'), 'written by the board');
    fs.rmSync(path.join(sb, 'home', '.codex'), { recursive: true });
    run({ KOSMOS_BC_SEED_HOME: seed });
    assert.equal(fs.existsSync(path.join(sb, 'home', '.codex')), false, 'a board that emptied its home was seeded again');
    // A caller-set home is returned as it is and nothing is copied.
    const mine = path.join(tmp, 'mine'); fs.mkdirSync(mine);
    const own = spawnSync('bash', ['-c', 'set -uo pipefail\n' + fn + '\nboard_home "$1"', 'x', path.join(tmp, 'sb3')], { env: { PATH: process.env.PATH, RUN_DIR: runDir, AGENT_WORKFORCE_HOME: mine, KOSMOS_BC_RUN_HOME: '/run/home', KOSMOS_BC_SEED_HOME: seed }, encoding: 'utf8' });
    assert.equal(own.stdout, mine);
    assert.deepEqual(fs.readdirSync(mine), [], 'a caller\'s own home was seeded');
    // A copy that fails still hands the board ITS OWN home (never an empty one) and leaves the marker.
    const sb2 = path.join(tmp, 'sb2'); fs.mkdirSync(sb2);
    const r = spawnSync('bash', ['-c', 'set -uo pipefail\n' + fn + '\nboard_home "$1"', 'x', sb2], { env: { PATH: process.env.PATH, RUN_DIR: runDir, AGENT_WORKFORCE_HOME: '/run/home', KOSMOS_BC_RUN_HOME: '/run/home', KOSMOS_BC_SEED_HOME: path.join(tmp, 'no-such-seed') }, encoding: 'utf8' });
    assert.equal(r.stdout, sb2 + '/home', 'a failed seed handed the board something other than its own home');
    assert.ok(fs.existsSync(path.join(runDir, 'seed-failed')), 'a failed seed copy was not recorded');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // The summary turns the marker into a failure, before it decides the run's result.
  const at = src.indexOf('if [ -e "$RUN_DIR/seed-failed" ]; then\n  FAILED+=("kosmos-4909-seed-copy")');
  const verdict = src.indexOf('if [ "${#FAILED[@]}" -gt 0 ]; then');
  assert.ok(at > 0 && verdict > at, 'the seed-failed marker does not reach the run\'s verdict');
  // Every seed refusal comes before the run folder is made (a refusal leaves nothing behind), and before the log line.
  const mk = src.indexOf('RUN_DIR="$(mktemp -d');
  for (const msg of ['is not a folder; refusing a run that would only look seeded', 'is the real home; refusing to copy it', 'needs the run\'s own home']) {
    const at2 = src.indexOf(msg);
    assert.ok(at2 > 0 && at2 < mk, 'the refusal "' + msg + '" is after the run folder exists');
  }
  assert.ok(at < src.indexOf('browser_run_log_append \\\n  "$(git -C'), 'the seed failure is counted after the run log line');
});

test('#4909 review 4: exit 97 (the seed, not the check) is named as the seed and never retried; an unenterable seed refuses', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const runOne = src.match(/^run_one\(\) \{[\s\S]*?^\}/m)[0];
  const at97 = runOne.indexOf('if [ "$rc" -eq 97 ] && [ -n "${KOSMOS_BC_SEED_HOME:-}" ]; then');
  const retry = runOne.indexOf('failed once, retrying');
  assert.ok(at97 > 0 && at97 < retry, 'exit 97 is not handled before the retry');
  assert.match(runOne.slice(at97, retry), /FAILED\+=\("kosmos-4909-seed-copy:\$label"\)/);
  assert.match(src, /cannot be entered; refusing a run that would only look seeded/);
  // The lib's side of the contract: a failed copy exits 97.
  assert.match(fs.readFileSync(LIB, 'utf8'), /process\.exit\(97\)/);
});
