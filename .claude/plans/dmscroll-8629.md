# dmscroll-8629: a failed DM poll keeps a scrolled-back reader's place

Card: #8629 (Josh 2026-11-17 09:02). Owner: Baron Draxum.

## What was measured (PROVEN)
- Fixture with the page's real 5 s poll, WebKit and Chromium: new messages, working/idle flips and the
  200-message window do NOT move a scrolled-back reader (anchor restore holds). Also with a replay of a
  real 200-message DM.
- Real board, read-only (token header, every non-GET aborted), 5 min each: Splinter's DM (no traffic),
  Irma's DM with live traffic (6 messages) sitting still 600 px up and slow-wheeling: zero unexplained moves.
  Control: at the floor new messages bring the reader down (9 pins, both engines).
- ONE failed /thread poll (502): the thread is replaced by the note for a poll and comes back; with a
  message arriving meanwhile, back 534 px off. Both engines.

## Change
- paintTalk failure arm: a transient failure while a list is showing keeps the rows and adds one line
  (`p.dm-readfail`, role=status) at the thread's end; a reader at the floor is kept there. The next good
  read removes it. #d-talk-older/#d-dmoff stay as they were when the rows stay.
- Unchanged: the standing refusal (404 borrowed), a box with no list yet, a 200 whose messages are null
  (server says it cannot read the file; render-dm-earlier-5841 holds that).
- New gated check render-talk-readfail-8629.js (red with the fix reverted: 5 problems).

## Weakest premise
That a failed poll is what Josh hit. The local and live runs never moved him; a failed poll is the only
path found that does, and it fits "after a while" over a remote board. Not observed on his Mac. After merge
and serving, ask nothing of Josh; watch for a repeat report.
