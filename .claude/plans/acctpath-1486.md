# acctpath-1486: resolve the account path before comparing, on CREATE too

## Reproduced on this machine with a real account, before changing anything

```
stored dir      /Users/agent1/.codex        (openaiaccounts.list() stores path.resolve(dir))
non-canonical   /Users/agent1/.codex/
  UNRESOLVED match, what create.js did :  false   <- "we do not know that OpenAI account"
  RESOLVED match, what it should do    :  true
```

## The change

`path.resolve` the request at **both** creation comparison sites, matching what
`#1373` did for the switch path.

## 🛑 The perturbation found a coverage gap in my own first attempt

```
revert the OpenAI resolve     -> 1 failure   (guarded)
revert the ANTHROPIC resolve  -> SUITE GREEN (UNGUARDED)
```

**Two sites changed, one guarded.** That is the shape that ships half a fix and reports it
whole. Added a second arm; now reverting either gives exactly one failure and reverting
both gives two.

## The control that matters more than the fix

**Resolving must not make every path match.** Both arms assert that a directory nobody
signed in to is still **refused, in words**. Without that, `path.resolve` could turn a real
refusal into a silent acceptance, which is worse than the defect.

## A fixture note worth keeping

The non-canonical path is built by **concatenation, not `nodePath.join`**, because `join`
normalises and would have handed the test a canonical path: a fixture that cannot exercise
the defect it names. Both arms assert `wobbly !== canonical` before using it.

## ⚠️ Collision, disclosed

Angel's `switch-acct-1373` is **unmerged, has no PR**, and edits `engine/create.js` in the
same region. Her branch carries a COMMENT describing this exact defect; my change makes
that comment stale. Two lines will conflict on her rebase and the resolution is to take
mine. She is told.
