# boardlog-8424: the three follow-ups from the winlog-epipe review (kosmos#8424, after #8373 / PR #8427)

1. **Comments.** engine/win32boardlog.js said an error event "ends" a stream's console copy. The code keeps passing
   writes to node's own write. The comments now say the copy is recorded as stopped and writes still go on to node,
   whose callback carries node's error (EPIPE, or ERR_STREAM_DESTROYED once node destroyed the stream; a stream left
   errored with autoDestroy off never calls back).
2. **Return value: kept forcing true after a console error, now DELIBERATE and stated, plus two arms.** The card offered
   "limit it to destroyed, or say it is deliberate". Rounds 1 to 6 limited it; review 7 measured why that is wrong for
   the stream the card is about: node REPAIRS process.stdout a tick after a failed write (writable again, not
   destroyed), so on a platform where the failure arrives late a write past the high-water mark returned false and no
   'drain' ever came (the old rule returned true). The rule is now `dead || destroyed || writable === false ? true :
   ok`: the console having failed forces true, and node's own state covers the tick before the error event and a
   failed write with autoDestroy off. **The price, tested and stated:** an 'error' emitted from outside on a stream that
   stays healthy also hides its backpressure from then on. The board's console streams are what this tee is for.
3. **Test.** `write('x', 'bogus')`, a string with an unknown encoding: it throws ERR_UNKNOWN_ENCODING for the caller on a
   healthy and a dead console and leaves the file as it was (it is never copied: its Buffer.from throws first).

Tests (engine/win32boardlog-8373.test.js): the string case; a console that failed and then reads writable again (a plain
stand-in, as node repairs stdout) returns true past the high-water mark; an outside 'error' also forces true (the
price); a failed write with autoDestroy off returns true; a stand-in reporting only destroyed returns true, and a live
one gets its own answer. Mutants: removing the `dead` arm fails two; removing the writable arm fails one (a same-tick test added in review 8,
before the error event sets `dead`); removing the destroyed arm fails one.

The real-pipe test (win32boardlog-epipe-realpipe) records each write's return with the stream's state at that moment and
asserts the last ten are true. Measured on a Mac (node 26) by review 7: without the tee, node's own write returns false
on every write there (the pipe write fails at once and leaves stdout not writable), and a `return ok` mutant fails this
test, so it has teeth on a Mac. Where a failure arrives late, its small lines stay under the high-water mark and it
likely cannot fail; the repaired-stdout stand-in test covers that case.

Retracted: round 6's plan said node's own write already returns true on a Mac. I had measured through the tee.

Weakest premise: that hiding backpressure after an outside 'error' event costs nothing real. Nothing on the board emits
'error' on process.stdout or process.stderr by hand; that is reasoned from a search, not measured.
