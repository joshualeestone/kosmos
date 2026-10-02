---
pre_challenge: true
method: challenge-loop
branch: selfname-4873
diff_hash: 9a5cb2f1deabd88dc6db7462ffb0785098312f531e13cf9e9b78aeb7d3ec9b97
subdir_audit: passed
timestamp: 2026-10-02T04:16:18Z
converged: true
---

## Challenge loop: 6 blind rounds, Opus and Sonnet alternating; the last found no new BLOCKER, WARNING or CONVENTION

Ledger in `.claude/plans/selfname-4873.md` (Review rounds: every finding and its disposition).

## [WARNING] Round 1 (opus)
FIXED BLOCKER: the room's quotes (#460) slice the stored text by offset, and the drop happened before 
them, so every quote was off by the prefix. Now each quote moves back by the dropped length, and a quote starting 
inside the prefix leaves the post as written; two tests in web.quoteb.test.js, and drawing without the shift reds one. 
FIXED W: leading blank lines after the drop ("**Dario:**\n\nhello"); the em dash as a separator (written as an escape, 
so the file holds none); the room tries the header's own name (pjNameOf, which also names a former member) first. 
NOTED (corrected in round 5): an external post (kind 'external') is drawn by pjRoomRow's own early branch as plain 
text and never reaches pjRoomBody, so nothing is dropped from it.

## [WARNING] Round 2 (sonnet)
FIXED W: a dash separator needs a space on both sides, so "Dario -- hello" and "Dario -5 degrees" 
are left whole (controls added). FIXED W: only blank lines are removed after the drop, so an indented first line keeps 
its indent. DEFERRED W: the Ask Kosmos guide panel (.asp-m) is Kosmos's own assistant drawn as plain text, not a named 
agent in a room or a DM, so it is out of this card's scope. Left NITs: pjMentionKeys built twice per post; the wiring 
pins are source-text pins; "above every message" also covers grouped posts (the header above them).

## [WARNING] Round 3 (opus)
FIXED W: the reply surfaces (the room's and the DM's reply header, the composer's Replying-to strip, 
the screen-reader line) read the raw text and said "Dario: Dario: ..."; pjReplyGist(m, who) now drops it with the 
name it sits beside, every caller passes it, and a test pins that no one-argument call is left. FIXED W: the card's 
control is now run through the room renderer (pjRoomRow) and the reply gist in web.quoteb.test.js, a person's post 
included. Left NITs: an agent named with an ordinary word ("Update") loses that word at the start of a message 
(the header still shows it); single-star emphasis is not handled; pjMentionKeys built twice.

## [WARNING] Round 4 (sonnet)
FIXED W: the room's call is guarded like the DM row's and the reply gist's, so a test that lifts the 
room renderer without the helper does not throw. FIXED W: a tight colon does not count when a slash or a digit follows 
("Dario://host", "Dario:30 minutes" are kept). FIXED NIT: a name followed only by spaces is kept whole. 135/135 across 
the new tests and the renderers' lifted tests.

## [WARNING] Round 5 (opus)
FIXED W: the blank-line cleanup after the drop takes Windows line endings too (\r\n), with a test. 
Left NITs: a bare bold name with no separator ("**Dario**\n\nhello") is kept (conservative); pjMentionKeys twice; the 
source pins' fixed window.

## [WARNING] Round 6 (sonnet)
its one W (the ordinary-word name) repeats round 3's noted case; now named in the weakest premise. Converged.
- Full validation on Mortals (236943820): 13,745 tests, 1 failed: engine/create.test.js's boot-file size canary (a pm 
boot file under MAX_BYTES / 6). Measured: main passes it; this branch's new section (about 280 bytes) took it to 43,938 
bytes of text against a 43,690 line. As on 2026-09-26 (/ 8 to / 6), the line is raised to / 5 with the measurement 
written beside it; still about 6x under the real 262,144 cap. 214/214 create tests. (Main then moved the same line 
to / 5 itself, so after merging main this branch no longer changes engine/create.test.js.)
- After the outage (2026-10-01, fresh session): main merged in. Round 1 (opus): FIXED W: a self-name is matched in its 
exact case, so a label-like name ("Status") keeps its word. Round 2 (sonnet): FIXED W: an external post's reply gist 
is drawn as written, like its row; DEFERRED W: the /5 canary (now main's own line); DUPLICATE W: label-word names 
(weakest premise). Round 3 (opus): NITs only. Converged.

## After convergence
Mortals validation passed at 9e4878b8c (EXIT=0, 22:57). Main then took doctrine version 21 for #4624 (Who a room post
wakes), so the merge renumbers this card's section to doctrine 22: both version-log entries kept, both tests kept,
DOCTRINE_VERSION 22 with its fingerprint pinned (03e6a056085231c8). defaults, doctrine and doctrine-consent tests green.
CI runs the full suite on the PR.
