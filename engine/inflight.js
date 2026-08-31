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

/**
 * A MINIMUM INTERVAL between runs, which ANSWERS rather than refuses.
 *
 * #1645. `collapse` above bounds CONCURRENT callers and deliberately holds
 * nothing once a run settles, so a SERIAL poll is N runs. For the connections
 * sweep that is N `claude auth status` subprocesses plus N authenticated
 * requests carrying the person's real OpenAI key, and `connect-verdict-1034`
 * takes that route from zero advertised callers to eighteen.
 *
 * 🛑 IT NEVER REFUSES, AND THAT IS THE WHOLE DESIGN. The route's original
 * no-rate-limit decision was right about the limiter it was imagining: a
 * refusal has to render as something, and the only honest rendering is
 * `cannot tell`, which MANUFACTURES uncertainty about a machine we could have
 * read perfectly well. That is the same collapse as the TTL cache, arriving
 * from the other direction.
 *
 * ⇒ Inside the interval this answers with THE PREVIOUS RUN AND ITS AGE. No
 * verdict is changed, so `cannot tell` cannot become a confident `not
 * connected`; and nothing is presented as fresh, because the age travels with
 * the answer and the consumer decides what to do about it.
 *
 * 🛑 A REJECTED RUN IS NOT REMEMBERED, and a failure is never answered from the
 * remembered value. Both follow from the same rule as `collapse`: holding a
 * failure would turn one unreachable moment into a stretch of them, and
 * answering a failed sweep from an older one would present a stale reading as
 * the current state of the machine with no way for the caller to tell. The
 * rejection propagates.
 *
 * 📌 COMPOSE IT OVER `collapse`, not instead of it. They bound different things:
 * `minInterval(collapse(sweep), ms)` bounds serial polls AND still shares one
 * run between callers who arrive together on a cold slot.
 *
 * @param {Function} run zero-argument function returning a value or a promise
 * @param {number} ms   minimum milliseconds between two real runs
 * @param {{now?: Function}} [opts] `now` is injectable so a test can advance
 *   the clock instead of sleeping. Tests that sleep are slow and flaky, and a
 *   guard keyed on time is exactly the shape that needs the clock in hand.
 * @returns {Function} `() => Promise<{value, ageMs, fresh}>`
 */
function minInterval(run, ms, opts) {
  if (typeof run !== 'function') throw new TypeError('minInterval(run, ms): run must be a function');
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    throw new TypeError('minInterval(run, ms): ms must be a finite number of milliseconds >= 0');
  }
  const now = (opts && opts.now) || Date.now;
  let value = null;
  let at = 0;
  let has = false;
  return function intervalled(...args) {
    /* Same refusal as `collapse`, for the same reason: one remembered value
       cannot be correct for two callers asking different questions, and the
       wrongness would depend on timing. */
    if (args.length) {
      throw new TypeError(
        'minInterval() remembers one run\'s answer, so it cannot take arguments: '
        + 'a caller inside the interval would receive a different question\'s answer.',
      );
    }
    const t = now();
    if (has && (t - at) < ms) {
      /* The remembered value is returned AS IT WAS. Nothing is recomputed,
         re-derived or normalised here: any transform on this path would be a
         second definition of the answer, and the two would drift. */
      return Promise.resolve({ value, ageMs: t - at, fresh: false });
    }
    let p;
    try { p = Promise.resolve(run()); }
    catch (err) { p = Promise.reject(err); }
    return p.then((v) => {
      /* Stamped when the run SETTLES, not when it started. A sweep that took
         four seconds is four seconds of work, not four seconds of staleness,
         and stamping the start would charge the caller for the former. */
      value = v; at = now(); has = true;
      return { value: v, ageMs: 0, fresh: true };
    });
  };
}

module.exports = { collapse, minInterval };
