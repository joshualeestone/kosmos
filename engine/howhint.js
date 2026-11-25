'use strict';
/*
 * kosmos#8935: the first time an agent uses a command that has a longer guide, the command names the guide once.
 *
 * More of the detailed rules live in on-demand guides now (`kosmos claim --how` and the like). That depends on an
 * agent remembering to read one the first time a case comes up, and an agent acting from memory of older text gets it
 * wrong quietly. So each such command prints one line naming its guide, once per agent per guide. Running the guide
 * itself (`--how`) counts as seen. `--help` is answered before this runs on both CLIs, so it does not count, and
 * report's pointer (to its --help) can show once to an agent that already read it. A call with no arguments (a usage
 * request, or the report hook's status probe) and a `report ... --auto` call (the report hook's own) neither points nor
 * marks. A test run never points unless it names its own data folder (KOSMOS_HOWHINT_ROOT).
 *
 * WHO (kosmos#9015): only an agent's call counts, and it counts for the AGENT, so a restart does not show a pointer again.
 * KOSMOS_AGENT_SESSION is a Mac or Linux agent's name. KOSMOS_AGENT_TOKEN (all a Windows agent carries, and a Mac agent
 * Kosmos did not start in its own pane) is minted per launch, so it is looked up in the board's own token files
 * (sendertokens/, readable only by this account, read and never written here) for the name it was minted for. A token
 * not found there (one from another computer, an old one) is its own key, as a hash, so there it is once per launch. The
 * token is never stored. A token file that cannot be read leaves who it is unknown, so nothing is shown or marked. A
 * person in their own Terminal has neither. One agent has one key however it is spelled: lower case, without the
 * "-discord" or "+world" the supervisor's session name carries (token_roster_name there).
 *
 * WHAT IS KEPT: one empty file per agent and command in the data folder's how-hints/ (and one per launch and command, "l-",
 * so a launch looks its token up once a command), made only if it is not there yet. The
 * one JSON file this replaced was read, changed and written back, so two agents at once could lose a mark and see a
 * pointer again in the same conversation; it is still read (how-hints.json), never written. A pointer that cannot be
 * recorded is not shown: unrecorded, it would show at every call.
 *
 * Both CLIs call this one module (install/kosmos through `node howhint.js <command> [args]`, the Windows CLI through
 * require), so the rule and the record are the same everywhere. The data folder is store.currentDataRoot(). Never throws.
 */
const fs = require('node:fs');
const path = require('node:path');

/* command -> the guide that carries its longer rules. */
const GUIDES = Object.freeze({
  claim: 'kosmos claim --how',
  task: 'kosmos task --how',
  post: 'kosmos post --how',
  community: 'kosmos community --how',
  connections: 'kosmos connections --how',
  report: 'kosmos report --help',
});

/* What this call is, for the hint: null (no guide, or a call that must not point), or { guide, readsIt }. */
function classify(command, args) {
  const guide = GUIDES[command];
  if (!guide) return null;
  const list = Array.isArray(args) ? args.map(String) : [];
  if (!list.length) return null;   // a usage request, or the report hook's status probe
  if (command === 'report' && list.includes('--auto')) return null;   // the report hook's own reports
  const first = list[0];
  const readsIt = command !== 'report' && first === '--how';   // report has no --how; its --help never reaches here
  /* `kosmos task built` ends with its own line naming the task guide (kosmos#8934): not pointed at twice. */
  if (command === 'task' && first === 'built') return null;
  return { guide, readsIt };
}

/* The folder the marks, the tokens and the old record are in: the data folder, or a test's own. No migration, and the
   data folder is never made from an agent's command. */
function rootFor(env, store) {
  return env && env.KOSMOS_HOWHINT_ROOT ? env.KOSMOS_HOWHINT_ROOT : store.currentDataRoot();   // a test's own (honoured anywhere: an agent controls its own env)
}
const short = (words) => require('node:crypto').createHash('sha256').update(words).digest('hex').slice(0, 16);

/* The name a launch token was minted for, or '' (engine/sendertoken.js keeps one file per agent, named by its key, each
   token with the agent's own name). Read here rather than through that module, which works on the store's migrated root. */
function nameOfToken(root, token) {
  const dir = path.join(root, 'sendertokens');
  let files;
  try { files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name); }
  catch (e) { return e && e.code === 'ENOENT' ? '' : null; }
  let unread = false;
  for (const f of files) {
    try {
      const kept = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const list = kept && Array.isArray(kept.tokens) ? kept.tokens : kept && typeof kept.token === 'string' ? [kept] : [];
      const hit = list.find((t) => t && t.token === token);
      if (hit) return typeof hit.name === 'string' && hit.name ? hit.name : f.slice(0, -'.json'.length);
    } catch (e) { if (!e || e.code !== 'ENOENT') unread = true; }   // look at the others; one gone meanwhile held nobody
  }
  return unread ? null : '';
}
/* One spelling for one agent. */
function spelled(name, env) {
  let n = String(name);
  const world = String(env.KOSMOS_WORLD || '');
  if (world && n.endsWith('+' + world)) n = n.slice(0, -(world.length + 1));
  return n.replace(/-discord$/, '').toLowerCase();
}
const tokenOf = (env) => String(env.KOSMOS_AGENT_TOKEN || '').trim();
/* Who is calling: the agent's name, or a hash of its launch token (never the token itself) when it has no name here. '' for
   nobody, and for one whose name could not be read just now. */
