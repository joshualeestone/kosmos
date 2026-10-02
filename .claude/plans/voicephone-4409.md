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

## Decided (round 16)
- The Kosmos+ privacy line names the phone exception to every reader, including the Mac app (where audio stays on the
  Mac) and a computer's browser (no mic). Kept: a privacy statement is read before choosing a device, and every word of
  it is true for every reader; hiding it by device would make the page's privacy promise differ by where it is read.

## Weakest premise
That the browser's recognizer works inside the Kosmos+ page on a real iPhone at all (permissions, a page reached
through the relay, Safari's continuous mode). NOT MEASURED: it needs a real iPhone and a person speaking. The check
drives a recording stand-in on an emulated iPhone in Chromium. Second premise: the exact shapes in which Android
Chrome repeats results and iOS restarts its list (and whether either resends a list from index 0); the rules keep
finals once by resultIndex and handle the reported shapes, each pinned both ways, but none is measured.
Known defects, chosen and pinned (P2d, P2f): under Android's repeat pattern a one-word first result lands twice
("call call the client"); a result said again word for word as the first thing after a list restart is taken as sent
back and lost. Third premise: that an unfocused box given a selection does not open the iPhone keyboard (P2 measures
it in Chromium only).
A no-speech after words were heard says nothing on the Mac app too, not only on Android (the same voiceOnEvent): on the
Mac the words are also already in the box, so "Nothing was heard." was as wrong there; a slice 1 change, deliberate.

## Tests
docs/browser-checks/render-voice-4409.js, on an emulated iPhone (touch, coarse pointer, an iPhone user agent, no
navigator.userAgentData as on WebKit) with a recording stand-in recognizer that behaves as a real one does on abort:
- Who can get the mic: P1 (phone yes; a computer's browser, a touch-screen Windows computer and another engine on an
  iPhone no), P1c (an iPad, which says Macintosh, yes), P1d (an iPad with a trackpad no), P1b (Android Chrome by brand yes; Samsung, Brave and a rebranded Chromium no), P18 (the Mac app's bridge
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
- Round 13 (opus): PARTLY DUPLICATE W: the one-word doubling under Android's repeat pattern was decided in round 7, but
  only this log said so; it is now a KNOWN DEFECT in the code comment and in the premises, and P2f's pin is named as
  pinning a chosen defect. NITs taken: the restart loss is a result said again word for word, not only one word; the
  Kosmos+ line says the BROWSER's speech service (what the code decides), not the phone's; the iPhone keyboard under
  setSelectionRange is a named premise; the pointer gate has a behavioural control (P1d, an iPad with a trackpad gets
  no mic; removing the gate reds it; Chromium calls any touch screen coarse, so the check answers the pointer query as
  a trackpad iPad does). Checked, not changed: Splinter's card comment is stamped 22:16:37Z, 17:16 CDT,
  the same minute as Josh's question. LEFT NIT: pinch zoom (scale, offsetLeft).
- Round 14 (sonnet), RESOLVED 23:10 (paused 19:49 for #2955): W1 a dialog mic whose line
  already holds the page's own message (a failed Create or Save) says nothing about who hears the audio to a screen
  reader, which cannot reach the bar past aria-modal. W2 the voice section header still says "no audio kept", wider than
  the phone path. W3 Android's no-speech after a stretch of silence says "Nothing was heard." with words already in the
  box. NITs: the 300 s cap ends without saying why; the two 17:16 stamps (checked in round 13: both are 17:16 CDT).
  Round 14 dispositions: FIXED W1: when a dialog mic's line holds the page's own message, it is kept and a hidden status
  inside the dialog (voiceWhoHidden, made empty then filled so it is announced) says who hears the audio, emptied when
  listening ends (check P11b). FIXED W2: the voice header says the Mac keeps the audio on the Mac and a phone's speech
  service hears it. FIXED W3: a no-speech after words were heard says nothing (VOICE.heard, set on a non-empty partial
  or final, cleared at start); with no words it still says "Nothing was heard." (check P8c, both arms). Each fix removed
  reddens only its own check. LEFT NITs: the 300 s cap ends without saying why (an end with the words kept, as at any
  stop); the 17:16 stamps (checked in round 13).
- Round 15 (opus): W1 (a pending fill reviving the dialog's hidden status after a start fails): MEASURED NOT REACHABLE
  on that path: the failure's own clear goes through voiceWho('', btn), whose dialog arm sets the pending text to ''
  before the fill runs; check P11c (start() throws in a dialog with a taken line) passes with and without the change.
  Kept the defensive change anyway (the button-less clear now empties the pending text too) and P11c as the guard of
  the scenario. DOCUMENTED W2: the no-speech change reaches the Mac app too, deliberately (weakest premise). NIT taken:
  heard is declared in VOICE. LEFT NITs: a source-shape test in web.voice-4409.test.js (the browser checks prove the
  behaviour); the voicePhoneWho comment's EU wording.
- Round 16 (sonnet): no BLOCKER. W1 (result shapes unmeasured on a device) is the weakest premise (DUPLICATE; the card
  stays open for a real-device pass). W2 (the privacy line's exception shown to every reader): DECIDED, kept (Decided
  (round 16)). W3 (the Mac no-speech change) was already decided and not re-reported. LEFT NITs: emit reads the shared
  id (every handler is guarded by rec !== mine; making it per-session restructures every handler); dlgSaid is global
  (traced: every stop clears it); long comment lines.
- Round 17 (opus): FIXED W: an error answering our own stop (a quick second tap before audio began) was said as a
  failure; during the shim's stop wait only a refusal or a no-speech is still said (check P8d, with the unasked error as
  its control; the fix removed reddens only P8d). NITs taken: a result with no alternative no longer throws; the mic
  has touch-action: manipulation (a start-stop tap pair is not a double-tap zoom). LEFT NITs: the bar does not follow
  pinch zoom (the labels and dialog lines still say who hears); the source-shape unit assertion; "built-in engines".
- Round 18 (sonnet): FIXED W1: a network loss during our own stop's wait was swallowed with the aborts; it is said now
  (the last words may not come back), P8d's third arm (the fix removed reddens P8d). W2 (VOICE.heard after a discarded
  partial; stale state after a stop): no change, the id check drops late events and heard is cleared at every start.
  W3 is the weakest premise (who hears is named from the user agent, unmeasured on a device; every iOS browser is
  WebKit and so Apple's service) (DUPLICATE). NITs taken: the onerror comment is one statement; voiceStop's comment says
  stops the person asks for. LEFT NIT: decision history in the bridge's comments.
- Round 19 (opus): FIXED W: a phone's audio-capture said the Mac's "No microphone was found."; a phone always has one,
  so it says the microphone is in use by something else (check P8e; the wording removed reddens only P8e). NITs taken:
  the hidden dialog status is not created only to be emptied; voiceStop's comment names the 300 s cap. LEFT NITs: the
  fake's stop answers as a fresh list (the at-index path is covered by P2); dlgSaid keeps a stale value (the page never
  writes that string).
- Round 20 (sonnet): FIXED W1: an iPhone or iPad's speech refusal is Dictation switched off (a device setting), so on
  an Apple phone it says to turn Dictation on (check P8f, strict on the vendor; the choice removed reddens only P8f).
  FIXED W2: a line the bar no longer owns is never cleared by it later (voiceSay forgets dlgSaid). DECIDED W3: during
  our own stop's wait, an abort the person did not cause is still not said: they already asked to stop and the words
  are kept; only a refusal, no-speech or network loss is said there. LEFT NITs: the source-shape unit assertion;
  voiceBridge per paint (cached); the listening-line comparison is safe because the bridge is built once.
- Round 21 (opus): FIXED W: nothing pinned the phone's start-from-the-click rule (P2 starts with element.click(), no
  press); added P2t, a real tap that reads the stand-in's log (["new","start"]); with the pointerdown guard removed it
  goes red with "start-outside-a-click:pointerdown", as the reviewer predicted. NITs taken: the cap's comment names the
  real reason a cap in a stop's wait does nothing (stopTimer); the EU sentence reads the right way round.
