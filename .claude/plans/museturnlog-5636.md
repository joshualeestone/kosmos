# kosmos#5636 F7a and kosmos#6065 N1: a log of what the Meta front runs into Muse

## Finished looks like
The next five-family report can say, from a file on the Meta seat, what reached the Meta agent and when: whether a
"your last post was 3 hours ago or more" reminder was a new send (a new Sent stamp), an old one acted on again (the
same stamp), or something without a stamp (a second sender); and whether a "shortened" room post was a spill (how many
words) or something else.

## Findings that set this (Splinter 14:24, from Josh's 0.7.50 report)
- F7a: the report quotes only the opening words, no Sent stamp; the board log has no line for these nudges. The board's
  community-turn pass logs "community-turn:" on every send (server.js), so a nudge with no log line was not a board
  send, or was the old line acted on again inside Muse's long session.
- N1: "received long room posts shortened, with copies saved to its folder": the spill-with-file path
  (engine/messages.js spillLine), not the front's busy-digest. The board has NO Muse-specific delivery branch: room
  posts reach Muse through the same spillsAt rule (chat.MAX_TEXT 10000 minus the kept-note room) as the other four.

## The call
engine/musefront.js logs one JSON line per turn it hands to Muse (before the turn; a digest of several posts is one) to <workspace>/.kosmos/muse-turns.log:
ran-at and arrived (UTC), tz (local offset), kind, UTF-16 length, the Sent stamp, every spilled word count, a digest's
post count, each spill's saved-copy size (spillBytes, only for a file directly in a real <workspace>/Inbox) and envelope length
(envChars, per spill), and a
60-unit opening only for lines starting with an allowlisted envelope (a colleague's message or room
post, "Kosmos here:" reminders; a digest through its first post) that hold none of the person's envelope. Written only where .kosmos/.gitignore
lists both the log and its .1 copy (read as text; a negation reads as not ignored; it creates that .gitignore when there is none). Bounded (256 KB, then a
.1 copy); never throws. Injectable (`log`) so tests never write into a real folder.

## Rejected
- Logging into the board's own log: the front runs in the agent's pane, a separate process; a second writer to the
  board's log has no lock. The agent's own .kosmos folder is where the seat notes already look.
- Guessing a fix for either card first: both are Meta-only with no trace; the measurement comes first.

## Not known yet
Whether N1's posts were over 10000 characters (then the spill is by design on every family, and the other four simply
received shorter posts), or under it (then something Meta-specific spills): spillBytes (the body's saved size) plus
envChars (the envelope) against the board's limit answers it: the board measures the whole typed line, so the body
alone is not enough; chars is the shortened line's length.

## Review 1 (opus), and what changed
- BLOCKER: the write skipped keepModel's guards, so a fifo at the file could hang the front for good and a link could
  redirect the write. Now: absolute workspace only, never through a linked .kosmos, never into a link or fifo (lstat),
  and an O_NOFOLLOW|O_NONBLOCK append open (tested: linked .kosmos, link at the file, fifo, relative workspace).
- WARNING: a stop note (kind "other") quotes the person's words: no opening for any line holding an operator envelope
  (tested with a real stop note through createFront; mutation fails it).
- WARNING: the spill test used a hand copy: it now builds the line with messages.spillLine. WARNING: a busy digest kept
  only its first spill: spillWords is now every spill, plus digestPosts (tested through createFront). WARNING: added
  tests for one line per message before the turn, and a throwing log (now caught in pump) stopping nothing.
- NIT: chars is UTF-16 length (the measure chat.MAX_TEXT uses); the bound comment says about twice TURN_LOG_MAX. 60/60.

## Review 2 (sonnet), and what changed
- No BLOCKER. WARNING: the line was dated when it ran, not when it arrived; a line waiting behind a long turn would
  read as a late send. Each line now records `arrived` (when it reached the front, any kind; a digest by its first
  post) beside `at` (tested: a waiting line's arrival precedes its run). WARNING: test titles over-claimed: the order
  is now asserted (each line logged before its own turn), and the busy claim is gone from the title. WARNING: a folder
  at .1 stopped logging for good: the file is cut instead, and logging goes on (tested). WARNING/NITs: the comment
  states the 60-character colleague opening, one line per turn, and the unguarded swap window (the hard-link claim was
  wrong; corrected in review 5). (the suite then: 61 tests).

## Review 3 (opus), and what changed
- BLOCKERS: Escape cleared the DM receipt times but not the arrival map, and the second-stop path dropped lines
  without taking their arrivals, so a later identical line inherited a dropped copy's (hours-old) arrival: the false
  "old line acted on again" signal F7a looks for. Escape now clears the map; the second-stop path takes them.
  WARNING: the second stop's note now records its arrival. Tests drive both (Escape then the same words; a double
  stop). NIT: the digest-date comment says it is the first post even when the cut leaves it out.

## Review 4 (sonnet), and what changed
- No BLOCKER. WARNINGs: the digest's folded-post cleanup and the first stop's drop had no test that failed without
  them, and the digest's date (its oldest post) was unasserted: three tests now drive them (each mutation measured to
  fail). The comment says a colleague's words, even a pasted secret, can reach the 0600 file.

