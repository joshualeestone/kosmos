'use strict';

/**
 * #3675: a check's fixture board must not read the host Mac's real accounts.
 *
 * The account modules (engine/accounts.js, openaiaccounts.js, geminiaccounts.js,
 * grokaccounts.js) find accounts under `AGENT_WORKFORCE_HOME || os.homedir()`, the
 * subscription check reads `AGENT_WORKFORCE_CLAUDE_CONFIG || ~/.claude.json`, and the
 * OpenAI default reads `AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME` first. A fixture that
 * sandboxed DATA, WORKERS, PROJECTS, LAUNCH and CONFIG_ROOT but not these still showed
 * the real Claude account emails and the end of a real OpenAI key in Settings, and a
 * screenshot taken on a developer's Mac carries them into a PR, an issue or a chat.
 * Measured on Agent1s: a render-settings-nav-shaped fixture listed 5 real Claude
 * accounts and 1 real OpenAI account; with this required, none.
 *
 * Requiring this file points the home and the Claude config at a sandbox unless the
 * caller already set them (the home to somewhere other than the real one), and removes
 * the ambient overrides that are read before the home (CODEX_HOME and friends). A check
 * that sets its own after requiring this wins. Every check that boots or spawns the
 * board requires it; tools.browser-checks-home-3675.test.js fails if one does not. It
 * never touches HOME itself, so Playwright still finds its browsers.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Folders this file made, removed when the check ends; never one a caller set. */
/* At exit and on SIGINT/SIGTERM/SIGHUP, through the one shared handler (kosmos#4273):
   a runner's timeout or an interrupt is how a check usually ends early. */
