# personlang-5050: agents start and post in the person's language

Card: joshualeestone/kosmos#5050 (scope: Kosmos in other languages). This is the agent side only, routed by Splinter
(19:07 CDT 10-02) as small, reversible and already measured. Josh has not ruled on the wider scope.

## Measured first (April, #5050 comments 5958166608 and 5963477049)
Claude Sonnet, `claude -p --restricted --append-system-prompt-file` with a real Kosmos agent's 7,600-word instructions,
prompted with an English Kosmos notice ("say hello to the room"). No language block: English 2/2. Variant A (a short
"The person's language" block appended at the END of the file): Spanish 2/2. Variant B (at the top): Spanish 2/2. So
agents follow a person who writes first, but do not START in the person's language, because Kosmos's first words to
them are English; one block fixes that, and the instructions themselves stay English.

## Re-measured on THIS branch's bytes (Renet, 19:20 CDT 10-02)
April's setup exactly (claude -p --restricted --model sonnet --append-system-prompt-file, zz-test-4491's 7,600-word
file, her English "say hello to the room" notice), the file built by this branch's `applyTo` (block at the end).
A probe first: asked for the last section's heading, it answered "## The person's language", so the file is loaded.
No block: English 2/2. es-MX: Spanish 2/2, room post included. pt-BR (untested before): Portuguese 2/2.

## Change
- engine/personlanguage.js: reads the language from the AGENT_WORKFORCE_PERSON_LOCALE override or the Mac's first
  AppleLanguages entry; ONLY those two (a "sure" read) act. Node's Intl locale (ICU's user locale: the region setting on
  Windows, LANG on Linux) is the only other source and neither adds nor removes a block, so off a Mac, and on a Mac
  whose read failed, files are left as they are (Windows waits for a measured source or a picker). `blockBody` is
  April's variant A word for word plus her one variant-B sentence. A sure English read writes no block and removes an
  existing one. `tellAgent` / `syncEveryone` copy connections.js's guards.
- engine/projects.js: the `kosmos:language` marker pair, registered in ALL_MARKERS so the neutralisers cover it.
- engine/create.js: a new agent gets the block LAST, just before its file is written, so it ends the file (where
  April measured it); pinned, so a splice added after it reds.
- server.js: the boot sweep refreshes every agent (written when the setting is not English, removed when it is).

## Tests
engine/personlanguage.test.js (14 after the reviews below): the wording, English gives nothing, detection order, write/idempotent, English
removes it (byte for byte for a file ending in one newline), the guards, the sweep, the registry, and the create/boot wiring with the block last.
Mutations (each restored): Spanish never written (5 reds), block never removed (1), override ignored (1), create not
wired (1), boot sweep not wired (1), a splice after the block (1). The meta, marker, create, projects and connections
suites (68 files): the same 6 fail on origin/main outside the runner, none only on the branch.

## Not in this slice
The Settings picker that overrides the OS setting; measuring Codex, Gemini and Grok; any UI string work.

## Weakest premise
That the computer's language setting is the language the person wants their agents to use. Someone can run an
English Mac and work in Spanish (then nothing changes, as today), or a Spanish Mac and want English agents (the
block's "unless they write to you in another language" is the behaviour April measured, not a guarantee). And the
wording was measured on Claude Sonnet only, in Spanish and Brazilian Portuguese only.

## Review 1 (blind, opus)
- The block is now kept at the END: writing it takes it out and appends it again unless it is already last (then it is
  replaced in place, byte-equal when unchanged, so no boot rewrites the file). The boot sweep runs after the About-you
  sweep, the last one that can append a block. A block added between boots sits behind it until the next start.
- The test runners export AGENT_WORKFORCE_PERSON_LOCALE=en, so no test depends on this Mac's language setting.
- "und" is no language; the language is read once per process.
- Mutations (each restored, against a green baseline): a change to the file after the block at create, never moving
  it, always re-appending, "und" accepted, the runner unpinned, the sweep moved before About-you: each reds one test.

## Review 2 (blind, sonnet)
- A boot read that failed or timed out (Mac `defaults`) falls back to Node's locale, often en-US, which used to remove
  the block from every agent. Now `read()` says whether the answer is sure (the override, or a Mac `defaults` answer)
  or a fallback (Node's Intl locale): a fallback may ADD a block but never removes one, like the About-you sweep's
  add-only boot. While building it I first named the flag `trusted`, which `tellAgent` already reads as "vouched for",
  so a sure read would have skipped the agent guard; renamed to `sure`, and a test pins that a sure read still refuses
  a stranger. Mutations: the fallback removing (red), `sure` vouching (red), Intl counted as sure (red).
- Deferred, with reasons: the block says "from this computer's language setting" even on the Intl fallback (that is
  still this computer's locale setting; the override is a test seam only); the block can sit mid-file until the next
  boot (documented, resolved in review 1); a single `node --test` outside the runners is not pinned to English (the
  same as every other runner-exported seam; those suites sandbox their workers).

## Review 3 (blind, opus)
- Off a Mac every read was a fallback, so a block could be added (from the Windows REGION setting) and never removed.
  Now a fallback changes nothing in either direction: this ships for Macs only, and Windows is untouched.
- A fallback read is no longer cached for the process (a Mac read that timed out at boot is retried by the next
  create). A seam lets the test give the no-argument read a failing Mac; mutations caching a fallback, or never
  caching, each red.
- Kept as a known cosmetic: moving the block back to the end drops the blank line before the block that followed it
  (shared removeBlock behaviour).
