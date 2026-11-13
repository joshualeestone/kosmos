# guide-8491: the last never-clearing guide refusals, and the unclear sentence (kosmos#8491, follow-up from #8484)

## What finished looks like
- create's three loaded-job refusals (a startup file Kosmos did not make here; systemd still running it with its
  file gone; a loaded job with nothing else left) get the Settings sentence that says how to free the name, as
  #8484's held-name refusals do, instead of "Try again in a moment".
- The page's 'unclear' sentence names both guide names (since #8484 the guide in doubt can be Josh AI).

## Change
- engine/setup-assistant.js: HELD_BY_LEFTOVER gains the three forms; heldSentence ends a sentence that ends on a
  command (the systemd form) with a full stop, and leaves "systemd" lowercase at the start of a sentence.
- web/index.html asbSayNotMade: "If one of your agents is called Josh or Josh AI, look at it in Agents."

## Decided, and what was rejected
- The three forms are tested through heldSentence with create's words, plus a pin that create.js still says each
  fragment, not through the real create: reaching them needs launchd or systemd to report a loaded job (a stand-in
  runner lands in other branches). Weakest premise: the pin is a text match on create.js; a reworded refusal turns
  it red, which is the point, but it cannot see the condition that leads to each refusal.
- The unclear sentence names both names rather than the one in doubt: the board's own 'unclear' (setupGuideNow) has
  no name to pass, and both names is true for every case.
- Not covered: create's "an agent called X is running" Windows form (a real agent, keeps its words), and its
  "removing it did not work. Pick another name for now." (nothing here frees it).

## Tests
- engine/setup-assistant.adopt-8484.test.js: the three sentences, exact; the create.js wording pin. Control: the
  patterns removed turns the sentence test red.
- docs/browser-checks/render-assistant-bubble-3034.js B1b2: unclear names both; a refusal with a sentence shows
  it; CONTROL a refusal with none still says try again. Ran locally (146 pass); with main's wording, B1b2 fails.
