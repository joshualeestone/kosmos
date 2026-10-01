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
  a phone unchanged. The recognizer starts inside the press: a phone starts the microphone only from a gesture.
- On a phone the listening line says who hears the audio ("Apple" on iPhone or iPad, "Google" on Android) and "Tap the
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
drives a recording stand-in on an emulated iPhone in Chromium.

## Tests
docs/browser-checks/render-voice-4409.js P1-P4 on an emulated iPhone (touch, coarse pointer, iPhone user agent, a
recording recognizer): P1 the mic is drawn on the phone and NOT in a computer's browser with the same recognizer; P2 a
tap starts it inside the tap, the line names Apple and has no Escape, partial and final words land, the next tap stops
it; P3 a refusal points at the phone's settings; P4 read aloud is drawn and speaks with the on-device voice (pressed
directly: reaching the #718 tap-to-open bar is unchanged and this file:// harness cannot lay a phone out faithfully).
Mutations: the phone gate (P1, V1, V1b red), the phone line (P2), the phone refusal (P3). web.voice-4409.test.js 21/21,
pinning that the recognizer is reached only in the phone shim and the Mac bridge comes first.
