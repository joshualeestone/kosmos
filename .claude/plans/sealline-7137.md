# sealline-7137: the line above a sealed or waiting shared room, on the iPhone

Card: kosmos#7137 (filed by me from a board-vs-phone sweep; the board's #pj-fed-own-phone, #4658 slice 2).

## What
- BoardLogic.swift: Board.fedGateMode and Board.fedShown(fromStatus:), the board's fedGateMode/fedShow() from the status
  poll's sourceChannel, federationLive and kosmos_plus (real JSON true/false only, as the board's === checks). In
  BoardLogic, not BoardRoom, because BoardClient calls it and three suites compile BoardClient without BoardRoom.
- BoardClient.swift: fedShown, set from each status read, forgotten with the Mac (forgetToday).
- BoardRoom.swift: ownCompareRequest (GET /api/federation/own-compare?project=), parseOwnCompare (a code is a non-empty
  string, pending exactly true; the code itself is never kept), ownSealLine and the two sentences.
- ProjectsView.swift (RoomStore): ownCompare by project, read after each room read and only while fedShown; any
  answer that is not a readable 200 (404 with sharing off) leaves no line; reset() forgets it.
- RoomView.swift: the line above the conversation, under the search bar, in .callout and Palette.tertiary, plain words
  (the board's .ownseal-phone: --text-callout, --label-3, a plain <p>).

## Decided (design, reversible)
- Words: the board's two sentences with "under Members" said as "on your computer's board, under Members", because the
  phone has no Members code section (its Members button opens the board). The card first said the line would link
  there; the board's line is plain text and the toolbar's Members button already goes there, so plain text.
- The phone sends Sec-Fetch-Site on every request (#7075), so own-compare's isViaScreen gate lets it read; it reads
  the code only to know one exists.

## Checks so far (12:58 CDT)
- run-room 413/413, run.sh 1223, actions 99, settings 42, tasks 90, taskpage 108; route check 5/5; Debug and
  KOSMOS_STORE_SHOTS Release builds.
- Broken-copy controls: staging ignoring a real false -> red; the line without the UI gate -> red; the drawing
  deleted -> red.

## Review
