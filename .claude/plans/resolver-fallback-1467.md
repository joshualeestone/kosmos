# resolver-fallback-1467: make the report hook resolve from anywhere

## The problem, reproduced deterministically

`resolve_kosmos` had two rungs and both were RELATIVE to `$HERE`. Measured 2026-08-29:

```
main's resolver from ~/.claude/hooks/user  -> EMPTY
main's resolver from its real home         -> /Users/.../install/kosmos   (control)
```

**A hook is a file other people COPY.** Resolving only from its own home is the wrong
assumption for that kind of file, and on 2026-08-28 a copy to `~/.claude/hooks/user/`
made every report a silent no-op returning success, for all 18 agents.

## What this does

Two location-independent fallbacks, ordered AFTER the `$HERE` rungs so a real installed
or source layout still wins and nothing changes for them: `~/.local/bin/kosmos` (the
installer's link target), then `command -v kosmos`. Still EMPTY when nothing is findable,
because a guessed path fails further from here than a refusal does.

**Deliberately NOT a hardcoded developer path.** The live Aug-26 copy resolves via
`$HOME/work/agent-workforce/install/kosmos`, which works on this machine and ships a
personal path to everybody else.

## The test arm was inverted on purpose

`tools/test-report-hook-resolver.sh` pinned deployed-elsewhere to EMPTY and its failure
message said whoever changed it must say why. Said, in the file. It now asserts the
opposite plus two new arms, and **every arm pins HOME and PATH** so it reads the code
rather than the developer's machine.

## What this does NOT do

**It does not deploy anything.** The live hook at `~/.claude/hooks/user/` is dated Aug 26,
carries 1 of 6 `--auto`, and is wired through `~/.claude/settings.json`, which serves all
18 agents. Updating it is a separate step that wants an operator watching, and card #1467
stays open for it.
