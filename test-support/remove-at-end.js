'use strict';
/**
 * removeAtEnd(fn): run `fn` when this process ends, normally or by SIGINT, SIGTERM or
 * SIGHUP (kosmos#4273). Used for "remove the temp folder I made".
 *
 * WHY ONE REGISTRY: a signal skips 'exit' handlers, so each temp-making module used to
 * add its own signal handler that swept and re-raised, standing aside when another
 * listener existed (that listener decides whether the process ends). Two such modules
 * in ONE process stood aside for EACH OTHER: the first saw the second and returned, the
 * second swept only its own folder and re-raised, and the process died by the signal
 * with the first module's folders left (measured: browser-checks' thread-server beside
 * lib-sandbox-home left 4 `kosmos-bc-home-` folders on SIGTERM). One handler per
 * process for every sweep means "another listener" can only be someone else's.
 *
 * A foreign handler for the signal (a file's own SIGTERM handler) still decides: the
 * sweeps then run at 'exit', when that handler lets the process end.
 *
 * The registry lives on the process under a global symbol, so two copies of this file
 * (two paths to it) still share one handler. It never throws.
 */
const KEY = Symbol.for('kosmos.removeAtEnd');

function removeAtEnd(fn) {
  let reg = process[KEY];
  if (!reg) {
    reg = { fns: [] };
    process[KEY] = reg;
    const runAll = () => { for (const f of reg.fns.splice(0)) { try { f(); } catch { /* ending anyway */ } } };
    process.on('exit', runAll);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.once(sig, () => {
        if (process.listenerCount(sig) > 0) return;
        runAll();
        try { process.kill(process.pid, sig); } catch { /* already going */ }
      });
    }
  }
  reg.fns.push(fn);
}

module.exports = { removeAtEnd };
