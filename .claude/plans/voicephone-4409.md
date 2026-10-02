# voicephone-4409: voice slice 3, the mic and read aloud on phones

Card: joshualeestone/kosmos#4409. Josh, 2026-10-01 17:16: "Can we do it in mobile too?". Splinter's call (overridable,
on the card): yes to both read aloud and the mic on phones; the mic through the phone browser's own recognizer, saying
plainly who hears the audio; the Mac app stays on-device. Stacked on voicehold-4409 (slice 2): it reuses slice 2's
hold, tap and dialog mics, so it merges after it.

## Change
- `voicePhoneBridge`: on a PHONE (`(hover: none) and (pointer: coarse)`) with no Mac app bridge, the browser's
  recognizer (`SpeechRecognition` or `webkitSpeechRecognition`) behind the same interface as the Mac bridge
  (postMessage {op: start|stop|cancel} in; listening, partial, final, error, stopped out through kosmosVoiceEvent).
  `voiceBridge` returns the Mac bridge first, then the phone shim. So every mic (composers, dialogs, hold, tap) works on
  a phone unchanged, except that on a phone the mic is a TAP started from its click (a user activation; a touch press
  is not one, and a held finger opens the long-press menu), so hold-to-talk is a computer feature.
- On a phone a bar of its own at the top of the visible screen says who hears the audio, from the tap (before any audio
  can be sent) until listening ends; the box's message lines are left to the rest of the page. It says ("Apple" on an iPhone or iPad browser running Safari's engine, which has no navigator.userAgentData; another engine,
  allowed in the EU, gets no mic;
  "Google" on Android Chrome only, by its user agent AND its "Google Chrome" brand, so a rebranded Chromium fails closed; another Android browser gets no mic rather than a guess) and "Tap the
  mic to stop" (no Escape); a refused microphone or speech recognition points at the phone's settings.
- Read aloud: already drawn wherever the page can speak (speechSynthesis), phones included; the check now proves it.

## Decided, not missed
- A computer's browser (a fine pointer) gets NO mic, even where it has a recognizer: Splinter's scope is phones, the
  Mac app is the computer path, and Chrome on a computer would send audio to Google with no ask from Josh.
- Josh may still say to keep phone audio off Apple and Google until the native phone apps; then only the shim goes (one
  function), read aloud stays.
- Slice 1's header comment and its unit test said the page never builds a browser recognizer; both now state the rule
  as it is (phones only, never before the Mac bridge), and the test pins it.

## Weakest premise
That the browser's recognizer works inside the Kosmos+ page on a real iPhone at all (permissions, a page reached
through the relay, Safari's continuous mode). NOT MEASURED: it needs a real iPhone and a person speaking. The check
drives a recording stand-in on an emulated iPhone in Chromium. Second premise: the exact shapes in which Android
Chrome repeats results and iOS restarts its list (and whether either resends a list from index 0); the rules keep
finals once by resultIndex and handle the reported shapes, each pinned both ways, but none is measured.

## Tests
docs/browser-checks/render-voice-4409.js, on an emulated iPhone (touch, coarse pointer, an iPhone user agent, no
navigator.userAgentData as on WebKit) with a recording stand-in recognizer that behaves as a real one does on abort:
- Who can get the mic: P1 (phone yes; a computer's browser, a touch-screen Windows computer and another engine on an
  iPhone no), P1c (an iPad, which says Macintosh, yes), P1b (Android Chrome by brand yes; Samsung, Brave and a rebranded Chromium no), P18 (the Mac app's bridge
  wins on any screen), P12 (no bar, no audio).
- Saying who hears it: P1 (every mic's label from load, the Guide's too), P2a (the bar in the tap itself, readable in
  the top half), P5 (another message line untouched), P10 (the bar follows the visible area), P11 (inside a modal
  dialog too), P16 and P19 (Finishing on every stop), P20 (the Kosmos+ privacy line names the exception).
