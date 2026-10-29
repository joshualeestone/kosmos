# chatshift-7575: the iPhone chat reports its own sideways shifts to the person's board

Card: kosmos#7575 (Splinter's follow-up to #7420; Josh does not run diagnostics, so the shift's cause must report itself). Shape decided on the card (comment 6503443696).

## Finished looks like
A chat open in which the side lock counted a sideways shift sends one record to the person's own board when the chat closes or the app goes to the background; an agent on that Mac reads it at GET /api/phone/chat-shifts. Numbers, versions and row-kind words only. A chat with no shift sends nothing.

## Change
- engine/chatshifts.js: the board's store (store.ROOT/phone-chat-shifts.json, last 50). Every field checked against its shape, anything else dropped; never throws; an unreadable file is never overwritten.
- server.js: POST /api/phone/chat-shift (an agent token is refused), GET /api/phone/chat-shifts (any admitted caller).
- ios/Kosmos/BoardLogic.swift: ChatShiftReport (count, largest offset, any while scrolling; at the largest: widths, keyboard, row kinds), chatRowKinds, chatShiftRequest, deviceModel.
- ios/Kosmos/ChatView.swift: SideScrollLock tells the chat of each new shift (a turn later, off the layout pass); the chat sends one report per open (onDisappear or background), through client.throughMac.
- Tests: server.chatshifts-7575.test.js (5); LogicTests main section; room suite's lock check reads the new attachment.

## Measured
- server.chatshifts-7575.test.js 5/5; mutation (keep unknown fields): exactly the field-dropping test fails.
- iOS logic suites: main 1682/1682, actions 99, agentinfo 83, composer 65, newtask 108, room 723, settings 42, taskpage 109, tasks 103: all pass.
- 11 repo tests that read ios/ + the route test: 87/87. Mutation (board route renamed): server.ios-routes-6838 fails naming POST /api/phone/chat-shift at BoardLogic.swift.
- Simulator (Debug, iPhone 17 Pro, iOS 27): forced shift, then two trips to the background: trace "side offset" 1, "shift report sent" 1. Control with no shift: 0 sent. (The sample board has no Mac, so the send itself is covered by the request test and the route tests, not by a live round trip.)

## Weakest premise
That the row kinds on screen at the largest shift name the culprit. If SwiftUI's anchor on an off-screen row causes it, the record shows widths without the cause; next step would be recording the anchored row's kind.

## Ledger
- Validation 1: above.
- Review 1 (blind): 0 blockers, 4 warnings, all TAKEN: largest was a shift's start not its peak; a return from the background never reported; the info page split one open in two; per-shift state writes and row walks. Nits taken: 4 KB body limit, versions digits only, records re-checked on read, rounding, a JS test pinning the app's kinds and fields to the board's (mutation: an extra Swift kind fails it), never sent after a computer switch. Not taken: a kosmos CLI verb to read records (the file and GET are enough for now).
- Rebased on main after #7574 (clean; both changes present).
- Review 2 (blind): 0 blockers, 3 warnings, all TAKEN: shifts between background and foreground dropped; a chat closed under its info page lost its report; one shift counted twice across the info page. Nits taken: a shift begun before the count; background time for the send.
- Review 3 (blind): 0 blockers, 3 warnings, all TAKEN: a fresh shift after the info page matched to the old one by size; a shift before onAppear wiped; sequences untested. Fix: a running count (Board.ShiftBox, flush sends and restarts), the decision pure (Board.sideShiftStep), sequence tests. Mutations: attach() resetting the count fails 3 tests; the peak not cleared at rest (with wasShifted dropped) fails 2. Dropping wasShifted alone is an equivalent mutant (the peak clears at rest), kept as a second guard.
- Review 4 (blind): 0 blockers, 2 warnings, both TAKEN: a shift resized during the move counted again (now grew or same); the lock's flag handling pinned in the room suite. Nits taken: countSeconds (renamed), whole shift count capped at 1e6. Not taken: background time before the Task (UIApplication must be on main, and the closure can run from deinit).
- Validation after review 4 (HEAD 3e17b1b7bc): logic suites main 1695, room 724, actions 99, agentinfo 83, composer 65, newtask 108, settings 42, taskpage 109, tasks 103, all PASS; route test 8/8; iOS readers + route test 90/90; simulator: shift then two backgrounds sends 1, control 0.
- Review 5 (blind): 0 blockers, 0 warnings. Nits, not taken (documented here for whoever reads the records): a shift that flips sign across the info page counts as the same one; `!was` beside `.new` is redundant; whileDragging also marks a shift that grew while dragging; a shift still in place across a background report is in neither count (follows from the review-2 rule).
- CONVERGED at review 5.
