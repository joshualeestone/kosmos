# filewho-7989: read a project file's last writer and owner from the CLI (kosmos#7989, slice 2)

Stacked on fileowner-7989 (PR #7999, slice 1: a file's owner, `first`, and the room notice).

## Decided (reversible; my call)
- **Verb:** `kosmos project who <file>`, a path to a file inside a project's folder, absolute or relative to where it runs.
  It prints the project, the agent Kosmos last saw about to change the file and when, the owner (slice 1's `first`), and
  how the file's modification time compares with that record: "most likely that edit" (inside writerOf's window, the
  same test the Documents list's "changed by" uses), "changed again after that ... Kosmos did not see who" (a person, or
  a tool writing outside the edit hook), or "has not changed since". A file with no record says nobody was seen, and
  that the change came from a person or a tool outside the hook. Exit 0 for an answer about a project file, 1 outside
  every project or for an unreadable answer, 2 for a usage error (before the board is asked).
- **Route:** `GET /api/project-file/who?path=<abs>`, answering from engine/filewriters.about (read against the
  projects' folders as they are now). Outside every project it says only `{ ok: false, because: 'outside' }`, nothing
  about the path. A missing or relative path is 400.
- **Words:** engine/filewhoview.renderWho, pure, so a Windows CLI can print the same lines. Names and file names go
  through projectview.one (no control, bidi or invisible characters). Display names show with the session name beside.
- **Windows:** not here. The `Usage:` header and the first four help lines are shared with tools/windows/kosmos-cli.js
  (cli.project-show-4581 pins them), so the Mac `who` help line sits after them and the header is unchanged until
  Windows has the verb. Handed to Homer through Splinter.

## Rejected
A project id plus a project-relative name (the agent chasing a surprise has a path); an owner column on every Documents
row (a list read, not this per-file check); "changed by" wording (the record is made before the edit).

## Weakest premise
That the record-versus-modification-time comparison is a fair read of who made the last change. The record is made
before the edit, so a failed edit followed by a person's save inside two minutes reads as "most likely that edit". The
words say "most likely" and "Kosmos last saw ... about to change it" for that reason.

## Tests
engine/filewho-7989.test.js (about and renderWho: seen, after, before, owner apart from last writer, no record, a
record from before owners, a file gone, refused paths, display names and a throwing lookup, hostile names);
server.filewho-7989.test.js (the real route after the real keep call, display name, outside/missing/relative);
cli.project-who-7989.test.js (the CLI against a stub serving a real about() answer: the encoded path with a space and
&, the token, relative paths from cwd, exit codes, usage errors before the board is asked). Mutations proven red:
after/before flipped, seen never, owner as last writer, no cleaning, unguarded name lookup, path not encoded, relative
path not resolved, outside exiting 0.
