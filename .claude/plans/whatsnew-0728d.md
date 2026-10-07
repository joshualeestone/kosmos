# whatsnew-0728d: entry 5 of the 0.7.28 highlights (#5481)

Follow-up to whatsnew-0728 (PR #5503), whatsnew-0728b (PR #5505) and whatsnew-0728c (PR #5509). The full plan, entries, exclusions and wording history are in .claude/plans/whatsnew-0728.md (section "Follow-up").

## Entry 5 (the last of 5 slots)
- Feature: #5481, PR #5504, merged 17:16 CDT 10-07 (GitHub reports f8bb57a23 as its merge); on main, not in the 0.7.27 pin f443ad947, before the 22:00 freeze.
- Platforms: Mac only ("platforms": ["mac"]): the pill is drawn by web/index.html only when the Mac app sends canOpenSettings (native-app/main.swift opens the pane); Windows, browsers and phones get the directions sentence instead.
- icon chat; title "The mic button opens the setting it needs" (Mona's, 41/48); line 134/140.
- "Turn on in Settings" is the pill's own label (web/index.html, aria-label).
- Cut from Renet's suggestion: "and the mic starts by itself once you allow it". The full round trip through System Settings has not been seen on a real Mac yet (Renet, 17:16; the app logs it on first use), so the line does not promise it. Renet's line was also 183 characters, over the 140 cap.
- Copy: Mona, 17:17. Line approved as is, cut confirmed (the code restarts the mic on "allowed", but nobody has seen the round trip on a real Mac). "Opens the right page" is true: only the Microphone or Speech Recognition pane, whichever is off (main.swift VoiceBridge.settingsURL, pinned by its selftest). Title changed from Renet's "Turn on the microphone in one click": the click opens System Settings and the person still flips the switch, so it is two steps; the new title says only what the click does.

## Check
node tools/whats-new-check.js 0.7.28: 5 highlights, mac 5, windows 4.

## Review (1 iteration, sonnet, blind)
- WARNING fixed: "is off" overclaimed. The pill shows only for a refused mic or speech permission (mic-denied, speech-denied); a mic restricted by Screen Time or a profile, or never asked, gets a sentence and no pill. Now "is turned off for Kosmos" (Renet's own phrase), 134/140. Mona told after the fact.
- NIT deferred: under 480px or in a text field the visible label shrinks to "Settings" (the aria-label stays "Turn on in Settings"); the Mac app's normal window shows it whole.
- NIT fixed: the platforms line now says web/index.html draws the pill and main.swift opens the pane.
