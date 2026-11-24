'use strict';
/*
 * kosmos#8948 part 2: an unknown command says which real one was probably meant, in one line.
 *
 * Measured in a feedback report: an agent typed a plural (`kosmos tasks`) and was told it was unknown, while the
 * real command was the singular with a list verb (`kosmos task list`). The answer listed every command, so the agent
 * had to find the right one itself. Now the answer starts with one suggestion, or none when nothing is close.
 *
 * Both CLIs call this one module, as engine/howhint.js is called: install/kosmos runs it as a program with the
 * unknown word and its own command names (read from kosmos_command_list, the list --help prints), and the Windows CLI
 * requires it with its VERBS. So the rule is the same on both, and the names come from each CLI's own list. Never
 * throws.
 */

/* Commands that take `list` as a subcommand on BOTH CLIs (engine/didyoumean-8948.test.js holds this to the Windows
   CLI's SUBCOMMANDS and to install/kosmos's dispatch), so a plural of one suggests the list. */
const LISTABLE = Object.freeze(['task', 'project', 'agent', 'feedback']);

/* The number of single-character edits between two short words (Levenshtein). */
function distance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* The command meant by `word`, as `kosmos <command>[ list]`, or null. `verbs` are the CLI's own command names.
   - A plural of a real command: that command, with ` list` when it takes one.
   - Otherwise the one nearest command within two edits (one edit for a word under five letters), if exactly one is
     nearest. A tie, or nothing close, suggests nothing: a wrong guess costs more than the full list below it. */
function suggest(word, verbs, listable = LISTABLE) {
  try {
    const w = String(word || '').trim().toLowerCase();
    if (!w || w.startsWith('-') || !/^[a-z][a-z-]*$/.test(w)) return null;
    const names = (Array.isArray(verbs) ? verbs : []).map((v) => String(v).trim().toLowerCase()).filter((v) => /^[a-z][a-z-]*$/.test(v));
    if (!names.length || names.includes(w)) return null;
    const lists = new Set(Array.isArray(listable) ? listable : LISTABLE);
    if (w.endsWith('s') && names.includes(w.slice(0, -1))) {
      const one = w.slice(0, -1);
      return 'kosmos ' + one + (lists.has(one) ? ' list' : '');
    }
    const limit = w.length < 5 ? 1 : 2;
    let best = null;
    let bestD = Infinity;
    let tie = false;
    for (const v of names) {
      const d = distance(w, v);
      if (d < bestD) { best = v; bestD = d; tie = false; } else if (d === bestD) tie = true;
    }
    if (best === null || bestD > limit || tie) return null;
    return 'kosmos ' + best;
  } catch { return null; }
}

/* The line to print before the command list, or ''. */
function line(word, verbs, listable) {
  const s = suggest(word, verbs, listable);
  return s ? 'Did you mean: ' + s : '';
}

module.exports = { LISTABLE, distance, suggest, line };

/* install/kosmos runs this as a program: `node didyoumean.js <word> <verb>...`, prints the line (or nothing), exits 0. */
if (require.main === module) {
  try {
    const out = line(process.argv[2] || '', process.argv.slice(3));
    if (out) process.stdout.write(out + '\n');
  } catch { /* never in the way of the answer */ }
  process.exitCode = 0;
}
