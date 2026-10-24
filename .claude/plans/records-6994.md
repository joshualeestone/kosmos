# #6994: a project's records (a shared table of the things it tracks, with freshness)

## Finished looks like
Two agents on one project add and update rows through `kosmos records`, on the Mac and Windows commands alike;
the person sees a Records table on the project page with each row's age; a row whose latest evidence is older
than 30 days is visibly marked stale. A test drives two agents' interleaved updates through the board and both
survive; another shows the stale mark.

## Decided (posted on the card)
The gap is the DATA (a CSV in Project Files loses one of two agents' updates, drifts on names, and leaves
freshness to convention); the view comes with it.
- Stored inside the project record like tasks (`records: [...]`), written through `projects.mutate`, so two
  agents' writes through the board apply one after the other.
- A row: `name` (as first written, the canonical name; compared by its Unicode form, case and spacing), `status`, `confirmed` (YYYY-MM-DD,
  today when not given), `source` (a link or path), `by` (who last changed it), `updatedAt`.
- A project may name what its rows are (`recordsLabel`, e.g. "accounts"); default "records".
- Stale: `confirmed` older than 30 days.
- Verbs: `kosmos records <project>` (list), `kosmos records set <project> <name> [--status S] [--confirmed
  YYYY-MM-DD] [--source URL]`, `kosmos records remove <project> <name>`.

## Rejected
- A live table view of a CSV in Project Files: fixes the view only.
- Free-form columns per project: every reader must discover the shape; the four fields answer the card.

## Weakest premise
That four fixed fields cover what comes next. Next step if not: an optional `fields` map per row.

## Decided in review
- "Today" is this computer's calendar day; a confirmed date up to one day ahead is accepted (an agent on `date -u`
  is a day ahead every evening west of UTC), two days is refused with this computer's date in the words.
- Refused in a field: control and C1 characters, line and paragraph separators, direction marks and overrides.
  Names are NFKC-normalised for the key, so the two accent spellings are one row.
- describe() leaves `records` out, so the project list the page polls does not carry up to 500 rows per project.
- The verb is taught in `kosmos project show` (a Records line: the count and the read command, or how to start),
  not in the operating block: the role boot file is at its size canary (65,651 bytes against 65,536 with even a
  three-line paragraph; kosmos#4021 watches that growth). Follow-up card to teach it in the block once there is room.
- The list's GET answers GET only (the agent-token gate admits GET; a HEAD would answer differently).
- Caps: 500 rows a project, a source of at most 500 characters (the rows live in projects.json, which every board read
  parses whole). A field may not hold a line break, nor the invisibles projectview.one takes off a line (direction
  controls, zero-width space and BOM, the tag block); the joiners stay. `kosmos records label` names the rows.