function agentKeyOf(env, root) {
  const session = String(env.KOSMOS_AGENT_SESSION || '');
  if (session) return spelled(session, env);
  const token = tokenOf(env);
  if (!token) return '';
  const name = root ? nameOfToken(root, token) : '';
  if (name === null) return '';
  return name ? spelled(name, env) : 'launch:' + short(token);
}
/* Seen in the one JSON record kept before kosmos#9015, under the agent's name or this launch's hash. */
function seenBefore(root, keys, command) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, 'how-hints.json'), 'utf8'));
    return keys.some((k) => Object.prototype.hasOwnProperty.call(v, k) && Array.isArray(v[k]) && v[k].includes(command));
  } catch { return false; }
}
/* An agent's mark for a command, and a launch's. */
const markName = (agent, command) => (agent.startsWith('launch:') ? 'l-' + agent.slice('launch:'.length) : short(agent)) + '-' + command;
/* The folder the marks are in: a real folder, made here if it is not there, never one a link leads to. null when there is none. */
function marksDir(root) {
  const dir = path.join(root, 'how-hints');
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (!e || e.code !== 'EEXIST') return null; }
  try { return fs.lstatSync(dir).isDirectory() ? dir : null; } catch { return null; }
}
/* True when this call made the mark: exactly one call per agent and command gets true, whoever else is asking at once. */
function mark(dir, agent, command) {
  try { fs.closeSync(fs.openSync(path.join(dir, markName(agent, command)), 'wx', 0o600)); } catch { return false; }   // there already, or it cannot be kept
  return true;
}
/* A launch's marks could grow without end: past MARKS_MAX the oldest of them go. An agent's own marks are never taken. */
const MARKS_MAX = 3000;
const LAUNCH_MARK = /^l-[0-9a-f]{16}-[a-z]+$/;
function prune(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => LAUNCH_MARK.test(f));
    if (files.length <= MARKS_MAX) return;
    const aged = files.map((f) => { try { return { f, at: fs.statSync(path.join(dir, f)).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => a.at - b.at);
    for (const x of aged.slice(0, aged.length - MARKS_MAX)) { try { fs.unlinkSync(path.join(dir, x.f)); } catch { /* gone already */ } }
  } catch { /* kept as it is */ }
}

/* The line to show for this call, or '' (not an agent, no guide, already seen, or the agent is reading the guide now).
   Marks the guide seen for this agent either way. */
function hint(command, args, opts) {
  try {
    const env = (opts && opts.env) || process.env;
    const c = classify(command, args);   // first: most calls have no guide, and need no look-up
    if (!c) return '';
    if (!agentKeyOf(env)) return '';
    const store = (opts && opts.store) || require('./store');   // opts.store: a test's stand-in
    if (!env.KOSMOS_HOWHINT_ROOT) {
      try { if (store.isTestProcess(env) || store.isTestProcess(process.env)) return ''; } catch { return ''; }   // the env handed in, and this process
    }
    const root = rootFor(env, store);
    if (!fs.existsSync(root)) return '';   // never made here: that would block the legacy-store migration and skip its 0700 mode
    if (!env.KOSMOS_HOWHINT_ROOT) {
      /* Never write into a data folder under the temp folder: no real one lives there, but a CLI test's sandbox does. */
      const tmp = fs.realpathSync((opts && opts.tmpdir) || require('node:os').tmpdir());   // opts.tmpdir: a test's stand-in
      let real = root;
      try { real = fs.realpathSync(root); } catch { /* checked above */ }
      if (real === tmp || real.startsWith(tmp + path.sep)) return '';
    }
    const dir = marksDir(root);
    if (!dir) return '';
    const session = String(env.KOSMOS_AGENT_SESSION || '');
    const token = tokenOf(env);
    const launch = token ? 'launch:' + short(token) : '';
    if (!session && fs.existsSync(path.join(dir, markName(launch, command)))) return '';   // seen in this launch: no look-up
    const agent = agentKeyOf(env, root);
    if (!agent) return '';
    const before = seenBefore(root, [session, agent, launch].filter(Boolean), command);
    const first = mark(dir, agent, command);   // also when the old record had it: the next launch has another token
    if (!session && agent !== launch) mark(dir, launch, command);
    if (!session) prune(dir);
    if (!first || before || c.readsIt) return '';
    return 'First use of kosmos ' + command + ' here: its full guide is ' + c.guide + ' (shown once).';
  } catch { return ''; }
}

module.exports = { GUIDES, classify, hint, agentKeyOf, MARKS_MAX };

/* install/kosmos runs this as a program: prints the line (or nothing) and always exits 0. */
if (require.main === module) {
  try {
    const line = hint(process.argv[2] || '', process.argv.slice(3));
    if (line) process.stdout.write(line + '\n');
  } catch { /* never in the way of the command */ }
  process.exitCode = 0;
}
