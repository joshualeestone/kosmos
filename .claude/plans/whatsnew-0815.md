# whatsnew-0815: What's New for the 0.8.15 cut

## Why
Splinter called a 0.8.15 staging cut at 03:49 CST 11-22. The cut's step 1b-ii refuses unless web/whats-new.json is for
the version it cuts and the pool records what prod serves. Prod has served 0.8.14 since 02:38 CST, and the pool still
recorded 0.8.13 (the same refusal that cost the 0.8.14 re-cut at 21:46 on 11-21). So this goes in before the cut.

## What
`node tools/whats-new-pool.js build 0.8.15`. Its prod sync marked 0.8.14's 5 highlights shown (shownIn 0.8.14) and
set lastProd 0.8.14. Hand edits to the pool, each a decision recorded here:
- RETIRED two Windows-only items, as the tool's header asks ("once Windows prod has shown it, retire it by hand"):
  "Windows Settings stops a false warning" and "Removing Kosmos takes out its agent hooks" are in 0.8.03's window
  (read at its v0803 commit). Windows 0.8.03 carried them. Windows 0.8.04's file still says version 0.8.03 with no
  "also", so 0.8.04 showed them only if its release branch added "also" by hand (both builds signed by me on 11-11). Status shown,
  shownIn 0.8.03.
- "A little more room between chat lines" stays UNTAGGED. It is in the 0.8.01, 0.8.03, 0.8.04 and 0.8.05 windows,
  so Windows users on any of those builds have probably seen it. Mac prod never served those versions (no Mac promote
  recorded 0.8.01 or 0.8.03 to 0.8.05; the two retired Windows items' shownIn 0.8.03 is a Windows record), and we assume the same for Linux, which is promoted with the Mac family (the pool
  records Mac promotes only, so that is not checked from here), and the engine cannot tag "mac and
  linux, not windows": a mac tag hides it from Linux (platformOf() gives Linux no tag; review 3). DECISION: a repeated
  true line on Windows costs less than a missing one on Linux, where the Cloud customers are. Its line now reads
  "Messages in an agent conversation now have a little more space between lines." (review 3: the rule applies wherever
  the board renders, so "in the app on your computer" was narrower than the change).
- Two lines reworded on Mona Lisa's copy read (fleetreleases m5879): "A closed task says how it closed" and "A paused
  room says why it stayed quiet" (her text, which drops "a room's wake pause", our word, not the person's).
- "A paused room says why it stayed quiet" marked notesOnly (review 5): the note it describes goes only to an AGENT
  whose post woke no one during the automatic loop pause (engine/messages.js), never to a person, whose posts are never
  paused that way. To a person, "a paused room" reads as the Pause button, which this does not cover. The tool keeps
  notesOnly items for `kosmos whats-new`, where agents read them. "A closed task" now says "on a note", the board's words.
- "The restart note says what was checked" KEPT tagged mac, as main has it. Review 6 untagged it to reach Linux; review
  7 showed the tag is deliberate: it was mac-tagged in every window that carried it (0.8.01, 0.8.03, 0.8.04's file,
  0.8.05), for the reason in .claude/plans/whatsnew-0801.md ("not run on Windows, and it can name an agent that came back
  and was stopped"), and engine/restartnote.js still names a returned agent on Windows. So untagged, the line could be
  false on Windows. DECISION: a missing line on Linux costs less than a partly false one on Windows. Mac prod never
  served 0.8.01 to 0.8.05, so it is new to Mac users.
- A little more room between chat lines
- The restart note says what was checked (mac)
- A just-started agent gets your first message (Windows; in no earlier window)
- A closed task says how it closed
- A new Cloud machine can be allowed (untagged; in no earlier v08NN window, searched with a positive control)
Per platform: Mac 4 (all but the Windows-only just-started line), Linux 3 (the three untagged lines; the engine gives
Linux no tag), Windows 4. Repeat acknowledged: on Windows, the chat-spacing line, if a Windows user had 0.8.01, 0.8.03,
0.8.04 or 0.8.05. Omission acknowledged: Linux does not get the restart-note line. web/whats-new.json is never hand-edited. Review 3 checked every line against each v08NN window from 0.8.00 to 0.8.14.

## Rejected
- Tagging the chat-spacing line mac (review 2's suggestion, made and then reverted): it hides a true line from Linux.
- Hand-picking lines: the tool chooses by rank and platform. The next pending item after the five is at 11.5; the `kosmos ... --how` ones are notes-only, which the tool keeps out.

## Weakest premise
That Windows prod served a build carrying 0.8.03's window. Its only evidence is that Windows 0.8.03 and 0.8.04 were
signed on 11-11; nobody read Windows prod's pointer history. If it is false, the two retired lines were never shown on
Windows prod, and retiring them costs two true lines. The untagged chat-spacing line does not rest on it.

## Checks
- `node tools/whats-new-check.js 0.8.15` (mac 4, windows 4) and `prod-check` after the build.
- What's New and release-notes tests; the full suite.
