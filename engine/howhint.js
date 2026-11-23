'use strict';
/*
 * kosmos#8935: the first time an agent uses a command that has a longer guide, the command names the guide once.
 *
 * More of the detailed rules live in on-demand guides now (`kosmos claim --how` and the like). That depends on an
 * agent remembering to read one the first time a case comes up, and an agent acting from memory of older text gets it
 * wrong quietly. So each such command prints one line naming its guide, once per agent per guide. Running the guide
 * itself counts as seen. A person in their own Terminal (no KOSMOS_AGENT_SESSION) never sees it.
 *
 * Both CLIs call this one module (install/kosmos through `node howhint.js <command> [args]`, the Windows CLI through
 * require), so the rule and the record are the same everywhere. The record is one JSON file in the data folder
 * (store.root(), a throwaway root in a test run). Two agents writing at once can at worst lose a mark, which shows a
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
  const first = Array.isArray(args) && args.length ? String(args[0]) : '';
  const readsIt = command === 'report' ? (first === '--help' || first === '-h') : first === '--how';
  /* `kosmos task built` ends with its own line naming the task guide (kosmos#8934): not pointed at twice. */
  if (command === 'task' && first === 'built') return null;
  return { guide, readsIt };
}

function recordFile(env) {
  if (env && env.KOSMOS_HOWHINT_FILE) return env.KOSMOS_HOWHINT_FILE;   // a test seam
  return path.join(require('./store').root(), 'how-hints.json');
}
function readRecord(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function writeRecord(file, rec) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(rec) + '\n');
    fs.renameSync(tmp, file);
  } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } }
}

/* The line to show for this call, or '' (not an agent, no guide, already seen, or the agent is reading the guide now).
   Marks the guide seen for this agent either way. */
function hint(command, args, opts) {
  try {
    const env = (opts && opts.env) || process.env;
    const agent = String(env.KOSMOS_AGENT_SESSION || '');
    if (!agent) return '';
    const c = classify(command, args);
    if (!c) return '';
    const file = recordFile(env);
    const rec = readRecord(file);
    const seen = Array.isArray(rec[agent]) ? rec[agent] : [];
    if (seen.includes(command)) return '';
    rec[agent] = seen.concat(command);
    writeRecord(file, rec);
    if (c.readsIt) return '';
    return 'First use of kosmos ' + command + ' here: its full guide is ' + c.guide + ' (shown once).';
  } catch { return ''; }
}

module.exports = { GUIDES, classify, hint };

/* install/kosmos runs this as a program: prints the line (or nothing) and always exits 0. */
if (require.main === module) {
  try {
    const line = hint(process.argv[2] || '', process.argv.slice(3));
    if (line) process.stdout.write(line + '\n');
  } catch { /* never in the way of the command */ }
  process.exitCode = 0;
}
