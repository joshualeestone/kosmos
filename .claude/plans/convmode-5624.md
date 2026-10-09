# convmode-5624: conversation mode, new agent messages read aloud as they arrive (kosmos#5624)

Josh, #admin 2026-10-08 17:22: "conversation mode ... as soon as an agent posts in a project or direct agent message
it plays audio. This low priority."

## Finished looks like
A toggle beside the mic in an agent's Direct Message box and in a project room's box. While it is on for that
conversation, each new message from an agent there is read aloud as it arrives, with an on-device voice; nothing
already on screen is read; the person's own messages are not read; a newer message stops the one being read; turning
it off stops it. The state is visible on the button and remembered per conversation on this computer.

## Built
- web/index.html: .convbtn CSS (shown where the page can speak, html.has-speak); #d-conv and #pj-conv beside the mics;
  the conversation-mode block after #4409's read-aloud (convFollow, convSpeak, convStop, convPaint, the pure
  convNewMids and convOpening); convFollow called after paintTalk's and paintRoom's unread-edge step.
- docs/browser-checks/render-convmode-5624.js (C1 to C9), registered in gated.txt, the README and SITE_COUNTS.

## Decided (the card's reversible calls)
- On-device voices only (the #4409 voice picker); provider voices later. Weakest premise: some computers have only
  network voices, and then nothing is read (the per-message button already says why when pressed).
- Interruption: the newest message wins; two at once read only the newest. The person speaking is not yet detected as
  an interruption (the mic and this are independent); turning the mode off stops it.
- Long messages: the opening up to 600 characters, cut at a sentence end, not a summary (no model call).
- Code blocks: announced as "Code block", not spelled (#4409's tidy).
- Remembered per conversation in localStorage (kosmos.convmode); a hidden window does not talk.
- Phone later (the card says so).

## Review log
- **Round 1 (opus, blind):** 0 BLOCKER, 7 WARNING, 2 CONVENTION, 2 NIT. All fixed:
  - a direct thread drawn empty never read the agent's first reply: seeded empty (C10);
  - the toggle kept the last conversation's state on an empty or unreadable paint: painted at the top of both painters;
  - coming back to a conversation read what arrived meanwhile: re-marked as heard on any change of conversation, after a
    search, and after a hidden window (C11, C12);
  - leaving or hiding did not stop speech: each piece checks the view and visibility, hiding stops it (C12b);
  - Chrome's empty voice list lost the first message: wait for voiceschanged once (C13);
  - speech into a listening mic: nothing is read while the mic listens (C14);
  - outside guests (.ext) were read: agents only;
  - tests that could not fail: the room is drawn by the real paintRoom (C8), C6 checks the cancel comes first, and
    C10, C11, C12b, C13, C14 were run against the first version and were RED there.
  - CONVENTION: the pressed colour used an undefined token; now the ink colour, which follows dark mode. CONV.key is
    cleared when speech ends. NIT: one stable label (the pressed state says on/off).
- **Round 2 (sonnet, blind):** 0 BLOCKER, 3 WARNING, 1 CONVENTION, 3 NIT.
  - WARNING (fixed): turning the mode off during Chrome's voice-list wait did not void the wait. Off now bumps the
    sequence, and convSpeak returns when the mode is off. C13b added: RED on the round 1 page, green now.
  - WARNING (fixed): leaving a conversation stopped speech only at the next piece. The #4409 half-second watch now also
    stops conversation mode when the view changes. Not testable in the hermetic check, which stubs the timer; covered
    by reading, and C12b covers the hidden-window stop.
  - WARNING (fixed): "on" was hard to see: a 2px ink ring. With no on-device voice the on button now says so.
  - CONVENTION (fixed): hover uses the ink token (dark mode). NIT (fixed): the mic and a hidden window are re-checked
    after the voice-list wait. NIT (noted): a mode remembered from storage may be silent after a reload until the page
    is interacted with (the browser's autoplay rule); stored keys are not pruned (one small entry per conversation).
- **Round 3 (opus, blind):** 1 BLOCKER, 2 WARNING, 3 NIT. All fixed:
  - BLOCKER: a direct thread holding only OTHER agents' rows counted as empty, so it was re-seeded on every paint and
    its newest row read on open and on every poll. Now empty means no row any agent wrote, and a followed conversation
    is never re-seeded. C10b: RED on the round 2 page, green now.
  - WARNING: the guest exclusion was claimed but untested. C8b posts a real external row: RED on the first version
    (it read the guest), green now.
  - WARNING: pressing the mic while a message was read let the voice play into the dictation. Starting to listen now
    stops conversation mode and any per-message reading.
  - NIT: the no-voice notice now lasts across paints and reaches a screen reader (aria-label); the heard set holds
    only what is on screen; the search box's repaint is guarded to the agent on screen (as talkPaintPending is).
- **Round 4 (sonnet, blind):** 0 BLOCKER, 2 WARNING, 3 NIT, and test gaps. Fixed:
  - WARNING: a search matching nothing skipped both follow and pause, so a message that arrived during it was read late
    after clearing. Any active search now pauses (top of paintTalkThread). C15: RED on the round 3 page.
  - WARNING: the no-voice notice was global and sticky. The toggle resets it. C16: RED on the round 3 page.
  - Test gap: the mic stop is now tested through voiceToggle itself (a recording dictation bridge). C17: RED on the
    round 2 page (before the stop existed).
  - Not given an arm, on purpose: "never re-seed a followed conversation". Since the heard set holds only what is on
    screen, a thread with no agent rows has an empty set either way, so no arm can tell the clause apart; kept as a guard.
  - NIT (decided, kept): leaving to a view that is not a conversation and coming back to the SAME one may read what
    arrived meanwhile, if the thread kept polling. Kept: it is one message, the newest, and only while the mode is on
    there. NIT (kept): a newest row with no words skips the earlier ones (rare; documented here).
- **Round 5 (opus, blind):** 0 BLOCKER, 1 WARNING, 2 NIT. Fixed:
  - WARNING: my round 4 "kept" decision rested on a wrong premise. I wrote that coming back to the same conversation
    might read a late message "if the thread kept polling"; the reviewer measured the opposite: both polls stop while
    their view is hidden, so it happened EVERY time, possibly hours late. Now a conversation not followed for more
    than 12 s (two polls) counts as first sight on its next draw. C18: RED on the round 4 page, green now.
  - NIT: a browser that never fires voiceschanged now gets the no-voice notice after 3 s. NIT: C3's label now says
    only what it tests.
- **Round 6 (sonnet, blind):** 0 BLOCKER, 2 WARNING, 2 NIT. Round 5's 12 s gap rule was the wrong mechanism:
  - WARNING: a slow poll or a long send could exceed it while the person watched, so a real new message was skipped
    silently; and an empty thread's first reply was skipped if it came after 12 s (the empty arm never refreshed the
    clock). The clock is GONE. Instead, opening a conversation is an explicit first-sight mark: openDetail and entering
    a room (PJ_CURRENT = id) call convPause. No time-based rule remains, so no stall can skip a message.
    C18 now goes through the real openDetail with the message already there: RED on the round 4 page, green now; C10
    (empty thread, first reply) passes again.
  - NIT: the 3 s no-voice fallback was checked and does not misfire. NIT (kept): the room's empty case has no arm; the
    room always reaches convFollow, so it has no seeding rule to test.
- **Round 7 (opus, blind):** 0 BLOCKER, 1 WARNING, 2 NIT. Fixed:
  - WARNING: ways back into a room that skip openProject (a tab change and back; leaving tasks, settings or docs)
    still read the newest message late. Now a conversation is also marked on the way OUT: pjView leaving 'one', and a
    real showTab change (not the layout re-check with the same tab). Nothing draws while the person is away, so a
    leave mark cannot skip a message they are watching for. C19: RED on the round 6 head, green now.
  - NIT (fixed): openDetail's mark moved below its `if (!a) return`, so a deep link still waiting for its agent cannot
    re-mark the room the person is in.
  - NIT (kept, said here): clicking the agent already on screen re-marks its thread, so a message that arrived after
    the last poll and before that click is not read. Only on the person's own click; rare.
