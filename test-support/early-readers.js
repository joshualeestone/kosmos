'use strict';
// Finds shell pipelines whose reader can exit before its writer is done, so that under `set -o pipefail` the writer's
// SIGPIPE (141) fails the pipeline even when the reader got what it wanted. First written for kosmos#7946 (the CLI's
// agent remove), shared since kosmos#8193 (ios/LogicTests/run-sweep.sh false-failed a check because it matched).
/* kosmos#7946: on macOS CI the CLI exited 141 (SIGPIPE under `set -euo pipefail`) with no output, before the DELETE,
   on unrelated PRs. The remove case's request code keeps no pipeline whose reader can exit before its producer is done,
   so no producer there can take SIGPIPE. earlyReaders() finds such pipelines: continued lines are joined, each line is
   split on real pipes (`|` and `|&`, never `||`), and the reader is read past env, assignments, `command`, a path,
   quotes and a `{` or `(`. Early: head, read, grep -q / -m / --quiet / --max-count, a sed that quits, an awk that
   exits outside END. Quoted text is blanked first, so a `|` or `#` inside quotes is not a pipe or a comment.
   A heuristic, not a shell parser. Known gaps (review 2): a `|` in a case pattern can read as a pipe (none in this
   block today); a reader behind a wrapper (timeout, exec, xargs) and grep -l / -L are not recognised. */
function earlyReaders(text) {
  const joined = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    .replace(/\\\n\s*/g, ' ').replace(/(\|&?)\s*\n\s*/g, '$1 ');
  const hits = [];
  for (const line of joined.split('\n')) {
    // Find the pipes and the comment on a copy with quoted text blanked (same length), so a `|` or `#` inside quotes
    // is neither; then cut the ORIGINAL line there, since a reader's tell (sed '1q', awk '{exit}') is often quoted.
    const blank = line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (q) => q[0] + ' '.repeat(Math.max(0, q.length - 2)) + q.slice(-1));
    const hash = blank.search(/(?:^|\s)#/);
    const stop = hash < 0 ? line.length : hash;
    const cuts = [];
    for (const m of blank.slice(0, stop).matchAll(/(?<!\|)\|&?(?!\|)/g)) cuts.push([m.index, m.index + m[0].length]);
    // kosmos#8193: a reader's words end where its command does, at an unquoted ; && or || (found on the blanked copy),
    // so a later [ "$x" -eq 0 ] is not read as the reader's flags (its -eq looked like grep's -q).
    const segs = cuts.map(([, from], i) => {
      const to = i + 1 < cuts.length ? cuts[i + 1][0] : stop;
      const end = blank.slice(from, to).search(/;|&&|\|\|/);
      return line.slice(from, end < 0 ? to : from + end);
    });
    for (const seg of segs) {
      let r = seg.trim().replace(/^[{(]\s*/, '');
      for (;;) {
        const t = r.replace(/^(?:env\s+|command\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)/, '');
        if (t === r) break;
        r = t;
      }
      r = r.replace(/^["']/, '').replace(/^(?:\/[\w.-]+)*\//, '');
      const word = (r.match(/^[\w.-]+/) || [''])[0];
      const rest = r.slice(word.length);
      const early = word === 'head' || word === 'read'
        || (word === 'grep' && /\s(?:-[a-zA-Z]*[qm]|--quiet\b|--max-count\b)/.test(rest))
        || (word === 'sed' && /(?:^|[\s';{/])\d*q\b|;\s*q\s*;?\s*}/.test(rest))
        || (word === 'awk' && /\bexit\b/.test(rest.replace(/\bEND\s*\{[^}]*\}/g, '')));
      if (early) hits.push(line.trim());
    }
  }
  return hits;
}

module.exports = { earlyReaders };
