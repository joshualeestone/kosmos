# boardlog-8424: the three follow-ups from the winlog-epipe review (kosmos#8424, after #8373 / PR #8427)

1. **Comments.** engine/win32boardlog.js said an error event "ends" a stream's console copy and that the file says the
   copy "stopped". The code keeps passing writes to node's own write. Both comments now say the copy is recorded as
   stopped, and that writes still go on to node.
2. **Return value.** `dead ? true : ok` forced true after any error event, which hid real backpressure on a stream that
   errored but stayed writable. Now `stream.destroyed === true || stream.writable === false ? true : ok`: the forced
   true is kept for a stream node destroyed or marked not writable (a failed write with autoDestroy off, review 1), where
   no 'drain' will ever come; a stream still writable gets node's answer. node's state decides, not the error event,
   which arrives a tick after the destroy. Rejected: keeping it and only
   documenting it, because a false true makes a caller over-fill a stream that is still writable.
3. **Test.** `write('x', 'bogus')` (a STRING with an unknown encoding, a different path from the Buffer case): it throws
   ERR_UNKNOWN_ENCODING for the caller on a healthy and a dead console, and leaves the file as it was.

Tests: engine/win32boardlog-8373.test.js gains the string case and a stream that errors but stays writable
(autoDestroy off) reporting node's false; the existing drain test now asserts the stream was destroyed. Mutant: the old
`dead ? true : ok` fails the new backpressure test.

Weakest premise: that a stream still writable after an 'error' event (one emitted from outside node, not a failed
write) has real backpressure worth reporting rather than a dead end. The new test covers that case; every stream node
itself failed is either destroyed or not writable, and gets true. Known limit, unchanged: a write that returned false
while the stream was healthy, then a destroy, leaves a caller that awaits 'drain' waiting (nothing on the board does).
