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