- Round 22 (sonnet): FIXED W1: during our own stop's wait, an allow-list of real errors let every unlisted code pass
  silent; inverted: only 'aborted' answers our stop, every other code is said (P8d's fourth arm, language-not-supported;
  the old allow-list restored reddens P8d). FIXED W2: a stop the browser never answers ended silently after 5 s; on a
  phone the last words may still have been on their way, so it now says "the last words may not have come back. Check
  the box before you send." (P13 extended; the line removed reddens only P13). LEFT NITs: VOICE_PHONE cached at first
  call (a rotation or a fold keeps it until reload; the comment says so for the trackpad case); empty finals in a list
  restart; the Mac app's own stop wait is not re-measured here; a stop before onstart is covered by the 5 s timer.
- Round 23 (opus): FIXED W1: the browser-checks README row still said a browser with no bridge never gets a mic; now
  says a computer's browser does not and a phone's does, with who hears said. FIXED W2 and W3: the navigator.brave and
  isSecureContext guards had no check; P1e runs the same faithful iPhone three ways (plain, Brave, not secure), the
  plain one the control that gets the mic; each guard removed reddens P1e on exactly its own arm. (My first P1e fixture
  left out the WebKit stand-in, so even the control had no mic; the control caught it.) NIT taken: "this device's
  Settings app" (an iPad is not a phone). LEFT NITs: touch-action is unchecked (cosmetic); listening comes only from
  onstart (the who-hears wording stays true while it says Starting).
- Round 24 (sonnet): FIXED W2: a press while Finishing (a phone waiting up to 5 s for the last words) did nothing, so
  the bar kept saying audio was being heard after the person asked twice; it now ends listening at once, keeping the
  words (P13b; the change removed reddens P13b). PINNED W1: a dialog closed mid-listen and opened again has an empty
  hidden status (P11d; removing the clear reddens P11b, P11c and P11d). The harness stubs setInterval, so the 500 ms
  watch never ticks on this page: P11d runs one tick of its condition by hand, and says so (my first P11d failed on
  exactly that, which is how I found it). W3 is the weakest premise (iOS error codes unmeasured) (DUPLICATE). LEFT
  NITs: who-hears recomputed per paint (the gate is cached; a late change is implausible); review-round numbers in
  comments; the cap stop's Finishing; no-on-device is Mac-only (the phone never emits it); touch-action's reason.
- Round 25 (opus): FIXED W (my own regression from round 24): the press-while-Finishing cancel also reached the Mac
  app, where a cancel throws away the recognizer's final corrected words (hold, let go, tap again quickly); now phone
  only, and the Mac's further press is one more stop as before. New unit test: on the Mac bridge a press while Finishing
  posts stop and keeps the session; with the phone condition removed it goes red. NIT taken: voiceStop's comment names
  the phone's cancel. LEFT NITs: the node harness stubs VOICE_SAYS_PHONE (the browser check covers the wording); a
  timed-out stop leaves the cap timer armed (inert: rec === mine).

