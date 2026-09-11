# #2811: kosmos whoami misattributes a Codex/GPT agent

Branch: `whoami-codex-2811`

## What the card asks for, and how I re-framed it

The card reports a WRONG MODEL for a Codex agent. Driving the real function with
an injected process table showed something different and worse:

```
CODEX  : {"ok":false,"because":"nothing that looks like Claude Code is running under subzero-discord"}
CLAUDE : {"ok":true,"account":null,"model":"claude-opus-5","configDir":"/Users/agent1/.claude"}
```

`runningAs` does not report a wrong model for a Codex agent. It REFUSES. So a fix
aimed at the model half would have changed nothing. The defect is that
`agentUnder` (was `claudeUnder`) matched only the `claude` executable, so every
OpenAI agent in the fleet read as "nothing that looks like Claude Code is
running", and `kosmos whoami` could not name the agent at all.

## What I changed

1. `engine/runningas.js`: `claudeUnder` -> `agentUnder`, returning
   `{pid, runner}` instead of a bare pid. It matches the `codex` executable as
   well as `claude`, and reports WHICH one it found.
2. `runningAs` uses the runner to pick the config-dir variable (`CODEX_HOME` vs
   `CLAUDE_CONFIG_DIR`) and its default (`~/.codex` vs `~/.claude`), and returns
   `runner` plus a `because` sentence for the half it does not answer.
3. `server.js`: the whoami response carries `runner`, read from the live process
   and never guessed.

## What I deliberately did NOT do, and why

- **Did not fix the "wrong model" half.** Cannot reproduce it: this box has a
  `~/.codex` account but no codex process and no recorded codex session. The
  refusal is what is measurable, so the refusal is what I fixed.
- **Did not add a Codex account lookup.** `engine/openaiaccounts.js` is being
  reshaped on another branch; a second derivation of one fact is the failure
  mode this repo keeps paying for. The answer says the account is not read here
  and why, rather than guessing.
- **Did not fall back to the record's `runner`.** The record's value comes from
  an `@kosmos_runner` session marker that SURVIVES a crash back to a shell
  (`engine/status.js:680`), so it can say "codex" about a pane running nothing.
  This reader is the live one; a live reader that falls back to a record is no
  longer a live reader.
- **Did not touch the win32 arm.** It never matches a process name at all: its
  pid comes from Kosmos's own ownership record, its `account` is already null
  with a stated reason, and `modelIn` parses `--model` off the command line,
  which is runner agnostic. It therefore carries no `runner`, and `server.js`
  reports null there. Deriving one from a Windows command-line string (quoted
  paths with spaces) is exactly the fragile first-token extraction I have no
  Windows box to measure.

## Round 1: what the challenge loop changed

Round 1 returned NEW ISSUES: one BLOCKER, four WARNINGs, three NITs. Two of my own
pre-review findings were reversed by measurement. The record of what was wrong is
kept here because in both cases the wrong answer was the intuitive one.

### The BLOCKER, and it was caused BY this change

`readModel` is a Claude transcript reader (`transcriptFor` / `byWorkdir` into
`projects/*.jsonl` rows Claude Code writes) and it is the PREFERRED model source
in `whoamiFor`. `create.setProvider` switches an agent claude to codex by
rewriting the plist and nothing else, so the agent keeps its name and therefore
its workdir, and the old Claude transcript stays findable.

My stated non-goal was "the live reader refuses rather than reporting a wrong
model, so there is nothing to fix". **This change removed that refusal, which is
what made the wrong model reachable.** The result was a Codex agent answering
`runner: "codex"` and "its model is Claude Opus 5" in one payload: the card's
headline symptom surviving, now self contradicting.

Fixed by giving the record model the rule already made one module over for the
sibling field: `identityOf` resolves a Claude ACCOUNT so it is not asked about a
codex one, and a Claude TRANSCRIPT is the same kind of reader. A codex agent falls
through to the live `--model`. Keyed on a KNOWN non-claude runner so an injected
answer carrying no runner takes the old path.

### Reversed finding 1: the node-fronting launcher needs no code at all

Before the review I found, and had measured, that `/opt/homebrew/bin/codex` is a
`#!/usr/bin/env node` script while `claude` is a Mach-O binary, so `ps` shows
`node /opt/homebrew/bin/codex` and a first-token matcher cannot see it. I wrote an
interpreter hop for it, with six test arms, all passing, all mutation tested.

**It was unnecessary, and the measurement that settles it is one I had not taken.**
The launcher does not become the agent: it `spawn`s the native binary as a CHILD,
and `agentUnder` is a BREADTH walk over the whole subtree. Sampled during a real
run:

```
node /opt/homebrew/bin/codex --help                                  <- launcher
.../vendor/aarch64-apple-darwin/bin/codex --help                     <- the agent
```

So the plain rule already reaches it. The hop was removed. Widening the matcher to
accept `node` would have bought nothing and would have let an unrelated node
process in, which is the exact hazard `isFleetSession` refuses a bare `node` for.

⭐ The general shape, and it is the same one that produced every blocker on my last
card: **the defect was in a defensive extra I added, not in the fix.** What I had
verified was that the launcher IS node-fronted. What I had not verified was
whether that mattered, given how the walk works. A measurement that confirms the
premise is not a measurement that confirms the conclusion.

Kept as a test plus comment rather than silence, because the wrong conclusion is
the intuitive one and the next person will reach for the same hop.

### Reversed finding 2: the `.exe` arms could never execute

