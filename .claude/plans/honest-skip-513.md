# The sandbox installer says what it skipped (#513)

## What finished looks like

Under AGENT_WORKFORCE_LAUNCH, the keep-running step says the true
sentence: the login job FILE was written, and registering it with
launchd was skipped on purpose because the real machine's domain is not
a sandboxed run's to touch. The "Kosmos will start itself when you log
in" sentence appears ONLY when a registration path actually ran (or the
job was already registered). A harness reading its own transcript can
now tell a working guard from a broken one: the skip sentence present
and the false promise absent is the working guard; the promise present
under a sandbox is the regression, and a pin in tools/test-install.sh
fails on it.

## Why (the card's own words)

Our usual failure inverted: a false sentence where the code is right. A
transcript that narrates steps it skipped cannot be used as evidence of
anything, and the guard this narration hides was earned twice (Shredder
2026-08-22, my suite for real on 2026-08-23).

## Changes

- install/setup.sh keep-running block: the sandbox arm sets its own
  state and the closing sentence chooser speaks per state (registered
  now / accepted at next login / SKIPPED, sandboxed run / could not
  write). No behavior change, sentences only.
- tools/test-install.sh: the first sandboxed install pass gains the
  discriminating pin pair: skip sentence present, false promise absent
  (the download-path pass runs the same code and is left unpinned).

## Review bound (stated before the loop)

One blind round; a finding in the sentences or the pin is fixed in
place; anything beyond this card's narrow scope is carded.
