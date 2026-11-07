# xlsx8162-ick (kosmos#8162): #8147's round-8 leftovers in the spreadsheet preview

Stacked on PR #8163 (xlsx8147-ick); rebased onto main and opened as a PR once #8163 merges.

## What it does
- A row or cell the reader does not place finds its saved value with the reader's own element scan (so a value with
  attributes counts), never a regex that would be quadratic on unclosed tags.
- `startTagEnd`: a start tag ends at the first ">" outside quotes; "<" outside a quote means no end; inside a quote, "<"
  after a ">" is a damaged quote (ends at that ">", counted), "<" before any ">" is text.
- `cutShorts` counts an element with no tag end, no close of its name anywhere after it (containers still yield the
  rest), or a body holding another start tag of its own name; plus an unclosed phonetic guide. It marks the sheet cut,
  every sheet when the workbook, rels or styles counted one, and any cell using a shared string cut off inside or at or
  after a swallowed `<si>`; a workbook with any count is never "empty" or "no saved values".
- The seam writes each answer to JSON once and refuses one past 8 MiB, or one that cannot be written.

## Review: 8 rounds, cap stop (usage rule), no BLOCKER open at round 8
- r1 (opus): counts made outside a sheet's walk were ignored; a close missing mid-part went unseen -> fixed.
- r2 (sonnet): a raw ">" in an attribute (legal XML) read as a cut-off tag; containers never counted -> fixed.
- r3 (opus): four pieces had no test that could fail, the 8 MiB cap among them -> tests added, each fails on its mutant.
- r4 (sonnet): the stringify-throws branch and nestedStart boundaries untested -> tests; copy-before-cache stated
  unobservable.
- r5 (opus): an unclosed quote could lose later cells silently; a cut-off shared string -> fixed.
- r6 (sonnet): a string lost at the <si> level; my r5 "<" rule dropped formats after a raw "<" -> fixed.
- r7 (opus) 1 BLOCKER: my r6 fix marked only the swallowed string, so later cells showed another cell's text -> every
  later index is suspect; structure cut-offs cut every sheet.
- r8 (sonnet): no BLOCKER; a cut sheet list, a lost start tag, two untested arms -> #8168 (low priority: damaged XML only).
