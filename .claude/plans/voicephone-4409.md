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
- On a phone a bar of its own at the foot of the screen says who hears the audio, from the tap (before any audio
  can be sent) until listening ends; the box's message lines are left to the rest of the page. It says ("Apple" on any iPhone or iPad browser, all Safari's engine;
  "Google" on Android Chrome only; another Android browser gets no mic rather than a guess) and "Tap the
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
drives a recording stand-in on an emulated iPhone in Chromium. Second premise: Android Chrome's results list
behaves as the stand-in's (no repeated finals), also unmeasured.

## Tests
docs/browser-checks/render-voice-4409.js P1-P4 on an emulated iPhone (touch, coarse pointer, iPhone user agent, a
recording recognizer): P1 the mic is drawn on the phone and NOT in a computer's browser with the same recognizer; P2 a
tap starts it inside the tap, the line names Apple and has no Escape, partial and final words land, the next tap stops
it; P3 a refusal points at the phone's settings; P4 read aloud is drawn and speaks with the on-device voice (pressed
directly: reaching the #718 tap-to-open bar is unchanged and this file:// harness cannot lay a phone out faithfully).
Mutations: the phone gate (P1, V1, V1b red), the phone line (P2), the phone refusal (P3). web.voice-4409.test.js 21/21,
pinning that the recognizer is reached only in the phone shim and the Mac bridge comes first.

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
  box-changed guard (safe); the node pins are source matches, the browser checks carry the behaviour.- Round 3 (opus): FIXED W: round 2's "put the covered line back" revived lines their owners had since retired (a
  search note, a load error the next poll had cleared). Replaced, not patched: on a phone who hears the audio is said
  in a bar of its own (#voice-who), so no message line is covered or restored (P5 retires the other line mid-listen
  and it stays retired). FIXED W: the disclosure appeared only once audio was flowing; the bar shows in the tap
  itself (P2a reads it in the click's own task). FIXED W: Brave on Android sends Chrome's exact user agent and was
  named Google; navigator.brave now excludes it, and DuckDuckGo and Vivaldi by name (P1b's Brave control; removing
  the guard reds it). NITs taken: the EU's other iOS engines are named in the comment; a session that ends by itself
  is pinned (P7).

