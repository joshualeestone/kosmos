# exetext-7503: a const string the launcher exe-text test cannot read is named, not skipped (kosmos#7503)

Follow-up from #7492's review round 4 (Baron). Not a defect today: all 71 constants match the pattern.

## Decided
- stringConstants counts every `const string <name> =` declaration with a pattern that ignores the value's form, and
  adds each one the value pattern did not collect to `unresolved`, which the test already requires to be empty (its
  message says to teach stringConstants the form). No new assertion, so the failure reads the same either way.
- The control plants each unreadable form in a copy of the source (verbatim @"...", interpolated $"...", a reference
  Other.Name, odd spacing) and asserts it is named; and the real source still has none.

## Rejected
- Teaching the pattern those forms now: nothing uses them, and the card asks only that they not be skipped silently.

## Weakest premise
A `const string X =` inside a C# comment or string would now be named as unresolved: a false red, in the safe
direction, and its message says what to do.

## Proof
- tools.win-launcher-native.test.js: the planted forms are named; mutation (uncollected always empty) reds it, naming
  the verbatim constant.
