# #5319: `kosmos task add` names open tasks with similar text

## The defect (0.7.22, a real install)
engine/tasks.js has no check of new task text against open tasks. In one session the same ask was added as #1 and #11,
and another as #26, #27 and #29.

## The change
- engine/tasks.js `similarOpen(p, sentence, exceptNumber)`: a pure function of the project record. It returns up to
  three OPEN tasks whose text is similar, never the task itself.
- server.js POST /api/project/:id/tasks: the task is ADDED as asked. The answer carries `note`, for example
  "Note: an open task with similar text already exists: #1 (Verify Theo AI and Enzo Health). If this is the same ask,
  close the new one: kosmos task close <project> <n>".
- Both CLIs print the note under the "added" sentence: install/kosmos lifts it with sed; tools/windows/kosmos-cli.js
  prints r.json.note.

## Decided
- **Similar means:** lowercase words, with punctuation and a few filler words dropped. A match is any of:
  - the same words;
  - a word overlap (Jaccard) of 0.6 or more, with two or more words on each side;
  - every word of the shorter (three or more words) appears in the other.
- **Add, then warn.** The card's "add anyway?" is a prompt. Agents run the CLI non-interactively and cannot answer one,
  so the task is added and the answer says how to close it if it is a duplicate. No silent dedup, as the card says:
  two asks can look alike and be different, and only the adder knows.
- **Rejected:** refusing without a flag (`--anyway`). It would break every agent and script that adds tasks today,
  for a guess.
- **Rejected:** merging into the existing task. That is the silent dedup the card rules out.
- **The note** holds no double quote or backslash, so the macOS CLI's sed can lift it. The look-alikes' sentences are
  cut to 60 characters, with those characters taken out.
- **Out of scope:** the project page also adds tasks through this route. It ignores the new field; showing the
  look-alikes on screen would be its own card.

**Weakest premise:** the word-overlap thresholds are judged on the report's two real cases and a handful of near
misses ("Fix the signup bug" vs "Fix the login bug" is NOT similar). A real duplicate phrased with different words
("look into Worlds" vs "deep dive: Worlds") is missed, which is the old behaviour. A false match costs one line of
advice.

**What would change my mind:** a report of notes on unrelated tasks. The fix then is to raise the 0.6 threshold.

## Tests
- server.task-similar-5319.test.js:
  - pure rows (the report's cases, near misses, closed tasks, self, the cap of three);
  - the real route with a real project record: the task is added and stored, the note names #1 with the close
    command; control: an unrelated task gets no note; quotes and backslashes are stripped from the note;
  - the macOS CLI's own sed line on a real answer, including a task sentence that spells "note":"; control: no note,
    nothing printed;
  - the Windows CLI's main() with and without a note.
  - Control: with the server's note removed, the route test goes red.
- 259 related and audit files: 5806 tests, 0 fail.
