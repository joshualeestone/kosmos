# langpicker-5080: Settings picker for the agents' language (#5080 item 1)

Card: #5080 (follow-up to #5050's agent side, #5118 + #5146). Owner: April. Routed by Splinter 2026-10-10 12:03.

## Why
The `kosmos:language` block is written from the Mac's language only, and has no opt-out: someone on a Spanish Mac who
wants English agents gets the block back at every board start. Off a Mac nothing is written at all. A picker makes
it the person's choice, on every platform.

## What
1. **Stored choice** in `store.ROOT/agent-language.json`: `{ "choice": "auto" | "en" | "es-419" | "pt-BR" }`.
   No file = `auto` (today's behaviour, unchanged). An unreadable or invalid file = NOT sure: nothing changes
   (same rule as a failed Mac read: one bad read must not strip or add a block on every agent).
   Written with `store.saveFlushed` (#5434).
2. **`personlanguage.read()`** order: test override env (unchanged) -> a stored choice other than auto (sure,
   `from: 'settings'`) -> the Mac's setting (sure, `from: 'computer'`) -> Intl (not sure). Returns `from`.
3. **Block wording:** unchanged byte for byte for `from: 'computer'`. For a Settings choice the parenthetical reads
   "(es-419, chosen in Kosmos Settings)" instead of "(…, from this computer's language setting)". Nothing else differs.
4. **`setChoice(choice)`**: validates against the fixed list, saves, resets the process cache, returns the new read.
5. **Routes** `GET /api/agent-language` -> `{ choice, ok, options:[{tag,name}], automatic:{tag,name,sure} }`;
   `PUT { choice }`: the person's only (agent token refused, 403, as /api/undo-setting), saves, then runs
   `syncEveryone(safeRoster())` + `instructionRereadOweEach(told, 'language')` exactly as the boot sweep does, so
   running agents change now, not at the next start. Answer carries how many agents were changed / could not be.
6. **create.js:** the English-removal step line names the source ("because you chose English in Settings" vs
   "because this computer's language is English").
7. **UI:** Settings > Automation, its own small box "Language" with a select "The language your agents write to you
   in": Automatic (shows what it reads now, e.g. "Automatic: Spanish, from this computer"), English, Spanish
   (Latin America), Portuguese (Brazil). Same could-not-read treatment as the industry select (an unknown position is
   never shown as a choice). A status line after a save.

## Not here
#5080 items 2 (Windows display-language source) and 3 (Codex/Gemini/Grok measurement). Any UI string translation (#5050 (b)).

## Decided
- A fixed short list, not every language: only es and pt were measured (Sonnet), and es-419/pt-BR are the variants #5050
  named. Automatic still covers any other Mac language exactly as today.
- English choice is the opt-out: it removes the block (applyTo's existing English path).
- Unreadable choice file = not sure (changes nothing), never "auto": auto on a Spanish Mac would re-add a block the
  person may have turned off.

- Review 1: with Automatic chosen and no sure read (every Windows and Linux board, a Mac whose read failed), a block
  whose source is "chosen in Kosmos Settings" is stale and is removed; a block the computer's setting wrote stays. This
  means, once a choice has been saved, the boot sweep off a Mac READS each agent's file (review 6: with no choice ever saved it reads none, as before); it writes only when a stale Settings
  block is there, and a file it cannot read or with two blocks is left quietly (review 3: no boot noise).
- Review 3: the boot line for an unreadable choice file names Settings, not the Mac's setting.

## Weakest premise
That the person's choice should apply to every agent at once. A per-agent language is not offered; the block's own
"unless they write to you in another language" still covers one agent spoken to in another language.

## Tests
engine/personlanguage.picker-5080.test.js (store, read order, wording, setChoice validation, unreadable file),
server route test (GET shape, PUT saves + syncs, agent token refused, bad choice 400), web source checks for the
select and its handlers. Mutation checks on each key branch.