I had carried `codex.exe` "so the posix and win32 arms recognise the same two
names". They do not share this function: `agentUnder` is called only from
`runningAsDarwin`, and the file's own header says it has no win32 counterpart.
The clause was unreachable and no test could see it. Removed.

### Kept, with the comment corrected rather than the code

`isDefault` scoring a `~/.codex` directory against `$HOME/.claude` and reporting
`false` (read in an account block as "on a NON-default account", implying a named
alternate that does not exist). Guarded to `null`, which is already this field's
unknown value. Three arms pin it, including one proving a claude answer still gets
a real boolean and one proving an answer with no runner is unchanged.

The `because` on a successful codex read is kept and now ASSERTED. Nothing renders
it today, which is exactly why: an unchecked string is decoration, and this
codebase bans a comment describing behaviour the code cannot produce. Its comment
now states that limit instead of implying an agent reads it.

### Added in round 1: the sentence now says "Codex"

The review observed that `runner` reaches no rendered consumer. Re-derived: the
CLI prints ONLY the `because` sentence, and `grep -c whoami web/index.html` is 0.
So the sentence is the entire user-visible surface of the verb, and a Codex agent
could read the whole answer back without the word Codex appearing in it, left to
infer its provider from a directory name.

`sentenceForWhoami` takes the runner and leads with "This is a Codex agent, and it
runs on ..." when the live read found a non-claude runner. Only the lead is
switched, not the `why` fallback: `runningAs` always sets `configDir` on a
successful read, so a codex answer always carries a directory and the fallback
could not be reached. This file has already deleted one unreachable branch for
exactly that reason, and a second one is not worth adding.

Mutation tested in BOTH directions: never naming the runner fails, and naming it
for every agent also fails, because the control requires the Claude sentence to
stay byte-identical.

⇒ This is the difference between "words shipped" and "the operator can use it".
Without it the fix is real but invisible at the only place the filer looks.

### Acknowledged, not fixed, and why

**The win32 arm.** A live Codex agent on Windows gets "no session called X that
Kosmos owns on this computer", which is false. The ownership join is
`win32live.byName()`, whose only source is `claude agents --json`; it has no codex
arm, and Windows does launch codex agents. This is a different defect with a
different fix: the darwin arm reads a PROCESS TREE and needed a wider match, while
this arm needs a SECOND ENUMERATION SOURCE, which cannot be designed against a
machine nobody here can measure on. Now named in the code at the refusal site
rather than left to be rediscovered.

**A runner path containing a space** is unmatchable, since the command is split on
whitespace. Pre-existing, symmetric with the claude arm, and not live today.

**`runner` is JSON-only surface.** Both shipped CLIs print only `because` and
nothing under `web/` reads whoami, so no rendered surface shows it yet. It is
pinned by a test so it is a checked contract rather than an unread extra.

### Corrections to my own comments

- Cited `engine/status.js:680`; the sentence is at 682. Fixed.
- Claimed `@kosmos_runner` was the record-side runner. There are TWO:
  that marker, and `create.readJob(name).runner` off the plist's ninth argument,
  which `accountForAgent` already reads on every request. Both are still wrong
  here, for different reasons, and the comment now says so.

## Weakest premises, named rather than buried

- **The model half of the card is still not reproduced.** I have no codex agent on
  this box, so the blocker's reproduction path is derived from source
  (`setProvider` rewrites the plist and nothing else, so the workdir and therefore
  the transcript survive), not measured end to end. The guard is right either way,
  since a Claude transcript is not evidence about a codex process, but the
  SYMPTOM's existence is reasoned.
- **The win32 refusal is reasoned from source too.** `win32live.js` contains zero
  occurrences of "codex" and sources only `claude agents --json`. I cannot run it.
- **`runner` has no rendered consumer**, so its value to an operator is currently
  potential rather than realised.

## What would change my mind

A measured codex process whose `ps` first token is neither a path ending in
`/codex` nor a descendant of one (a compiled wrapper that `exec`s in place rather
than spawning) would show the matcher is still too narrow, and the right shape
would be to ask the ownership record which runner a pane was launched with rather
than to read the process name at all. I rejected that today because both record
values describe configuration or a marker that survives a crash, not the live
process, and this is the live reader.

## Tests

`engine/runningas.test.js`, 19 tests. The #1304 controls are preserved and updated
for the `{pid, runner}` return. `server.test.js`, four new arms.

Every assertion was mutation tested, and mutants that SURVIVED drove real repairs
rather than being noted:

| mutant | outcome |
|---|---|
| `first.includes('codex')` | killed (initially SURVIVED: my control had put codex in the ARGUMENTS, so the first token was `/usr/bin/grep`) |
| codex fallback to `~/.claude` | killed (initially SURVIVED: my arm always supplied `CODEX_HOME`) |
| codex dropped from the name matcher | killed, 5 arms |
| the claude arm returns `runner: 'codex'` | killed |
| env regex always `CLAUDE_CONFIG_DIR` | killed |
| the codex `because` removed | killed (it was decoration until round 1) |
| the record-model guard removed | killed |
| `isDefault` always null | killed, 2 arms |
| `isDefault` unguarded | killed |
| `runner` hardcoded | killed, 3 arms |

The model arm seeds a REAL transcript so both sources answer with DIFFERENT
values, and runs its control FIRST: if the record cannot answer, the arm proves
nothing. This file already paid for that lesson once, when a reviewer swapped the
two model branches and the entire suite stayed green because no arm had ever
populated both.
