'use strict';

/**
 * #7693: says which caller held the board's thread.
 *
 * A blocking child process stops every request while it runs, and a native sample of a stalled board
 * shows the spawn but not the JavaScript that asked for it. So the board wraps the blocking calls of
 * node:child_process and writes one line to board.log for any that took longer than a second: the
 * time, the program's name and the caller's frames.
 *
 * It never logs arguments or output: those can hold message text. It changes no result: a throw is
 * rethrown as it came, and a failure in the watching itself is swallowed. Lines are capped per minute
 * so a stalled machine does not also fill the log.
 *
 * Install before the engine modules load: `const { execFileSync } = require(...)` copies the function
 * at require time, so a module loaded earlier keeps the unwrapped one.
 */

const path = require('node:path');

const NAMES = ['execFileSync', 'execSync', 'spawnSync'];
const SLOW_MS = 1000;
const MAX_PER_MINUTE = 20;

// The program's name only. execSync's first argument is a whole command line, which can open with a secret or a
// quoted path, so none of it is logged.
function programOf(name, file) {
  if (name === 'execSync') return '(shell)';
  return path.basename(String(file === undefined ? '' : file)) || '?';
}

// The caller's frames as file:line, without the wrapper's own and without home paths.
function framesOf(stack) {
  return String(stack).split('\n').slice(1)
    .filter((l) => !l.includes('slowspawn.js') && !l.includes('node:'))
    .map((l) => { const m = /([^/\\(\s]+:\d+):\d+\)?$/.exec(l.trim()); return m ? m[1] : null; })
    .filter(Boolean).slice(0, 6).join(' < ');
}

function install(cp, opts = {}) {
  const log = opts.log || ((line) => console.warn(line));
  const now = opts.now || Date.now;
  let windowAt = 0;
  let inWindow = 0;
  for (const name of NAMES) {
    const real = cp[name];
    if (typeof real !== 'function' || real.slowspawnWrapped) continue;
    const wrapped = function wrapped(...args) {
      const began = now();
      try {
        return real.apply(this, args);
      } finally {
        try {
          const took = now() - began;
          if (took >= SLOW_MS) {
            const at = now();
            if (at - windowAt >= 60000) { windowAt = at; inWindow = 0; }
            if (inWindow++ < MAX_PER_MINUTE) log(`[slow-spawn] ${took} ms ${name} ${programOf(name, args[0])} from ${framesOf(new Error().stack)}`);
          }
        } catch { /* watching never breaks the call it watches */ }
      }
    };
    wrapped.slowspawnWrapped = true;
    cp[name] = wrapped;
  }
}

module.exports = { install, programOf, framesOf, SLOW_MS, MAX_PER_MINUTE };
