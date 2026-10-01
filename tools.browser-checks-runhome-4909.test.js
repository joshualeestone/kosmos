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
  'KOSMOS_BC_RUN_SKILLS', 'CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'GROK_HOME', 'CLAUDE_CONFIG_DIR'];

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
    // Its own home: through board_home, or one named for this board alone (AGENT_WORKFORCE_HOME="$sb8/home").
    assert.match(cmd, /AGENT_WORKFORCE_HOME="(\$\(board_home "\$\w+"\)|\$\w+\/home)"/, 'a board boot at line ' + (i + 1) + ' inherits the run home');
    assert.match(cmd, /AGENT_WORKFORCE_SKILLS_DIR="(\$\(board_skills "\$\w+"\)|\$\w+\/skills)"/, 'a board boot at line ' + (i + 1) + ' inherits the run skills');
  }
});

test('#4909: board_home gives a board its own home only when it would inherit the run\'s', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const fn = (name) => src.match(new RegExp('^' + name + '\\(\\) \\{[\\s\\S]*?^\\}', 'm'))[0];
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sb-4909-'));
  try {
    const run = (env) => spawnSync('bash', ['-c', fn('board_home') + '\nboard_home "$1"', 'x', sb], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }).stdout;
    assert.equal(run({ AGENT_WORKFORCE_HOME: '/run/home', KOSMOS_BC_RUN_HOME: '/run/home' }), sb + '/home');
    assert.ok(fs.existsSync(path.join(sb, 'home')), 'the board\'s own home was not made');
    // CONTROL: a home the caller set for this board is kept.
    assert.equal(run({ AGENT_WORKFORCE_HOME: '/mine', KOSMOS_BC_RUN_HOME: '/run/home' }), '/mine');
    assert.equal(run({ AGENT_WORKFORCE_HOME: '/mine' }), '/mine');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});