## Review 5 (opus), and what changed
- No BLOCKER. WARNING: the folder may be the person's git repository (as the Inbox's .gitignore notes), so colleague
  openings could ride a `git add .`. The log now writes only where git ignores it: it creates .kosmos/.gitignore naming
  its two files when none exists, and writes nothing when one exists that does not name them (tested both).
  WARNING: the comment and this plan claimed keepModel parity for hard links, which was false (keepModel renames a
  temp): the open is now refused for a link count above one (tested). 66/66; both new guards mutation-checked.
- NITs noted, not taken: the fifo/link tests reach the lstat guard, not the open flags (the flags only matter in the
  swap window, stated as unguarded); a colleague quoting a stamped reminder logs a `sent` (kind and opening tell it).

## Review 6 (sonnet), and what changed
- No BLOCKER. WARNING: an existing .gitignore naming only muse-turns.log let rotation move the text into an unignored
  .1: both names are now required (tested). WARNING: the cut-on-blocked-rotation ran before the link-count check, so
  a hard link could have its other name emptied: the link count is checked at the lstat, before any rotation (tested).
  WARNINGs (comment): the ignore check is exact-line, not git (fail closed for /x or *.log); a digest's opening is its
  first post.

## Review 7 (opus), and what changed
- BLOCKERS (file-scanning guards a musefront-only run cannot see): the fifo arm's `process.platform` branch tripped
  engine/windows-tests-1777's host-branch check (the arm now runs only where mkfifo exists, with no platform branch);
  the rotation's rename tripped engine/caches.fsync-5434's move count (EXPECTED moves: 1, noted as a diagnostic log's
  rotation, as filepreview's). Every test naming musefront plus the standing guards now pass, each file run alone.
- WARNING: nothing tested the production wiring (the default logger): a test runs createFront with no log against a
  real folder (a no-op default fails it). WARNING: the .gitignore read is now bounded and non-blocking
  (workerfile.readWorkerFile, as keepModel reads). NITs taken: tz (local offset) beside the local Sent stamp; a
  blocked rotation cuts the opened file (ftruncate), not the path; the header says "hands to Muse".

## Review 8 (sonnet), and what changed
- No BLOCKER. WARNING: a later "!muse-turns.log" in the .gitignore read as ignored: any negation naming the log now
  reads as not ignored (tested). NITs: the guards comment sits on logTurn; the header says the hard link is refused at
  the lstat and after the open; tz notes daylight saving and its sign is asserted; "The call" lists every field.

## Review 9 (opus), and what changed
- No BLOCKER. WARNING: the negation guard only caught "!...muse-turns"; "!*.log" or "!*" un-ignored the log while both
  names were listed: any "!" line now reads as not ignored (tested with three spellings). WARNING: words the person
  types straight into the pane have no envelope and kept an opening: openings are now kept only for an allowlist of
  envelopes (a colleague's message or room post, a Kosmos line), still never for a line holding the person's
  envelope (tested, with a colleague control). NITs: tz is checked in a fixed zone (Chicago, -360) so a UTC CI checks
  the sign; new tests use mkTemp; the header says a .gitignore is created.

## Review 10 (sonnet), and what changed
- BLOCKER: the "[Kosmos:" allowlist entry let "[Kosmos: you were given task N in "...": <the person's task>]" keep an
  opening with the person's words. Dropped; the allowlist is a colleague's message or room post and "Kosmos here:"
  (the community reminders F7a needs). Tested with a task line. WARNING: a digest's opening was its first post's
  envelope, no words: it is now that post's words (tested). WARNING: the "Kosmos here," (comma) nudges are left out on
  purpose (they can carry a task title), stated in the comment.

## Review 11 (opus), and what changed
- No BLOCKER. WARNINGs: the "holds none of the person's envelope" half of the guard had no test that could fail
  (now: an allowlisted line with the envelope later keeps no opening); the answering-quote path was untested (now: a
  room reply in messages.js's shape keeps its own words, not the quoted ones). CONVENTION: "The call" names the
  allowlist. NITs: comments on a typed imitation of an envelope, whose clock tz is, and the precise swap window.

## Review 12 (sonnet), and what changed
- No BLOCKER. WARNING: the ignore check reads .kosmos/.gitignore as text; a log git already tracks stays tracked
  (spawning git every turn was rejected): the comment says so. WARNING: a "Kosmos here:" line with an early "]" lost its
  start to shortOf's envelope cut: those lines keep their own first 60 units (tested). WARNING, stated not fixed: a
  colleague who relays the person's words without an envelope puts them in that colleague line's opening; the file is
  0600, git-ignored, in the agent's own folder (goes in the PR description).

## Review 13 (opus), and what changed
- No BLOCKER. WARNING: the lstat link-count check is a second layer (the after-open check and the cut-on-descriptor are
  what protect the other name, and what the tests reach): the header and the review-6 note say so, no longer
  "(tested)". NITs: "created 0600"; the allowlist comment names its dependency (no person's words in a "Kosmos here:"
  line's first 60 units); a busy-retried stop note is one line; the plan says one line per turn.

## Review 14 (sonnet), and what changed
- No BLOCKER. WARNING: review 13's note said the tests reach the after-open check; review 14 said the lstat one.
  Measured: removing either alone leaves the suite green, removing both fails it. The header and plan now say the
  tests prove the pair, not each layer. NITs: the allowlist comment says the agent's own post title can appear; tz
  differs from Sent's clock only under a different TZ setting. Not taken: a pane line when the log is off (the
  .gitignore rule is fail-closed and stated; the seat notes look for the file).

## Review 15 (opus), and what changed
- No BLOCKER. WARNING: chars and spillWords cannot say whether a spilled post was over 10000 characters (chars is the
  shortened line's): spillBytes now records the saved copy's size, read from the agent's own Inbox (bytes >= chars), so
  under 10000 bytes proves under the limit (tested, with a missing copy recording null). NITs: a retried stop note's
  one log line is asserted in the existing busy test; the attachment-trailer path in a short post's opening is stated;
  "The call" says ".gitignore lists" (text), not "git ignores".

## Review 16 (sonnet), and what changed
- No BLOCKER. WARNING: spillSizes lstat'ed any path a line named (a colleague could probe a file's size, or stall the
  front on a network mount): the size is now read only for a path that is exactly a file directly in
  <workspace>/Inbox (normalized, no ".."), else null; nothing else is touched (tested with ../ and an outside path).
  WARNING: words and sizes came from two regexes and could misalign: one match now yields both, a non-Inbox path
  giving null in its place (tested with a mixed line). The path is bounded to 1024 characters. If a Meta agent's
  Inbox is not <workspace>/Inbox, spillBytes is null: the safe miss, to read on the next report.

## Review 17 (opus), and what changed
- No BLOCKER. WARNING: the board's limit applies to the whole typed line (envelope + body + notes), so spillBytes alone
  could point at Meta for a by-design spill: envChars (the envelope through its first "]") is recorded beside it, and
  the comment and "Not known yet" say how to read them (UTF-8 bytes equal characters only for ASCII). WARNING: a
  linked Inbox let the size lookup leave it: the Inbox must be a real directory, not a link (tested, and a link at a
  file inside it). NIT: only .kosmos is ever created, never a missing workspace (tested).

## Review 18 (sonnet), and what changed
- No BLOCKER. WARNINGs: envChars measured a digest's header and was one number for several spills: it is now one per
  spill, read on that post's own line, paired with spillWords and spillBytes (tested in the digest). The garbled
  bytes-versus-characters sentence is rewritten; "The call" lists envChars and the .gitignore creation.

## Review 19 (opus), and what changed
- No BLOCKER. WARNING: the first stop note's own arrival was untested: asserted. NITs: a spill path ending in a
  separator is refused (it could stat through a link outside the Inbox); the envChars comment allows slack for a
  reply's quote and catch-up notes, which the board counts too.

## Review 20 (sonnet), and what changed
- No BLOCKER. WARNINGs: bytes bound characters only from above, so a high spillBytes on non-Latin or emoji text
  proves nothing (stated beside the reading rule); a ")" in the workspace path makes spillBytes null like a missing
  copy (stated); a linked .gitignore is refused (tested).
