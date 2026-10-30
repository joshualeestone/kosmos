# fpwords-7213: an older sha256: mark that is a PDF fingerprint is called one, not "the bytes differ" (kosmos#7213 follow-up)

From Josh's five-model 0.7.71 report (card comment 2026-10-27): given an old-style `sha256:` label on a value that is
really a PDF fingerprint, `kosmos fingerprint <file> <value>` said "the bytes differ only in the PDF's own dates or ID",
while the file was byte-identical to the approved one. Ask: say the value is a PDF fingerprint, not that the bytes
differ. Josh called the advice right (a byte check needs no label). Review round 1 showed the old wording ("give
the value without sha256:") cannot produce a match on this path, since the value is known not to be the file's plain
sha256, so it now names the value that can: the approved file's plain sha256 (what shasum -a 256 prints for it).

## Change
- `engine/fileprint.js` `compare`, the sha256:-labelled fallback match: the words now say the value is this PDF's
  fingerprint (its dates and ID left out), not its plain sha256, so it does not show whether the bytes are identical.
  The code cannot tell an older mark of an identical file from a plain sha256 of a copy whose dates were already
  empty (review 3 of #7213), so the words claim only what both cases share.
- Tests: the two regexes that pinned the old sentence; a new arm for Josh's case (an older mark against the SAME
  PDF: says fingerprint, never "bytes differ", advice kept), with controls.

## Proof so far
- `node --test` on fileprint-7213.test.js: 12 of 12 (12 defined). Against main's fileprint.js (old words): 3 red,
  the new arm among them.
- The four test files that use compare (fileprint-6849, fileprint-7213, tools.windows-kosmos-cli-570,
  server.builtsha-6330): 94 of 94 (92 written, plus loop cases).

## Weakest premise
That no other surface quotes the old sentence: grep found it only in hashkind-7213's plan (history, left alone).
