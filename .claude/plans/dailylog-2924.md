# Plan: dailylog-2924 - daily conversation-log compiler

Card: #2924 (self-recommended, then built per Josh's ruling "recommend, implement, he can override"; Splinter greenlit the build 2026-09-13).

## What Josh asked for (6.59 QA notes, verbatim)
The "Chats" folder that "Show me where the conversation lives" reveals holds one JSON per
conversation and no human-readable rollup. "is there a process we could run so that it could
store all those originals but then compile maybe a daily conversation log that a person could
actually look at ... labeled by date and once a day it runs a process to compile all the JSONs
into a daily log." Flagged "not urgent."

## What I built
`engine/dailylog.js` - a strictly READ-ONLY compiler over `chats/`:
- Reads every conversation file (`chats/direct..<key>.json` and `chats/<projectId>.<key>.json`,
  the same naming `engine/chat.js` uses), skipping non-conversation files (seen-cursors,
  dotfiles, unparseable files).
- Flattens messages (`{ at, text, from, attachments }`; `from` null/blank = the operator,
  rendered "You", per #175), groups by calendar day, and writes one `chats-daily/<YYYY-MM-DD>.md`
  per day. Originals are never touched.
- Idempotent + self-pruning: a full re-run overwrites each day's file from source AND removes a
  day file whose messages are all gone at the source, so the rollup stays current (late-arriving,
  edited, and deleted messages all reflected). Pruning only touches `YYYY-MM-DD.md`-named files and
  only on a full run (an `--day` run is targeted).
- Message bodies are rendered as Markdown blockquotes, so a message whose text starts with `#`/`>`/
  `---` cannot hijack the per-conversation headings.
- CLI: `node engine/dailylog.js [--all | --day YYYY-MM-DD] [--out <dir>]`. Default `--all`.

## Privacy: forget.js integration (added after iteration-1 review)
Because the compiler copies conversation content into a second place (`chats-daily/`), a "forget my
conversations" that did not also clear it would leave a plaintext residue. `engine/forget.js` now
deletes `chats-daily/` as a DERIVED view of the `chats` kind: deleted WITH it, under the same
inside-data-root + basename guards, but NOT counted on the confirmation screen (it is a cache of
content already counted as "conversations", not a separate category). KINDS keys stay
`['chats','commitments']`, so the pinned-surface test still holds; a new deletion test asserts the
rollup is gone after a forget. Pruning (above) is complementary, not a substitute: it runs only when
the compiler is invoked, while forget clears the whole dir on its own.

## Design decisions
- **Sibling `chats-daily/` dir, not inside `chats/`.** `engine/forget.js` enumerates `chats/` as
  "conversations"; a reader or a removal sweep must never mistake a rollup for a conversation.
- **Read-only over chats/.** The tool's whole safety property. Tested: originals byte-unchanged.
- **`store.ROOT` accessed lazily inside `compileAll`, never at module level** - respects the
  sandbox seam and passes `tools/check-frozen-roots.js` (rc=0 verified).
- **Day/time derivation is injectable** (local defaults). Keeps the pure logic deterministic in
  tests regardless of the runner's timezone; the shipped default groups by the user's local day,
  which is what "daily" means to a person.
- **Markdown output.** Human-readable as-is, diffs cleanly, converts to PDF/HTML later.

## Deliberately out of scope (documented follow-ups)
- **A Settings button / scheduler wiring.** v1 ships the runnable process (the card's actual ask:
  "is there a process we could run"). Wiring an on-demand button in the reveal panel touches
  web/index.html (browser-check gate) + a server route; kept out to keep this PR tight and
  reversible. Recommended as the next step on the card.
- **Session-name -> display-name resolution.** `from` is the session name; display resolution
  happens at the surface, not in the stored file. Rendering the session name (operator as "You")
  is honest for v1; coupling a batch compiler to surface-only resolution is a separate step.

## Weakest premise
That grouping by local day matches what Josh wants over a machine that may run in any timezone.
If a fixed timezone is preferred, `dayOf`/`timeOf` are injectable and it is a one-line default swap.

## Tests
`engine/dailylog.test.js` (node --test, matched by the suite's `engine/*.test.js` glob so it runs
and satisfies the kosmos#1934 coverage guard) covers: filename classification (incl. direct-not-
misclassified-as-project AND a project literally id-ed "direct"), operator/blank-from handling,
undated + bad-text skipping+counting, day grouping, render (You + time-ordering + attachments +
blockquote/heading-hijack defense), and compileAll end-to-end (writes per-day files, originals
unchanged, idempotent, junk + aside files skipped, onlyDay, pruning, fail-closed pruning on an
unreadable listing AND on a per-file read error while invalid JSON stays prunable-junk, readability
reporting, missing-dir non-crash). `engine/forget.test.js` gains: a test that a forget deletes the
derived `chats-daily` rollup, a full-deletable-surface pin, and refusal-path tests that the derived
dir's inside-root and basename guards REFUSE (via forget's test-only `kinds` param) and delete
nothing.

Deferred NIT (pre-existing, out of #2924): forget.js's `commitments` kind builds its dir from the
frozen `BASE` while `chats` (and the new derived entry) use the lazy `store.ROOT`; equal at load,
they can differ after a multi-Kosmos switch. My new code uses the correct lazy form; unifying
`commitments` is a separate latent-bug follow-up in forget's own lane.
