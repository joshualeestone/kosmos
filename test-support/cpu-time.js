'use strict';

/**
 * The CPU time, in milliseconds (user + system from process.cpuUsage), that `fn` used.
 *
 * #3710 / #3715: a "this must not backtrack" guard bounds CPU time, not wall time.
 * Backtracking is CPU work, so a real regression still burns past the bound, while a
 * busy Mac (several suites at once) inflates wall time far more than CPU time.
 * process.cpuUsage counts the whole process, so work on another thread in the same
 * process (GC, a worker) is included; that errs toward a slower reading, not a faster one.
 */
function cpuMillisecondsOf(fn) {
  const before = process.cpuUsage();
  fn();
  const d = process.cpuUsage(before);
  return (d.user + d.system) / 1000;
}

module.exports = { cpuMillisecondsOf };
