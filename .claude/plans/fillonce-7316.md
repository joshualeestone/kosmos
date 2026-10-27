# fillonce-7316: the agreement test's fill() rewrote base64 (a 4% flake on main from #7316)

Found by Homer (relayed by Splinter 04:24 CDT): in tools.command-words-7262.test.js, fill() replaced each P a second
time AFTER base64-encoding the ENC(...) rows. When a random temp path's base64 held a capital P, it was rewritten and
"both guards give the same answer" failed: 77 of 2,000 realistic paths, 2 of 20 runs on his box.

## The call
fill() is one pass: one regex with both alternatives (ENC(...) or a bare P), so the program is substituted once and
the base64 output is never scanned again. A new test plants a path whose encoded row holds a capital P
(/tmp/aw-cmdwords-7262-Oa/gh, found by search; 3 to 4% of random temp paths encode with a P: 614 of 20,000 in
review, 77 of 2,000 on Homer's box) and asserts the row decodes back to it. It first asserts the planted
path really encodes with a P, so the test cannot pass vacuously if the path is ever changed.

## Proof
- The file: 4 of 4. Thirty runs in a row: 0 failures.
- Control: the old two-pass fill makes the new test red with the corrupted decoding.

## Weakest premise
That this was the only P-sensitive substitution. The other rows fill P into plain text, where the program is
substituted once already.

## Review rounds
1. (sonnet, 04:2x CDT) No BLOCKERs, WARNINGs or CONVENTIONs; 2 NITs. Its differential: old fill corrupted the ENC row
   for 614 of 20,000 random temp paths, new fill for 0; every other row fills identically. Applied: (N) the "about 1 in
   26" figure was unmeasured; the comment and this plan now give the measured 3 to 4%. Deferred: (N) a path holding
   $& or $1 now substitutes literally in plain rows (more correct; temp paths never hold $). Converged.
