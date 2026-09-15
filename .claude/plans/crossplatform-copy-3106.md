# #3106: cross-platform headline copy (on your Mac -> on your computer)

**Branch:** `crossplatform-copy-3106` · **Card:** kosmos#3106 (priority) · For the 6.68 demo cut.
Handed off from Mona to parallelize the 6.68 batch (separate files from her #3103-5 project-view branch).

## The problem

Josh, 2026-09-15: an AI assistant described Kosmos as "a macOS product" because the public copy
leads with "on your Mac". Kosmos supports Windows too, so the HEADLINE positioning copy reads as
Mac-only and misleads people and AI reading it.

## The change

Fix only the two headline positioning lines; KEEP the accurate technical requirements (Apple
silicon / macOS 13.5+ / Windows specifics) as-is lower down.
- `README.md:3` "Manage a workforce of AI agents on your own Mac." -> "...on your own computer."
- `web/manifest.webmanifest:4` "Your agents, on your Mac, from your phone." -> "...on your computer,
  from your phone." (ships in the app/PWA, rides 6.68).
- `README.md:3` follow-on (challenge-loop NIT): changing the lead to "on your own computer" created a
  "computer ... computer" echo with the pre-existing ownership triad "Your agents, your computer, your
  AI subscription." Reworded the triad's middle term to the synonym "your machine" so the lead keeps
  the card's cross-platform "computer" and the triad reads clean. Same meaning (you own the hardware).

Swept agent-workforce for other headline "on your Mac" / "your Mac," lines: only these two (index.html
is clean). The public repo README is this same README.md (agent-workforce is joshualeestone/kosmos);
the GitHub repo description field is already cross-platform per the card.

## Scope / non-goals

- Deliberately NOT touching "this Mac" lines in the installer/app/pkg screens: those are the
  #1290 rule (say "this Mac" only where the sentence is about macOS/Apple-silicon/architecture),
  a DIFFERENT phrase from the "on your Mac" headline this card is about, and they are accurate as-is.
  This change is consistent with the #1290 spirit (cross-platform product voice) without editing
  what install.this-computer-1290.test.js guards.
- Not touching chaoskosmos-site landing copy in this PR (a separate repo); index.html there can be
  a follow-up if it carries a "on your Mac" headline, but it is not the demo-blocking instance.

## Tests / verification

Copy-only change to README + manifest. manifest.webmanifest stays valid JSON. No test asserts the
old strings (bundle.manifest.test.js does not check the description; install.this-computer-1290.test.js
guards "this Mac", not "on your Mac"). Full suite confirms nothing breaks.

## Weakest premise

That the two named instances are the only demo-relevant headline "on your Mac". The sweep of
agent-workforce confirms it for this repo; a chaoskosmos-site landing-copy sweep is a possible
follow-up but not blocking the 6.68 demo (the manifest is what ships in the demo'd app).
