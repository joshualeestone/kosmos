# exetext-7503: a const string the launcher exe-text test cannot read is named, not skipped (kosmos#7503)

Follow-up from #7492's review round 4 (Baron). Not a defect today: all 71 constants match the pattern.

## Decided
- stringConstants counts every name a `const string` statement declares (type `string`, `String` or `System.String`,
  each name after a comma), whatever form its value takes, and adds each one the value pattern did not collect to
  `unresolved`, which the test already requires to be empty (its message says to teach stringConstants the form). No
  new assertion, so the failure reads the same either way.
- The scan runs over a copy with string and char contents blanked and comments dropped (blankCSharpLiterals, a small
  tokenizer; a regex over the whole file cannot, as a '"' char literal or a quote in a comment opens a false string), so
  a ; or comma inside a value cannot hide a later name, and a declaration in a comment is not counted.
- The value pattern reads the source with comments dropped (strings kept), so a commented-out old value cannot stand
  in for a live declaration of the same name.
- Controls: each unreadable form planted in a copy of the source is named exactly (verbatim, interpolated, reference,
  spacing, String, System.String, a second name, a second name after a ; in a value); a readable value holding a ; and
  a comma is read, not flagged; a declaration in a comment is not flagged.

## Rejected
- Teaching the value pattern those forms now: nothing uses them, and the card asks only that they not be skipped.

## Weakest premise
blankCSharpLiterals models only the literal and comment forms named above: not C# 11 raw string literals (three or more
quotes), and not quotes inside an interpolation hole ($"{(f ? "a" : "b")}"; an odd number there desynchronises). Review
3 added the guard for that: the real file must declare as many names as the value pattern reads, so a scan that loses
part of the file goes red rather than passing.

## Proof
- tools.win-launcher-native.test.js, in the #7492 test: each planted unreadable form is named exactly; a readable value
  holding a ; or a comma is read; a declaration only in a comment is not flagged; a commented-out old value does not
  hide a live one; the real file declares as many constants as it reads (counts, so a name declared twice is seen).
- Mutations, each red: uncollected always empty (names the verbatim one); the type pattern back to `string` only (names
  String); the scan over the raw source (a name after a ; in a value); // comments kept (a commented declaration
  flagged); the value pattern over the raw source (the commented-out shadow); a declaration count capped at 40 (the
  whole-file guard).