- Words: P2 (two results, spaced), P2c to P2f (repeats, resends, list restarts, real speech kept; the one declared loss
  pinned).
- Ending: P3, P3b (refusals and retry), P6 to P9, P8b, P13 (errors, throws, a stop with no end), P7 (ends by itself),
  P15 (a cancel then a new start), P17 (stops itself at 300 s, on a fake clock).
- P4 read aloud on a phone; P14 the DM composer fits at 390 px.
Every fix was mutated and each mutation reds its check with a non-zero exit (listed per round below).
web.voice-4409.test.js 22/22: the recognizer is reached only inside the phone shim, after the Mac bridge; a second
press stops through voiceStop and marks the stop.

## Review rounds
- Round 1 (opus): FIXED B: after a refusal the retry kept the refusal on screen and never said who hears the audio;
  the mic's own phone lines are now cleared at the tap (P3b reads the line in the tap's own task), and on a phone the
  who-hears line is said even over another message's line (P5). FIXED W: the start ran in the touch press, which is
  not a user activation; on a phone the mic is tap-only, started from the click (the stand-in records the event it
  was started in; moving the start back to the press reds P2); the same change removes the long-press menu and
  finger-drift holds. FIXED W: a throwing start() left the mic half on; it now reports an error and stopped (P6).
  FIXED W: results joined with no space ran words together (P2 sends two results). FIXED W: a touch-screen computer
  (a Windows tablet) matched the gate; it now also needs an iPhone, iPad or Android user agent (P1 control), and a
  secure page. FIXED W: who hears the audio is now in every mic's label from load, before the first tap (P1). FIXED
  CONVENTION: two comments still said the mic was Mac-only. FIXED NITs: refusals point at the browser's own settings
  (not Safari for everyone), a network error is named, the box is not focused on a phone (no keyboard over the thread;
  P2). Every fix was mutated and each mutation reds its check with a non-zero exit. LEFT: Android Chrome's continuous
  mode is reported to repeat earlier finals in later events; not measurable without an Android phone, named here as
  a premise beside the iPhone one. "Tap the mic to stop" kept (a screen reader user knows their own activation).
- Round 2 (sonnet): FIXED W: the Guide's mic is built after load labelled the page's mics, so on a phone it never said
  who hears the audio before a tap; labelled where it is built (P1 builds the Guide; removing the call reds it). FIXED
  W: "Google" was claimed for any Android browser; now only Android Chrome is named, and any other Android browser gets
  no mic (P1b, with a Samsung Internet control). FIXED W: the who-hears line overwrote another message's line for
  good; that line now comes back when listening ends (P5). NOTED (premise, already named): real recognizers on iOS
  and Android, including Android's repeated finals. NIT taken: the once-built shim's limit (an iPad gaining a
  trackpad) is named in its comment. Left NITs: a soft keyboard's own input stops dictation quietly through the
  box-changed guard (safe); the node pins are source matches, the browser checks carry the behaviour.
