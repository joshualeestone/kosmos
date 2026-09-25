'use strict';

/**
 * The CPU time, in milliseconds (user + system from process.cpuUsage), that `fn` used.
 *
 * #3710 / #3715: a "this must not backtrack" guard bounds CPU time, not wall time.
 * Backtracking is CPU work, so a real regression still burns past the bound, while a
 * busy Mac (several suites at once) inflates wall time far more than CPU time.
 * process.cpuUsage counts the whole process, so work on another thread in the same
 * process (GC, a worker) is included; that errs toward a slower reading, not a faster one.
 * It measures SYNCHRONOUS work only: an async fn returns at its first await, so it
 * refuses one rather than report the CPU spent before it.
 */
function cpuMillisecondsOf(fn) {
  const before = process.cpuUsage();
  const result = fn();
  const d = process.cpuUsage(before);
  if (result && typeof result.then === 'function') {
    throw new Error('cpuMillisecondsOf measures synchronous work only; this function returned a promise');
  }
  return (d.user + d.system) / 1000;
}

module.exports = { cpuMillisecondsOf };