const { removeAtEnd } = require('../../test-support/remove-at-end');
const made = [];
removeAtEnd(() => {
  for (const d of made.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function freshHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bc-home-'));
  made.push(d);
  return d;
}

/* kosmos#4909: a home the RUNNER made for the whole run (tools/browser-checks.sh marks it KOSMOS_BC_RUN_HOME) is shared
   by every check in the run, so one check's leftovers (an OpenAI-only account, a CLAUDE.md, a codex sign-in) decided
   another's result: it aborted the 0.7.16 cut on a correct page. A check gets its own fresh home instead. A home a
   caller set for THIS check (not the run's) is kept, as before. */
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '' && path.resolve(a) === path.resolve(b);
const cur = process.env.AGENT_WORKFORCE_HOME;
if (!cur || same(cur, os.homedir()) || same(cur, process.env.KOSMOS_BC_RUN_HOME)) {
  const home = freshHome();
  /* The #4909 control's seed (tools/browser-checks.sh KOSMOS_BC_SEED_HOME) reaches this check's own home, only when
     it was handed the run's (the runner refuses a missing seed or the real home before any check runs). */
  const seed = process.env.KOSMOS_BC_SEED_HOME;
  /* Links copied as they are (review 3: the default rewrites a relative link to point into the seed, which a board
     could then write through, shared). A copy that fails is said as a SEED failure with its own exit code, never as
     this check failing, which in a control run would read as "this check reads state it never set". */
  if (seed && same(cur, process.env.KOSMOS_BC_RUN_HOME)) {
    try { fs.cpSync(seed, home, { recursive: true, verbatimSymlinks: true }); }
    catch (e) { console.error('lib-sandbox-home: kosmos#4909 seed copy failed (' + ((e && e.message) || e) + '); this is the seed, not the check'); process.exit(97); }
  }
  process.env.AGENT_WORKFORCE_HOME = home;
}
/* The Claude config in a folder THIS file made, never inside a home it was given: a home a caller
   set may be shared (it was, under the runner, until #4909), and trust.js writes onboarding keys
   into this file, so a shared one would carry one check's writes into the next. */
if (!process.env.AGENT_WORKFORCE_CLAUDE_CONFIG) process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(freshHome(), '.claude.json');
/* #4253: the fixture board never phones home. tools/browser-checks.sh and run-tests.sh point the install ping, the
   daily report and the community at a dead local port, but a check run on its own (`node docs/browser-checks/x.js`,
   as agents and /design-shots do) is outside both, so its board sent installkosmos.com a new install with a fresh id
   and 0 agents. The same dead port here, unless the caller named an address. */
const QUIET = { AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created',
  AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', AGENT_WORKFORCE_COMMUNITY_URL: 'http://127.0.0.1:9/' };
for (const [k, v] of Object.entries(QUIET)) if (!process.env[k]) process.env[k] = v;
/* #3801: the global skills folder is read from AGENT_WORKFORCE_SKILLS_DIR || the REAL
   ~/.claude/skills (os.homedir(), not the home above), and the board can add to it and
   delete from it. Measured on Mortals: a fixture listed 73 real skills in Settings. A
   fresh, empty folder of its own unless the caller named one other than the real one. */
const realSkills = path.join(os.homedir(), '.claude', 'skills');
const skills = process.env.AGENT_WORKFORCE_SKILLS_DIR;
if (!skills || same(skills, realSkills) || same(skills, process.env.KOSMOS_BC_RUN_SKILLS)) process.env.AGENT_WORKFORCE_SKILLS_DIR = freshHome();   // #4909: the run's, too
/* The same trap for projects: engine/projects.js reads AGENT_WORKFORCE_PROJECTS || the REAL
   ~/Kosmos/Projects, and creating a project makes its folder there (makeFolder). Checks
   set it by hand; this covers the one that forgets. */
const realProjects = path.join(os.homedir(), 'Kosmos', 'Projects');
const projects = process.env.AGENT_WORKFORCE_PROJECTS;
if (!projects || path.resolve(projects) === path.resolve(realProjects)) process.env.AGENT_WORKFORCE_PROJECTS = freshHome();
/* Sealed by REMOVAL, not by naming a sandbox: setting AGENT_WORKFORCE_CODEX_HOME puts the
   board into the #1488 "operator named a codex home" mode (other OpenAI rows unofferable),
   which is not the ordinary product. Removed, the OpenAI default falls through to
   <sandbox home>/.codex. The same for the session readers that look at an ambient home
   before the seam (Gemini, Grok, and Claude Code's CLAUDE_CONFIG_DIR, which every fleet
   agent session on a dev Mac carries). A check that needs one sets it after this. */
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'GROK_HOME', 'CLAUDE_CONFIG_DIR']) delete process.env[v];

/* The fixture Claude account, for a check whose screen assumes a connected
   subscription (without one the board shows "Kosmos cannot reach a Claude subscription"
   and takes the space). Opt-in, never automatic: first-run checks want no account.
   The address is .invalid on purpose: nothing real can answer to it. */
const FIXTURE_CLAUDE = { oauthAccount: { emailAddress: 'fixture@example.invalid',
  organizationName: 'Kosmos browser checks', organizationType: 'claude_max' } };
function plantSubscribedClaude() {
  /* Its OWN home, never the one it was given: a home a caller set may be shared with other
     checks (the runner's was, until #4909), and a planted account there would change what
     they see depending on run order. A SECONDARY account (~/.claude-fixture),
     not the default: the default's subscription verdict is read from
     AGENT_WORKFORCE_CLAUDE_CONFIG, which a fixture points at its own empty file, while a
     secondary is judged by its own .claude.json. */
  const own = freshHome();
  /* kosmos#4909 review 5: in a seeded control run this home starts with the seed too, as every fresh home does. */
  const seed = process.env.KOSMOS_BC_SEED_HOME;
  if (seed) {
    try { fs.cpSync(seed, own, { recursive: true, verbatimSymlinks: true }); }
    catch (e) { console.error('lib-sandbox-home: kosmos#4909 seed copy failed (' + ((e && e.message) || e) + '); this is the seed, not the check'); process.exit(97); }
  }
  process.env.AGENT_WORKFORCE_HOME = own;
  const dir = path.join(own, '.claude-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(FIXTURE_CLAUDE) + '\n');
  return own;
}

module.exports = { plantSubscribedClaude };
