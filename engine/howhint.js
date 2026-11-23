'use strict';
/*
 * kosmos#8935: the first time an agent uses a command that has a longer guide, the command names the guide once.
 *
 * More of the detailed rules live in on-demand guides now (`kosmos claim --how` and the like). That depends on an
 * agent remembering to read one the first time a case comes up, and an agent acting from memory of older text gets it
 * wrong quietly. So each such command prints one line naming its guide, once per agent per guide. Running the guide
 * itself (`--how`) counts as seen. `--help` is answered before this runs on both CLIs, so it does not count, and
 * report's pointer (to its --help) can show once to an agent that already read it. Only an agent's call counts: KOSMOS_AGENT_SESSION (a Mac agent's name, so once per agent) or
 * KOSMOS_AGENT_TOKEN (all a Windows agent carries; minted per launch, so there it is once per launch, and only a hash
 * of it is stored). A person in their own Terminal has neither. A call with no arguments (a usage request, or the
 * report hook's status probe) and a `report ... --auto` call (the report hook's own) neither points nor marks. A test run never
 * points unless it names its own record (KOSMOS_HOWHINT_FILE).
 *
 * Both CLIs call this one module (install/kosmos through `node howhint.js <command> [args]`, the Windows CLI through
 * require), so the rule and the record are the same everywhere. The record is one JSON file in the data folder
 * (store.currentDataRoot(); a test run names its own with KOSMOS_HOWHINT_FILE). Two agents writing at once can at worst lose a mark, which shows a
 * pointer twice; nothing else depends on it. Never throws.
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

function recordFile(env, store) {
  if (env && env.KOSMOS_HOWHINT_FILE) return env.KOSMOS_HOWHINT_FILE;   // a test's own record (honoured anywhere: an agent controls its own env)
  return path.join(store.currentDataRoot(), 'how-hints.json');   // no migration, no folder made, from an agent's command
}
/* A record with no prototype, so an agent named like an Object key (`__proto__`) is stored as a key like any other. */
function readRecord(file) {
  const rec = Object.create(null);
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) rec[k] = v[k];
  } catch { /* no record yet, or unreadable: start over */ }
  return rec;
}
function writeRecord(file, rec, mayMakeFolder) {
  try {
    if (mayMakeFolder) fs.mkdirSync(path.dirname(file), { recursive: true });   // only a test's own record
    require('./store').saveFlushed(file, JSON.stringify(rec) + '\n');   // the store's flushed write: a unique temp, then the rename
  } catch { /* nothing recorded: the pointer may show again */ }
}

/* Who is calling: a Mac agent's name, or a hash of a Windows agent's launch token (never the token itself). */
function agentKeyOf(env) {
  const session = String(env.KOSMOS_AGENT_SESSION || '');
  if (session) return session;
  const token = String(env.KOSMOS_AGENT_TOKEN || '');
  if (!token) return '';
  return 'launch:' + require('node:crypto').createHash('sha256').update(token).digest('hex').slice(0, 16);
}
/* Per-launch keys accumulate on Windows: keep the newest 500 entries. */
function capRecord(rec) {
  const keys = Object.keys(rec);
  for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete rec[k];
}

/* The line to show for this call, or '' (not an agent, no guide, already seen, or the agent is reading the guide now).
   Marks the guide seen for this agent either way. */
function hint(command, args, opts) {
  try {
    const env = (opts && opts.env) || process.env;
    const c = classify(command, args);   // first: most calls have no guide, and need no hash
    if (!c) return '';
    const agent = agentKeyOf(env);
    if (!agent) return '';
    const store = (opts && opts.store) || require('./store');   // opts.store: a test's stand-in
    if (!env.KOSMOS_HOWHINT_FILE) {
      try { if (store.isTestProcess(env) || store.isTestProcess(process.env)) return ''; } catch { return ''; }   // the env handed in, and this process
    }
    const file = recordFile(env, store);
    if (!env.KOSMOS_HOWHINT_FILE) {
      /* Never make the data folder (that would block the legacy-store migration and skip its 0700 mode), and never
         write into one under the temp folder: no real data folder lives there, but a CLI test's sandbox does. */
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) return '';
      const tmp = fs.realpathSync((opts && opts.tmpdir) || require('node:os').tmpdir());   // opts.tmpdir: a test's stand-in
      let real = dir;
      try { real = fs.realpathSync(dir); } catch { /* checked above */ }
      if (real === tmp || real.startsWith(tmp + path.sep)) return '';
    }
    const rec = readRecord(file);
    const seen = Array.isArray(rec[agent]) ? rec[agent] : [];
    if (seen.includes(command)) return '';
    delete rec[agent];   // re-added last, so the cap below keeps recently seen agents
    rec[agent] = seen.concat(command);
    capRecord(rec);
    writeRecord(file, rec, Boolean(env.KOSMOS_HOWHINT_FILE));
    if (c.readsIt) return '';
    return 'First use of kosmos ' + command + ' here: its full guide is ' + c.guide + ' (shown once).';
  } catch { return ''; }
}

module.exports = { GUIDES, classify, hint, agentKeyOf };

/* install/kosmos runs this as a program: prints the line (or nothing) and always exits 0. */
if (require.main === module) {
  try {
    const line = hint(process.argv[2] || '', process.argv.slice(3));
    if (line) process.stdout.write(line + '\n');
  } catch { /* never in the way of the command */ }
  process.exitCode = 0;
}
