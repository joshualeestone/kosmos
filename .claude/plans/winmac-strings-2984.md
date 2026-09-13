# winmac-strings-2984: unblock 6.0 — fix the stale MAC_MARKUP Terminal-ask regex

## What / why
`web.win32-board-copy.test.js` (#2984) test "MAC UNCHANGED: every static Mac string
this branch keyed or hid still reads exactly as on main" hardcodes, in its MAC_MARKUP
list, the old Terminal prompt:
`/<p class="s2-say">"Terminal" would like to access files in your folders\.<\/p>/`

That string no longer exists. #2910 (firstrun-six-asks, merged) split the single ask
into SIX folder-specific asks (Terminal + Kosmos x Documents / Downloads / Desktop). So
this one MAC_MARKUP entry fails on main, and because it is in the shared full test suite,
it reds the 6.0 validation for EVERY branch fleet-wide (found while validating #2658).

This is a cross-lane regression: #2910 changed the strings, #2984's test wasn't updated.
Neither is my card; this is a factual test-sync hotfix (match the test to shipped code),
which unblocks all merges. Surfaced on PR #2984 so the win32 owner is aware.

## Fix
One line: replace the single stale regex with the three shipped Terminal folder-specific
strings (Documents / Downloads / Desktop), matching #2910's actual markup. Verified: only
that one MAC_MARKUP entry was stale (the other 22 still match); `node --test
web.win32-board-copy.test.js` now 26/26.

Weakest premise: the test's intended coverage for the Kosmos folder asks (also new in
#2910) is the win32 owner's call; I pinned only the Terminal ones the stale entry was
about, restoring parity with what it asserted before. The owner can widen to the Kosmos
asks if they want.
