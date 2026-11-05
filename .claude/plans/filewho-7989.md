# filewho-7989: read a project file's last writer and owner from the CLI (kosmos#7989, slice 2)

Stacked on fileowner-7989 (PR #7999, slice 1: a file's owner, `first`, and the room notice).

## Decided (reversible; my call)
- **Verb:** `kosmos project who <file>`, a path to a file inside a project's folder, absolute or relative to where it runs.
  It prints the project, the agent Kosmos last saw about to change the file and when, the owner (slice 1's `first`), and
  how the file's modification time compares with that record: "most likely that edit" (inside writerOf's window, the
  same test the Documents list's "changed by" uses), "changed again after that ... Kosmos did not see who made that
  change" (naming the recorded agent's late-landing edit, another agent, a person, or a tool outside the edit hook), or
  "its modification time is older than that" (the edit may have failed, a tool restored an older time, or the folder's
  clock differs). A file with no record says Kosmos cannot say who. A folder (the project's own included) says it is a
  folder. Exit 0 for an answer about a project file, 1 outside every project, for a refusal or an unreadable answer, 2
  for a usage error (before the board is asked; an option is refused, a file starting with - is ./-name).
- **Nested projects:** a record is filed under the deepest project at the moment of the write, so every project whose
  folder holds the file is read and the newest entry is the last agent seen. The owner comes only from the deepest
  project's own entry, the one slice 1's notices act on, so `who` never names an owner the notices would not use (a
  file seen only before its inner project existed shows no owner). Entries older than KEEP_MS are not read.
- **Paths:** resolved once (links followed), then lstat'ed, so a link swapped in afterwards is not followed. A link out
  of a project's folder is outside; a dangling link is a project file that is not there.
- **Route:** `GET /api/project-file/who?path=<abs>`, answering from engine/filewriters.about (read against the
  projects' folders as they are now). Outside every project it says only `{ ok: false, because: 'outside' }`, nothing
  about the path. A missing or relative path is 400. A cross-site or another computer's page is refused (crossSiteRead),
  since unlike the Documents list it answers for paths the list leaves out (.git, .env).
- **Words:** engine/filewhoview.renderWho, pure, so a Windows CLI can print the same lines. Names and file names go
  through projectview.one (no control, bidi or invisible characters); the file name is quoted with its quotes made
  single. Display names show with the session name beside.
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

## Known gap
Slice 1's noteWrite takes the owner from the deepest project's own record, so making a project inside another's folder
resets the owner of the files already in it (the next writer becomes owner). `who` reports that faithfully rather than
papering over it; fixing it belongs in noteWrite.

## Tests
engine/filewho-7989.test.js (about and renderWho: seen, after, before, owner apart from last writer, no record, a
record from before owners, a file gone, refused paths, folders, nested projects and their owner, a lapsed entry, a
linked folder, .., a link out and a dangling link, display names and a throwing lookup, hostile and quote-carrying names);
server.filewho-7989.test.js (the real route after the real keep call, display name, outside/missing/relative);
cli.project-who-7989.test.js (the CLI against a stub serving a real about() answer: the encoded path with a space and
&, the token, relative paths from cwd, exit codes, a 403, usage errors before the board is asked, -h). Mutations proven
red: after/before flipped, seen never, owner as last writer, no cleaning, unguarded name lookup, path not encoded,
relative path not resolved, outside exiting 0, folder check, project folder as outside, route guard, option refusal,
only the deepest project read, oldest entry wins, recorded agent ruled out, name quotes kept, owner from the outer
record, lapsed entries read, the refusal advising --.