- Round 3 (opus): FIXED W: round 2's "put the covered line back" revived lines their owners had since retired (a
  search note, a load error the next poll had cleared). Replaced, not patched: on a phone who hears the audio is said
  in a bar of its own (#voice-who), so no message line is covered or restored (P5 retires the other line mid-listen
  and it stays retired). FIXED W: the disclosure appeared only once audio was flowing; the bar shows in the tap
  itself (P2a reads it in the click's own task). FIXED W: Brave on Android sends Chrome's exact user agent and was
  named Google; navigator.brave now excludes it, and DuckDuckGo and Vivaldi by name (P1b's Brave control; removing
  the guard reds it). NITs taken: the EU's other iOS engines are named in the comment; a session that ends by itself
  is pinned (P7).
- Round 4 (sonnet): FIXED W: the bar sat at the foot of the screen, where the composer, the mic and an on-screen
  keyboard are; it is now at the top of the visible screen (the visual viewport's top, which iOS pans with the
  keyboard). P2a asserts it is in the top half and clear of the mic; the old placement reds it (and "clear of the
  mic" alone did not, because this file:// page cannot lay the composer at the foot: found by mutating, noted in the
  check). FIXED W: the status region was created and filled in one task, then toggled through display:none, which
  screen readers often do not announce; it is now made once at load, empty and invisible but in the tree, and only
  its text changes. NOT MEASURED: a real screen reader announcing it. FIXED W: "Google" was a denylist over Chrome's
  user agent; it now also requires the "Google Chrome" brand, failing closed (P1b's rebranded-Chromium control).
  FIXED W: a recognizer constructor that throws (P9) and an error with no onend after it (P8) both left the mic and
  the bar stuck; both now end the session. NIT taken: a comment on the bar clearing during a switch between mics.
- Round 5 (opus): FIXED W: the bar was placed once and stayed put while the visible area moved (keyboard, scroll); it
  now follows visualViewport scroll and resize while it says something, and stops after (P10, both halves reddened by
  their mutations). FIXED W: an 'aborted' that is still ours came from the phone (a call) and relied on onend; it now
  ends the session like any error (P8b). FIXED W: any iPhone user agent was named Apple although the EU allows other
  engines; an iOS browser exposing navigator.userAgentData (Blink does, WebKit does not) gets no mic, and the iPhone
  stand-in now drops userAgentData to be faithful (P1's EU control). FIXED W: a later result repeating the earlier
  ones (Android's continuous mode) doubled the words; it now replaces them (P2c). The iOS "list resets after a pause"
  report is left as a premise. FIXED CONVENTION: a comment my round-3 insertion displaced is back on its rule. NITs
  taken: Brave's exclusion on iOS is said to be deliberate, stop() is guarded, the bar's colours have no stray
  fallback.
- Round 6 (sonnet): FIXED W: round 5's repeat merge was a bare prefix match and could drop real speech ("a" then "apple
  pie", "go to" then "go tomorrow"); it now needs a word boundary and an earlier text of two words or more (P2e, with
  each guard reddened alone). FIXED W: an iOS list reset after a pause would have overwritten the words already said;
  a list starting again at index 0 with a different first result after an all-final one now keeps the words before
  it, and an ordinary or cumulative list is not doubled (P2d, three arms). FIXED W: a screen reader cannot see the bar
  from inside an aria-modal dialog, so a dialog mic on a phone also says who hears the audio in the dialog's own line
  when it is empty (P11). FIXED W: the disclosure failed open if the bar was missing; the bar is built before the mic
  is drawn, and a tap with no bar starts nothing (P12). NIT taken: the speech-denied line also names a page added to
  the home screen. NOT MEASURED: either recognizer's real list behaviour; the rules are the reports, guarded both ways.
- Round 7 (opus): FIXED W x2, by REPLACING rather than patching: rounds 5 and 6 rebuilt the text from the whole list each
  event and merged repeats against everything so far, and each round found another way that doubled or dropped words
  (one repeated first word cascaded; a reset that repeated itself doubled). Now the Web Speech way: a final result is
  kept once, in order, from resultIndex, so a list that starts again cannot take back what was said; and one repeat
  rule compares a new final with the PREVIOUS one only (word boundary, punctuation aside, two words or more, or the
  very same words). P2c, P2d (four arms), P2e and P2f; each guard reddened alone. A one-word first result may still
  double once ("call call the client"), on purpose: merging it would drop real one-word speech. FIXED W: a stop the
  browser never answers with onend kept the mic on; it now ends after 5 s, as the Mac app waits (P13). FIXED W
  (coverage): the DM composer is measured at 390 px with the mic in it (P14, with an in-state control that does
  overflow; my first control ran on a hidden composer and measured nothing). LEFT NITs: a pinch-zoomed page can
  shift the bar (offsetLeft and scale are ignored); the node harness stubs the phone lines it never reaches.
- Round 8 (sonnet): FIXED W: a list sent again from index 0 with several kept finals doubled them (only one kept final
  was ever tested); a restarting list that opens with the last kept finals, in order, now skips them (P2d multi-final
  arm), and while a reset's repeat is still being heard the box shows it once (P2d resetShown). FIXED W: "no" then
  "no" lost a word to an equality rule; the repeat rule is now two words or more, nothing else ("no no" in P2e). FIXED
  W: the stand-in's abort only recorded; it now fires 'aborted' and an end later, as a real one does, and P15 cancels
  and starts again at once and the new session survives the old one's late events (removing either rec !== mine
  guard reds it). FIXED W: after a stop the bar said "tap the mic to stop"; it now says Finishing until the last words
  come back (P13). NITs taken: one stop wait at a time, cleared on every end (not pinned: no visible behaviour); the
  once-built shim's limits stated both ways.- Round 9 (opus): FIXED W: a resent list was compared with the MERGED finals, so after an Android repeat merge it
  doubled ("call the client call the client tomorrow"); the current list's finals are now kept as they arrived, by
  position, and a resend is matched against those (P2d mergedResend; comparing with the merged list reds it). DECIDED
  (W): one word said again right after a list restart cannot be told from one sent back, and is taken as sent back,
  a known loss of one word, written in the code and pinned (P2d noAcrossReset). FIXED W: Escape on a phone stopped
  without saying Finishing; every stop (tap, letting go, Escape) now goes through voiceStop (P16). FIXED W: inside a
  modal dialog only the Listening line reached a screen reader; the Starting and Finishing lines now reach the
  dialog's own line too, only when it is empty or ours, and it clears when listening ends, including by a stop
  (P11; my first P11 ended by a cancel, which could not see the stop path's clearing, found by a mutation). NITs
  taken: the stand-in's stop result carries a resultIndex; the plan's second premise states what is actually
  unmeasured now. LEFT NIT: the bar covers the header and passes taps through to it while listening.
- Round 10 (sonnet): FIXED W: the shim's comment credited Josh with a ruling on sending phone audio to Apple and
  Google; it is Splinter's call (overridable), resting on Josh's standing 09-14 ruling, and the comment now says so
  and that his 17:16 question asked for voice on phones, not for this. DUPLICATE W: real recognizers' result shapes
  unmeasured (the second premise above; a re-recognised resend that differs counts as a new list, inside the declared
  loss). NITs taken: a stale comment from slice 2 deleted; P2d, P2e and P2f each print only their own arms. LEFT
  NITs: a same-task abort-then-start across mics on a real browser (P15 is a stand-in); no listening time cap on a
  phone (the browser's own, and the bar stays up); the node pins are source matches.
- Round 11 (opus): FIXED W: a phone mic had no listening cap where the Mac app stops at 300 s; it now stops itself at
  300 s (P17, on a fake clock: not before, and at). FIXED W: the comment paraphrased a Josh ruling a reader could not
  check; it now points at Splinter's card comment and paraphrases nobody. FIXED W: the Kosmos+ "Private by design"
  line said your work stays on this computer, which phone voice now qualifies; it names the exception (P20). The copy
  is mine and reversible, written on the card for Josh to swap. NITs taken: a stop before the recognizer says it
  started no longer lets the late start undo "Finishing" (P19); P2's label says what it proves (the click handler);
  P14 says it measures the row, not the screen; a behavioural check that the Mac bridge wins (P18); this Tests section
  brought up to date.
- Round 12 (sonnet; the reviewer says it glanced at this section by mistake, so this round is not counted as blind): FIXED
  W: voiceStop was missing from the node harness, so the new stop path had no node pin and any second-press test would
  have thrown; added, with a second-press test (removing the stop mark reds it, and P19). NITs taken: the two constants'
  comments were crossed (the 5 s one sat on the cap); the header says holding does not work on a phone; one Brave
  comment, not two; the cap left armed through a stop is commented; the iPad branch is exercised (P1c; removing it
  reds it).

