'use strict';

/**
 * One in-flight run, shared by every caller that asks while it is running.
 *
 * #1618. `GET /api/accounts` runs a live sweep: a `claude auth status`
 * subprocess per Claude account and an authenticated request per OpenAI
 * account. Two callers arriving together ran two full sweeps.
 *
 * 🛑 THIS IS NOT A CACHE, AND THE DIFFERENCE IS THE WHOLE REASON IT EXISTS.
 * #1618 records a 5s TTL cache being built and killed by the existing suite in
 * one run:
 *
 *     a reader that THROWS makes the route answer unknown, not a confident none
 *       'none' !== 'unknown'
 *
 * A clock-expiry cache converts `cannot tell` back into a confident `not
 * connected` for the length of its window, which is the single thing the
 * accounts sweep exists never to do. The three-state rule (read / unreadable /
 * dropped) is not a detail of that route, it is its subject.
 *
 * ⇒ SO THERE IS NO TIME WINDOW HERE AT ALL. The slot holds a promise only
 * while it is unsettled, and is cleared the moment it settles, on BOTH arms.
 * Every sharer therefore receives the answer of one sweep taken at one moment,
 * which is the same guarantee a caller running alone gets. A caller arriving
 * one tick after the sweep settles runs a fresh one. Nothing is ever served
 * after it has finished being true.
 *
 * ⚠️ A FAILED RUN IS CLEARED LIKE A SUCCESSFUL ONE, deliberately. Holding a
 * rejection would turn one unreachable moment into a stretch of them, which is
 * the confident-none failure arriving by its other door.
 */

/**
 * Wrap a zero-argument async function so concurrent calls share one run.
 *
 * 🛑 IT TAKES NO ARGUMENTS AND REFUSES THEM LOUDLY. One shared slot cannot be
 * correct for two callers asking different questions: the second would receive
 * the first's answer, silently, and the wrongness would depend on timing, which
 * is the least debuggable shape there is. A future caller who adds a parameter
 * gets a TypeError at the call rather than another caller's data.
 */
function collapse(run) {
  if (typeof run !== 'function') throw new TypeError('collapse(run): run must be a function');
  let live = null;
  return function collapsed(...args) {
    if (args.length) {
      throw new TypeError(
        'collapse() shares one run between concurrent callers, so it cannot take arguments: '
        + 'a second caller would receive the first caller\'s answer. Wrap a zero-argument '
        + 'function, or key the slot on the argument if you genuinely need one per value.',
      );
    }
    if (live) return live;
    /* 🛑 `run()` IS CALLED SYNCHRONOUSLY, AND THAT IS A CONTRACT RATHER THAN A
       STYLE CHOICE. My first version scheduled it as `Promise.resolve().then(run)`
       so a synchronous throw would become a rejection through one uniform path.
       That deferred the run's start by a microtask, and `engine/openaiaccounts.test.js`
       caught it immediately:

           'none' !== 'unknown'

       which is the exact assertion #1618 records killing the TTL cache. The cause
       here was different and the lesson is the same. Those tests restore a
       monkey-patched `checkLive` in a SYNCHRONOUS `finally` beside a returned
       promise, which is correct because `listLive` reads its collaborators
       synchronously on the way to its first await. Deferring by one microtask put
       the read AFTER the restore, so the real reader ran and answered a confident
       `none` where the test had arranged an unreachable one.
       ⇒ A wrapper that changes WHEN a function starts is not transparent, however
       tidy its scheduling looks. The try/catch below buys the same sync-throw
       safety without moving the start. */
    let p;
    try { p = Promise.resolve(run()); }
    catch (err) { p = Promise.reject(err); }
    live = p;
    /* Only clear the slot if it is still OURS. A clear that fired
       unconditionally could delete a newer run's slot, and the newer run's
       sharers would then wait on a promise nothing points at. */
    const clear = () => { if (live === p) live = null; };
    /* Both arms. `.then(clear, clear)` and not `.finally(clear)` only because
       the derived promise is discarded either way; the point is that a
       rejection clears too. The derived promise handles the rejection for
       ITSELF, which does not stop the rejection reaching the caller through
       `p` - the caller's own error handling is unchanged. */
    p.then(clear, clear);
    return p;
  };
}

module.exports = { collapse };
