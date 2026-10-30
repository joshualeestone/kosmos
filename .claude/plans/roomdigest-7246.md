# kosmos#7246 slice 1: a big room's unaddressed posts reach idle members as an hourly digest

Cause: the turn-end flush (#4624) told every held post, and that line started a turn whose end flushed again, so in a
busy room an idle member never stopped (one agent over 1,000 turns a day).

## Build (engine/roomhold.js, server.js)
- noticeMode(project): 'each' | 'digest' | 'named'; the project's own roomNotices wins, otherwise digest above 8 members.
- flushOnIdle: in a digest or named room, only @ posts that ask for an answer are told at a turn end; the rest wait.
- flushDigests (minute sweep): a due digest, at most one an hour per project, to members not mid-turn. A refused one
  backs off 10 min. The digest line says not to reply or write about it.
- flushReleased passes the mode to its flushes. The KEEP cap drops unasked posts before asked ones. Digest times are
  kept on disk and in memory. The mode is read from projects.json at most every 30 s.

## Not in this slice
- Slice 2: the roomNotices setting in the project's settings (page work, design shots).
- Slice 3: measure an idle member's turns over a busy hour, before and after.
- Members with no fresh report are not held at all (#4624 behaviour, unchanged).
