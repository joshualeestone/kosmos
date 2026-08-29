# drops-1493: four ways to drop a folder, only one of them counted

## What a real person hit

Josh's sister's fresh install showed an **empty screen** with **ten session files across two
project folders** on disk. Both innocent explanations are dead: she has a projects dir, and
no Codex dir, so it is not #1159.

## The chain

```
engine/discover.js  found()
  newestTranscript()  -> none      continue   DROPPED, uncounted
  transcriptCwd()     -> null      continue   DROPPED, uncounted
  read CLAUDE.md      -> throws    continue   DROPPED, uncounted   <--
  identityFromText()  -> no name   COUNTED as "unreadable" (#1078)
```

**#1078 made the fourth honest and left three silent**, because its counting begins AFTER
the `CLAUDE.md` read succeeds. Its own comment names three situations that end on one empty
screen; there are four.

## Not an edge case

Measured on this fleet's machine, where discovery **works**:

```
44 project folders
17 listed as agents
17 dropped for no CLAUDE.md, entering no number at all
```

⇒ A folder with no `CLAUDE.md` is what an ordinary place you once ran Claude in looks like,
and a **new install has mostly those**.

## The change

Count the three, per folder, like `unreadable`. **Named rather than summed**: they mean
different things and the remedy differs by bucket, so one "we skipped 17" would be the same
shape of unhelpful as the empty screen.

`found()` on this machine went from reporting **8** invisible folders to accounting for
**62** (45 + 17).

## Cross-checked by two instruments written separately

A standalone probe I wrote before touching the engine reported **17** for no-CLAUDE.md. The
engine now reports **17**. Different code, same number.

## Perturbed

Revert either counter and its own test goes red. A **control** asserts a readable agent
moves none of the three, because counters that only go up agree with everything on a
fixture broken end to end.

## NOT done

**Nothing renders these yet.** The screen still says nothing. What it should say is a
product decision, and the page lives in a file another agent's held branch is in.
