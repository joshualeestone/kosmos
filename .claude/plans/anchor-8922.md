# anchor-8922: anchor #8230's source test to the /api/report handler (kosmos#8922)

## Measured
engine/kosmos-report-hook.turnend-8230.test.js read a fixed 20,000-character window after the /api/report route's head
line. After #8916 the guarded `skipped: String(kept.skipped)` sat at 19,932, so any small addition would trip the test
for a reason unrelated to what it guards. The handler ends at the first `\n  }\n` at its own indent (22,603 characters
after the head on main), and the next route starts straight after it.

## Decided
Anchor to the handler (reportRoute: its head line, found exactly once, to its closing brace at the same indent) rather
than widen the window: a wider window only moves the cliff. null when the head is missing, repeated or not at a
whitespace indent, or the closing brace is not found, so a renamed or restructured route fails loudly.

## Tests
The same two checks (the skip is named; both refusals log), now on the anchored handler. CONTROLS: with the guarded
line removed the check fails; a handler 40,000 characters longer still passes, where the old window would not; the
slice ends exactly where the next route starts. Perturbing the real server.js (the guarded line removed) turns the main
test red. The file: 24 tests, 0 failed.

Weakest premise: that the handler's closing brace is the first two-space `}` line after its head. A nested block at
that indent inside the handler would end the slice early; the "ends where the next route starts" control would then
fail, so it cannot pass silently.
