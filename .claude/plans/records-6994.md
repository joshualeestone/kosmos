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
- A row: `name` (canonical key, compared case- and space-insensitively), `status`, `confirmed` (YYYY-MM-DD,
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
