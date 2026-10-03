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
engine/personlanguage.test.js (24 after the reviews below), plus two create tests in engine/create.test.js: the wording, English gives nothing, detection order, write/idempotent, English
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

## Review 2 (blind, sonnet) (its add-only fallback is SUPERSEDED by review 3: a fallback now changes nothing)
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
- (SUPERSEDED by review 7) Kept as a known cosmetic: moving the block back to the end drops the blank line before the
  block that followed it (shared removeBlock behaviour).

## Review 4 (blind, sonnet)
- A failed Mac read is kept 5 minutes (FALLBACK_MS) before `defaults` is asked again, so a hanging `defaults` (2 s
  timeout) costs at most one stall per 5 minutes, not one per create; a sure read is kept for the process.
- Nothing to do is TOLD without touching the file: an unsure read, or a sure English read for an agent with no
  instructions file. So an English Mac's boot log carries no "could not refresh ... your language" line for a no-op.
- Documented, not changed: only the FIRST preferred language counts (an English-first list with Spanish second gets
  no block), and a block added by hand on a sure-English Mac is removed at the next boot, as every managed block is.
- Mutations: no negative cache, a fallback kept forever, the English no-file noise back: each reds.

## Review 5 (blind, opus)
- `defaults` is called by its absolute path, /usr/bin/defaults, as machine.js does, never whatever is first on PATH.
- A behavioural create test (engine/create.test.js, #5050): with the override es-MX a real create writes a file that
  ENDS with the block; with en-US it has none. Disabling the create splice reds it. The splice happens before the
  runner picks the file name (CLAUDE.md or AGENTS.md), so both runners get the same text; only claude is created here
  (a codex create needs account fixtures).
- The runner pin's comment now says "a test that inherits this env": four suites build a board env from scratch and
  do not get it (fine while the fleet's Macs are English; they would read the real `defaults`, which a non-English
  Mac would answer).
- Known, unchanged: a sure read is kept for the process, so a language changed while the board runs reaches new agents
  at the next start; `languageName` names the base language only (zh-Hans and zh-Hant both "Chinese"; the tag beside
  it carries the script).

## Review 6 (blind, sonnet)
- The header says the override is read once per process, like the setting.
- Deferred, as the sibling blocks do: a create-time step reports "may start in English" if the read itself throws
  (it does not in practice: `read` catches every failure), and an agent at the size limit logs once per boot.

## Review 7 (blind, opus)
- Moving the block used removeBlock, which joined the person's own text after the block onto what came before it (a
  paragraph turned into a list item) and rewrote the file at every boot. Now the block moves ONLY when everything after
  it is other Kosmos blocks (the case moving exists for); if the person wrote anything after it, it stays where it is
  and is replaced in place. The move cuts exactly the block and rejoins what remains with one blank line. A block
  already last is replaced in place. Tests: the person's note after the block is untouched (alone, and with a Kosmos
  block after it too); a move keeps the blank lines. Mutations (moving past the person's text, losing the blank line,
  dropping the already-last check) each red.
- The create and boot comments now say that off a Mac, or when the read failed, nothing changes.

## Review 8 (blind, sonnet)
- `macPreferred` reads only the FIRST array element; one that does not parse gives null (not sure), never the second
  language. Test + mutation (the old whole-output scan) reds.
- Deferred: a sure English read from the override strips the block at boot, a wider reach than the add-only About-you
  sweep. The override is a test seam (production boards run under launchd with a fixed env); the Mac `defaults`
  answer is the person's own first language. The create-time size-limit step was deferred in review 6.

## Review 9 (blind, opus)
- MEASURED the mid-file position the block spends time in between boots (a block added behind it, or the person's
  note): the branch's block placed at 64% of zz-test-4491's 7,670-word file, the person's own note last, April's setup
  exactly. Probe: it quoted the last heading ("## A note from the person"), so the file is loaded. Result: Spanish 2/2.
  So the end position is what April measured, and the mid-file gap between boots is measured too, not assumed.
- Moving the block strips only newlines before it, so a person's markdown hard break (two trailing spaces) survives.
- The header says a failed read is retried after FALLBACK_MS (5 minutes); the plan's test count is 19.

## Review 10 (blind, sonnet)
- The header, create and boot comments now say what the code does: appended at the end, moved back behind a Kosmos
  block appended after it, left in place when the person wrote after it; and that every measured position held (end,
  top, 64%), so none depends on the move. Rewrapped.
- Duplicates of deferred items: the size-limit drop and its boot log (review 6), the `defaults` stall (review 4).

## Review 11 (blind, opus)
- Removing the block with the person's text after it now cuts exactly the block and keeps one blank line (removeBlock
  joined their paragraphs, the defect review 7 fixed on the move path). Last in the file it is still removeBlock,
  byte for byte. Test with their text on both sides; mutation (back to removeBlock) reds.
- The override must be a 2 or 3 letter language, as the Mac read requires: "english" or "garbage" are well-formed BCP
  47 tags and would have read as a sure non-English language. Mutation reds.
- tools/check-block-delivery.js knows the `language` block: something to deliver only on a sure non-English read.
  Run with the override es-MX against this Mac's workers: 22 entitled, 0 delivered (the branch is not deployed).
- create reports the step failed when pasted instructions already hold two language blocks.
- The seam trims \r?\n before rejoining; the rejoin itself writes LF, so a CRLF file can end up with mixed endings
  at the seam (the person's own lines are unchanged).

## Review 12 (blind, sonnet)
- Deferred, with reasons. (1) No opt-out: a person who deletes the block, or wants English agents on a Spanish Mac,
  gets it back at the next boot; every managed block (connections, dmfiles) is re-asserted the same way, the block
  tells the agent to follow a person who writes in another language (the behaviour April measured), and the Settings
  picker is the named follow-up that gives the opt-out. (2) The first boot after upgrade on a non-English Mac marks
  every agent "running on older instructions" (a restart prompt), as any new managed block does. (3) The `defaults`
  stall: a duplicate of review 4.
- The CRLF note above is corrected (the rejoin writes LF).

## Review 13 (blind, opus)
- `onlyManaged` counts only TIGHT marker pairs (no second start between, as findBlock pairs them) and treats any
  leftover marker as the person's text, so a stray start from a hand edit cannot get the block moved below their words.
  Test with a control; mutation (loose pairing) reds.
- create reports the step failed for pasted instructions with two language blocks on ANY sure read (English too); a
  behavioural create test runs it under es-MX and en-US and checks the two blocks are left as they were. Mutation reds.
- The earlier create test asserts `steps` is an array, so its no-failure check cannot pass vacuously.
- Comments: the projects block is no longer called LAST; "spliced last" names the pasted-instructions exception;
  cutOut says it leaves exactly one final newline. The unused `trusted` bypass copied from connections.js is removed.
