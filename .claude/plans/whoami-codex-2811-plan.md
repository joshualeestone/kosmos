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
  (`engine/status.js:682`), so it can say "codex" about a pane running nothing.
  This reader is the live one; a live reader that falls back to a record is no
  longer a live reader.
- **Did not touch the win32 arm.** It never matches a process name at all: its
  pid comes from Kosmos's own ownership record, its `account` is already null
  with a stated reason, and `modelIn` parses `--model` off the command line,
  which is runner agnostic. It therefore carries no `runner`, so the wire field is
  null there.

  🛑 THIS PARAGRAPH WAS WRONG TWICE AND IS KEPT WITH ITS CORRECTIONS, because both
  errors are the ones this card produced most:
  1. "`server.js` reports null there" is true of the JSON `runner` field, and my
     CORRECTION to it was worse: I wrote that the sentence still names the
     provider off the `@kosmos_runner` marker, measured on a card shape WINDOWS
     CANNOT PRODUCE (no tmux). I then said every rung is macOS-only, having
     retired rung 1 and ASSUMED rungs 2 and 3 followed.
     ⇒ AND THEN A FOURTH TIME. v4 said rung 3 fires and rung 1 does not, having
     checked only that tmux is absent.
     ⇒ AND THEN A FIFTH. v5 said rung 1 fires too, via the win32 roster
     (`server.js` does, under `process.platform === 'win32'`,
     `status.setPaneSource(win32roster.make())`, and that roster's row carries a
     `runner` column). THE COLUMN EXISTS AND THE ROW DOES NOT. `win32roster.make()`
     runs `claude agents --json` and iterates ONLY over its results
     (`const agents = run(); for (const a of agents)`), and that command has no
     codex arm, as this plan states two paragraphs above. A recorded codex session
     it does not list yields no row, so no pane, so no `card.runner`. v5's evidence
     was `win32roster.test.js`, whose fixture puts a codex session INSIDE the
     `claude agents --json` list, a state the platform cannot produce.

     TRACED, IN `resolvedRunner`'s OWN RUNG ORDER. EXACTLY ONE fires on Windows:
       rung 1 `seen.runner` (live)               no. `win32Answer` has no `runner`
                                                 key at all.
       rung 2 `card.runner` (the marker)         NO. No tmux, and the win32 roster
                                                 substitute emits no row for a
                                                 codex session.
       rung 3 `create.recordedRunner`, itself two reads:
              a) `readJob` -> ~/Library/LaunchAgents   no, launchd is macOS
              b) `store.readProfile().provider`   FIRES, plain JSON, platform-free
                                                 writers (`createAgentInner`, which
                                                 the win32 create path calls, and
                                                 `discover.js`, zero platform
                                                 branches). Measured with no plist:
                                                 provider openai -> "codex";
                                                 control, none -> "claude".
     So a Windows OpenAI agent IS told it is a Codex agent, by the PROFILE alone;
     the live-process `runner` field and the marker are both absent there.

     ⭐ FIVE VERSIONS, ONE ERROR. Each verified the rung it had just been shown
     and INFERRED the rest: v1 the JSON field, v2 the marker, v3 tmux, v4 the
     profile, v5 the roster's COLUMN (not the roster's rows). Every version was
     measured and every version was wrong, because the measurement was never the
     SCOPE of the claim. That is the whole lesson of this card in one sentence, and
     it is why the durable fixes here are assertions: the profile rung is pinned by
     a test whose mutant dies, and the answer shape by a table over every return
     path.
     ⭐ AND v5 NAMES THE REASON A WRONG SENTENCE SURVIVES A REVIEW: it SUPPORTED
     the paragraph's conclusion. Dropping it leaves the conclusion intact (the
     profile rung is the sole rung and it fires), so nothing downstream ever
     contradicted it. A sentence is not checked by the truth of what it concludes.
     "win32create.js writes no provider" is true and IRRELEVANT: that file is
     session-id pinning called from `create.js`, not the win32 substitute for it.
     ⭐ Now TWO ASSERTIONS, not a sentence. `server.test.js` pins the profile rung
     (a mutant flooring it at claude reds it), and `#2811` in
     `engine/win32roster.test.js` pins the half v5 got wrong: a recorded codex
     session absent from `claude agents --json` emits NO ROW, with the control
     emitting it once the live list names the session, and a mutant iterating the
     RECORD instead of the live list reds it. Five prose versions could not hold
     these facts still.
  2. "I have no Windows box to measure" is not the reason and is not true of this
     repo, which builds and tests the whole win32 arm through injected deps on
     Macs. The real reason a runner derivation is absent from `win32Answer` is
     that a codex agent never REACHES it: `win32live.byName()` enumerates
     `claude agents --json` and has no codex source, so such an agent is refused
     upstream. The work is one gap and it is upstream.

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

🛑 **ROUND 2 FALSIFIED THE "nothing else" HALF, AND THE SENTENCE IS LEFT ABOVE AS
THE DATED RECORD OF WHAT I BELIEVED.** `setProvider` also renames the brief
CLAUDE.md <-> AGENTS.md and writes the profile provider. See "A premise of mine
that was measurably false" below, and the corrected header in `engine/create.js`
(round 23). The CONCLUSION stands (workdir and transcript survive); only the
premise was wrong, which is exactly why three copies of it survived 22 rounds.

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
this arm needs a SECOND ENUMERATION SOURCE. (An earlier version of this line
added "which cannot be designed against a machine nobody here can measure on".
That is not the reason and is not true of this repo, which builds and tests the
whole win32 arm through injected deps on Macs. It survived as a FOURTH copy 122
lines below the one corrected first, in a commit that claimed all three were
fixed.) Now named in the code at the refusal site
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
  (`setProvider` rewrites the plist and nothing else 🛑 **FALSE, see round 2's
  correction below; the conclusion is unaffected**, so the workdir and therefore
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

`engine/runningas.test.js`, 23 tests. The #1304 controls are preserved and updated
for the `{pid, runner}` return. `server.test.js`, six new arms.

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

## Round 2: what the second challenge pass changed

Round 2 returned NEW ISSUES: three WARNINGs and four NITs, no blocker. It confirmed
all nine mutants from round 1 die. Two of the WARNINGs were defects in the round-1
work itself, and two of the NITs were risks this change introduced.

### The user-visible surface was pinned as a unit and not at the route

The sentence test pinned `sentenceForWhoami` directly. Nothing pinned that the
ROUTE passes the runner into it, so a mutant hardcoding that argument to null kept
272/272 green while deleting the word Codex from the only place the filer looks.
The route arm now asserts `out.because`. The reviewer's exact mutant now fails.

⭐ A unit test of the composer plus a route test that never reads the composed
string leaves the WIRING unpinned, and the wiring is the whole feature.

### The model could never be read for a darwin Codex agent

`bin/agent-supervisor.sh` writes `-m` for codex and `--model` for claude, while
`engine/win32launch.js` writes `--model` for both. Every codex arm here used
`--model`, a shape the darwin product never produces, so the assertion "the model
came from the codex command line" was testing an impossible input.

Fixing it exposed a second defect the review had not named: the darwin arm carried
its OWN COPY of the regex, so widening the `modelIn` helper alone would have fixed
win32 and left darwin, the only arm that can report a codex agent, still blind.
The darwin arm now calls the shared helper. One fact, one derivation.

Latent rather than live today, because `setModel` refuses a codex agent so no model
flag is written at all. It goes live the moment OpenAI model rows exist.

### The record-only path had the same defect one reader over

The round-1 guard keyed on the LIVE runner, so when the live read does not succeed
(paneless, crashed, or the 15s budget spent) it was off exactly when the record is
the only source and its stale Claude model went out unopposed.

It now also consults the card's runner marker. That marker SURVIVES a crash, which
is precisely why it was rejected for the wire `runner` field and precisely why it
is right here: "what is running right now" must not come from a marker that
outlives the process, while "is this agent's Claude transcript stale" is about what
the agent IS, and a crashed Codex agent is still a Codex agent.

### Two risks this change introduced, both closed

**The card's defect inverted.** Widening the matcher made it possible for two
agent-shaped processes to compete in one tree, which could not happen while only
`claude` matched. Whichever the walk reached first won, so a Claude agent could be
told it is a Codex agent, its account read from `CODEX_HOME`, its recorded model
suppressed as foreign: strictly worse than the bug being fixed. The walk is now
level-ordered and `claude` wins a tie, which is the answer this function gave
before codex was added. Depth still decides first, tested both ways.

**A prefix collision in the new config-dir read.** `CODEX_HOME=(\S+)` also matches
`AGENT_WORKFORCE_CODEX_HOME`, which is a real name in this repo set by its own test
sandboxes, and the unanchored match takes whichever appears FIRST in the
environment block: insertion order, so not even reliably wrong. Measured, both
arms anchored. The claude arm had the identical hole and is fixed in the same
expression rather than left as the asymmetry that lets two halves of one fact
drift.

Confirmed on REAL `ps -Eww` bytes rather than on a string I wrote, because a
hand-rolled fixture answering a different question is the trap this branch already
fell into once. Sampled a live process that genuinely sets the variable, then
spliced a real twin into that same blob:

```
live process as-is      loose -> /Users/agent1/.claude   anchored -> /Users/agent1/.claude   (agree)
same blob + a real twin loose -> /tmp/decoy              anchored -> /Users/agent1/.claude
```

The first line is the no-regression arm, the second is the arm that can return the
dangerous answer. The real environment block is space separated after the command,
which is what makes the `\s` half of the anchor the correct one.

### A premise of mine that was measurably false

My comment justified trusting the workdir with `setProvider` "rewriting the plist
and nothing else", quoting `setProvider`'s own header. It is false: it also renames
the brief CLAUDE.md <-> AGENTS.md and writes the profile provider. The conclusion
survives (the rename is INSIDE `workerDir` and the name never changes, so the
lookup resolves the same directory), which is why the wrong premise was worth
correcting rather than leaning on.

⭐ This is my named recurring failure and it recurred: I repeated a neighbouring
file's comment as evidence without opening the function it describes.

### Verification of the walk rewrite, beyond the unit arms

Restructuring `agentUnder` from a plain BFS queue into a level-ordered walk is the
riskiest edit on this branch: it is the oldest code here, it is reached by every
whoami, and the unit arms only assert the cases I thought of. Two differential
fuzzes were run against it, both on 60,000 randomly generated process tables
(sizes 2 to 8, with 10% of parents chosen at random so cycles and unreachable
nodes occur):

1. **Against the ORIGINAL pre-#2811 walk, on claude-only trees.** The comment in
   the code claims the widening "can turn a refusal into an answer, and cannot
   turn one answer into another". This measures that claim: claude was found in
   48,275 of the 60,000 trees and there were **0 mismatches**.

2. **Against an independently written reference** (build a BFS depth map from the
   pane pid, take the minimum depth, prefer claude on a tie) on mixed
   claude/codex trees, including decoys whose first token merely contains the
   word. A match existed in 56,970 of 60,000 trees: **0 violations**.

The fuzzes are verification evidence rather than shipped tests: 60,000 iterations
does not belong in the suite, and the semantics they check are already pinned by
named arms (tie-break both orders, depth beats the preference, cycles terminate).

## Round 3: one warning, and it was a comment claiming coverage the code lacked

Round 3 found every other category clean and confirmed all six claimed mutants dead
plus two of its own. It also wrote its own independent property test of the walk
rewrite (30,000 random trees, cycles included) and reached the same verdict my two
fuzzes did, which is the corroboration that matters most: the rewrite is the oldest
code on this branch and the one I was least able to review impartially.

### The finding

My guard's comment named "a paneless agent" as a case it covered. It did not.
`engine/status.js` sets `runner: null` on every paneless card, and it is the
only such site, so the `@kosmos_runner` marker is absent for exactly that case:
`configuredRunner` was null, `foreignRunner` false, and a stale Claude transcript
model went out unopposed. The crashed-pane half worked (a pane card keeps its
marker); the paneless half could not fire at all.

⭐ This is the failure mode this codebase names explicitly: a comment describing
behaviour the code cannot produce is worse than no comment, because it stops the
next reader from checking. The fix had been real and the sentence around it was
not.

### The fix

The launch job does not depend on a pane, and `accountForAgent` already reads it on
every request, so the guard now falls back to `create.readJob(who).runner` when the
marker is absent. Its absent-runner default is `'claude'`, matching the supervisor,
so a plist written before runners existed reads as claude and takes the old path
rather than suppressing a model.

Both sources are load-bearing and pinned independently: dropping the job fallback
fails the new arm, and consulting the job BEFORE the marker fails the crashed-pane
arm.

The new arm writes a REAL plist with the product's own `create.plistFor` rather
than hand-rolled XML, and derives its paneless card by nulling `runner` on a
genuine fleet card (which is exactly what `status.js` emits) rather than
building one, which `fixture-discipline.test.js` exists to refuse. Its control runs
first and asserts the record CAN answer before the job exists, so the arm cannot
pass merely because the transcript was unreadable.

## Round 4: the same miss, twice more, in fields I had already reasoned about

Round 4 confirmed all nine claimed mutants dead and added nine of its own, seven
dead, one equivalent, one SURVIVOR. One WARNING and two NITs.

### The warning, and it is my own sentence not carried through

I guarded `isDefault` on the LIVE account path and wrote, inside that very
comment, that the record-only path needed the same guard. I then carried that
reasoning to the MODEL and not to the ACCOUNT. So one payload could say the model
is unknown (correct) and the account is a non-default CLAUDE account (not), for
the same codex agent.

The comment immediately above the defective line already read: "the live path was
fixed and its sibling was not. Same miss, third time." Mine was the fourth.

Fixed in `accountForAgent`, which is where the defect lives, so all five of its
callers are covered rather than the whoami one. Only the fallback branch is
guarded: the `found` branch takes `isDefault` from whichever list matched, which
is that list's own notion and correct for both providers.

### The surviving mutant was real

`runnerNamed`'s bare-name arm (`t === name`) was asserted nowhere: every fixture
in the file used a full path, so deleting the arm left everything green. Not
hypothetical either. Sampled live on this machine: 3 processes front as a bare
`claude` against 18 with a full path, which is what a PATH-resolved exec looks
like in `ps`. Arms added for both runners plus lookalike controls (`claudebot`,
`codex-helper`, `myclaude`) so the bare match cannot be loosened into a prefix
match.

### Fixing the NIT exposed a fourth instance of the same pattern

The sentence asked the LIVE reader only, so a paneless, crashed or win32 Codex
agent read "an account we cannot identify (...)" with the word Codex nowhere in
it. Extending it, my own test failed: I had written that a codex-shaped no-account
branch was UNREACHABLE because "runningAs always sets configDir on a successful
read, so `acct` is always truthy".

That is true of the live path and false of the record one. An agent with no launch
job has no account at all while its runner is perfectly well known, so the
fallback is reached with a known codex runner. A test demonstrated it; re-reading
the comment never would have.

⭐ THE THROUGH-LINE OF THIS WHOLE BRANCH, now visible three times in one round:
**reasoning that holds for the LIVE reader does not transfer to the RECORD
reader.** It has now bitten at `isDefault`, at the model, and at the sentence.

### The structural fix, not just the three patches

The two runner readers were collapsed into one `resolvedRunner` (live, then the
crash-surviving marker, then the launch job and profile), exported from
`whoamiFor` and consumed by both the model guard and the sentence. Live takes
precedence because a running process is the only source that cannot be stale.
One derivation means the guard and the sentence can no longer drift apart, which
is what let this class recur three times.

### One finding I deliberately did NOT fix

The review noted the new test leaves a profile record uncleaned. Going to fix it,
I measured that `store.PROFILES` is a STRING evaluated at require time and
resolves to the OPERATOR'S REAL profiles directory when the sandbox env is not set
first. A stray unlink against that path is a live destructive risk taken for a
cosmetic tidy on a record that leaks nothing and no other test reads. Left alone,
with the reason recorded in the test so the next reader does not re-introduce it.

## Round 5: a BLOCKER, and it was the card's own defect in the branch I exempted by name

Round 5 wrote 12 mutants: 11 dead, 1 equivalent, 0 survivors. It found one
BLOCKER, two WARNINGs and three NITs. The blocker is the most serious finding on
this card and it was caused by my round-4 work.

### The blocker

`create.js` writes NO `CODEX_HOME` for the DEFAULT OpenAI row ("THE DEFAULT ROW
WRITES NO HOME"), so a default-account codex agent's job carries
`configDir: null`. `accountForAgent` then falls to its dir-less arm, which matched
on `isDefault` ALONE. Handed the Claude list, that is the operator's own account.

Measured by the reviewer: a codex job resolving to
`{"dir":"/Users/x/.claude","email":"josh@stonesyndicate.com","isDefault":true}`,
with the control (same job, runner claude) producing an identical row, so only the
runner discriminates.

🛑 MY ROUND-4 COMMENT WAVED EXACTLY THIS OFF: "Only this fallback, not the `found`
branch above: there `isDefault` comes from whichever list matched, which is that
list's own notion and correct for both providers." True of the DIR match, false of
the DEFAULTNESS match. Matching on defaultness keeps no provider straight.

⭐ AND THE ROUND-4 SENTENCE MADE IT WORSE, NOT BETTER. Before it the answer was
plainly wrong ("This agent runs on josh@..."); after it the answer contradicts
itself inside one line ("This is a Codex agent, and it runs on <a Claude email>").
The case is reached by every paneless, crashed, win32 or budget-timeout codex
agent: exactly the population round 4 set out to serve.

The codebase already knew, and the #2413 overlay said so: "a codex agent on the
default home maps to the default Claude account", guarding its own join by
filtering observations per provider. That sentence was TRUE WHEN WRITTEN and this
change is what makes it false, so it is quoted here as the prior diagnosis, never
as current behaviour. The raw mapping in `accountForAgent` was never gated, so
every other caller kept the wrong row.

Fixed by gating the dir-less match on the provider: OpenAI rows carry
`provider: 'openai'` and Claude rows carry none, so the lists are separable. The
dir-matched arm needs no gate, because a codex dir cannot equal a claude row's
dir. Three arms pin it: the codex agent gets NO row from the Claude list, the same
agent still resolves against OpenAI rows (so the gate is not simply refusing
everything), and a Claude agent on the default row is untouched.

### The false measurement, which is worse than the leak it justified

I justified leaving a test record uncleaned by writing that `store.PROFILES` is
"a STRING evaluated at require time" that "reads the operator's REAL store when
the sandbox env is not set first". It is an enumerable GETTER that answers the
CURRENT environment (#1443). I had measured the VALUE with no sandbox env set and
invented the MECHANISM from it, then wrote that invention into a permanent comment
telling the next reader not to fix it.

⭐ Measuring a value and inferring a mechanism is not measuring the mechanism. The
value was right and the explanation was fabricated.

AND THE CLEANUP I THEN WROTE WAS A FALSE GREEN: it referenced a `storeEngine`
binding scoped to a LATER test, so it threw a ReferenceError that its own `catch`
swallowed. The cleanup did nothing and the test still passed. Fixed by requiring
store locally, and verified by checking no file is left behind after a run rather
than by trusting the pass.

### The composition I named rather than changed

`agentUnder` breaks a same-depth tie toward `claude` on purpose, so an ambiguous
pane yields a live `claude` that was CHOSEN rather than observed, and
`resolvedRunner` then prefers it over a plist saying `codex`. Two safeguards
designed independently, composing without anybody having said so.

Kept, on reachability: live-claude over plist-codex is a real product path
(`setProvider` rewrites the plist while the running process stays claude until
restart), and the opposite needs two agent-shaped processes under one pane, which
the reviewer could not construct from any launch path. Named in the code, with the
weakest premise stated: "could not construct" is not "cannot exist", and if such a
topology appears the fix is for `agentUnder` to report that a tie was broken, not
for this line to distrust every live read.

### Three stale or half-false claims in my own comments, corrected

- `recordedRunner`'s profile fallback fires only when the plist is MISSING.
  `readJob` floors `runner` at `'claude'`, so a job that merely predates runners
  answers claude and the profile is never consulted. My comment claimed both.
- `runnerDisplayName`'s "unreachable" bound is weaker than it read, and this
  branch is what weakened it: `resolvedRunner` also takes the tmux marker and the
  plist's ninth argument verbatim.
- The new no-account foreign sentence asserted "we have no startup file for it" on
  a path reachable WITH one present. It now names what it cannot tell and stops.

### All five callers, walked this time rather than asserted

My round-4 commit claimed "all five callers are covered" and round 5 falsified it.
So for the provider gate the claim was checked by reading each one:

| caller | `known` it passes | a codex agent now gets | null-safe? |
|---|---|---|---|
| `whoamiFor` | claude rows | null | `rec ? {...} : ...`, explicit |
| board `accountOf` | claude rows | null | the payload's `account:` already carries null for a non-ours agent |
| `/api/agent/<n>/account-status` | claude rows | null **only when its account dir is unset** | see the correction below |
| accounts overlay, ANTHROPIC arm | claude rows | null | `if (!acct \|\| !acct.dir) continue` |
| accounts overlay, OPENAI arm | openai rows | resolves, unchanged | n/a |

The discriminator was checked at its source rather than assumed: `rowFor` is the
single OpenAI row builder and always sets `provider: PROVIDER` (`'openai'`), and
both `listLive` branches (success and degraded) spread `...row`, so the field
survives every shape. `engine/accounts.js` sets no `provider` at all, so the two
lists are separable in both directions.

## Round 6: the claim above was HALF TRUE, and that is the finding

Round 6 found two WARNINGs and four NITs. The first warning is the row in the
table above, and it is worth leaving the correction next to the claim rather than
editing the claim away.

### I walked one branch and reported the function

The table says `/api/agent/<n>/account-status` gets null and returns before
`subscription.checkLive`. That is true for a DEFAULT-account codex agent, which is
the branch the provider gate fixed and the branch I checked. A codex agent on a
NAMED OpenAI account has a `configDir`, so `accountForAgent` returns a real row,
the `!account` guard does not fire, and `subscription.checkLive` runs
`claude auth status` AGAINST A CODEX HOME. It answers NONE, which the route
renders as a confident `connected: false` plus a remedy telling the person to
re-authenticate from the Accounts tab, about an agent that was never signed out of
anything.

⭐ This is the same shape as round 4's "all five callers are covered", which round
5 falsified: I checked the branch my change touched and reported on the function.
Walking callers is not walking BRANCHES, and the claim I make has to match the one
I checked.

Fixed at the route: a non-claude runner is not asked a Claude sign-in question, and
the answer says so in words rather than returning a false negative.

### The marker's "claude" is a default, not a claim

`engine/status.js` normalises the pane marker as
`pane.runner === 'codex' ? 'codex' : 'claude'`, so an agent whose `@kosmos_runner`
was never recorded is INDISTINGUISHABLE from one recorded as claude, and
`bin/agent-supervisor.sh` says that failure is real: "could not record $SESSION's
runner -- the board will read it as claude".

`resolvedRunner` took the marker whenever it was truthy, so rung 3 (the launch job,
which is definitive) was unreachable for every pane card. A codex agent in that
state with a failed live read resolved to claude, took the stale Claude transcript
model, and was never told it is a Codex agent: this card's own defect, with the
plist in hand and never opened.

Now the marker is trusted only as POSITIVE evidence (`=== 'codex'`), because
`'claude'` there is a default. Everything else falls through to the launch job,
which answers definitively and floors at claude anyway, so a real Claude agent is
unaffected.

### And the unarmed guard, armed to this file's own precedent

A reviewer mutated `live.ok === true` to a truthy test and nothing failed. This
file already carries exactly that arm for the ACCOUNT field (#1409) with the
reason stated: `setLiveReader` accepts any function without shape-checking its
return, so the day a fourth producer appears, `=== true` becomes load-bearing
silently. The runner field now has the same arm, bounded the same way: measured,
all seven `ok:` sites in `engine/runningas.js` are strict boolean literals and
none of the `ok: false` shapes carries a `runner`, so this is an unarmed guard
rather than a live defect.

## Rounds 7 and 8: the verification itself was the thing that lied

### Round 7: a test that could not fail

My account-status arm asserted `connected === null` and `state !== 'none'`. With
the guard removed, `checkLive` answers UNKNOWN in a sandbox ANYWAY, so both held
either way and the only thing pinning the fix was the `because` wording. Renaming
that sentence would have deleted the test silently, and the docstring claimed the
defect was "a confident connected:false plus a remedy" while the fixture could not
produce that shape at all.

Rearmed by stubbing `checkLive` to NONE, and verified the only way that counts:
the mutant now dies on the assertion that DESCRIBES the defect rather than on the
copy string.

Round 7 also found the guard placed BELOW the no-account return, so it never fired
for the default-account codex agent, the card's headline shape. Third instance on
this branch of checking the branch I changed and reporting on the route.

And my own round-6 correction to the web comment was false in the opposite
direction: `!a.account.isDefault` is `!null` which is TRUE, so a NAMED codex
account sends its dir, and must.

### Round 8: I verified with a check that could not fail either

⭐ THE SHARPEST FAILURE ON THIS CARD. I ran a script to add `remedy: null`. The
shell failed to parse the whole command, so the edit never happened. I then
checked with `grep -c "remedy: null,"`, got `1`, and concluded it had landed. That
`1` was a PRE-EXISTING `remedy: null` on a different arm of the same route. The
check could not return the dangerous answer, because the string already existed.
Then I wrote the claim into a commit message, where it stood as a fact.

⇒ The same discipline this card applies to product assertions applies to the
one-off greps that verify an edit: ask whether the check can return the dangerous
answer. A `grep -c` for a string that already exists somewhere in the file cannot.
Verify by POSITION (read the payload, cite the line) or by a mutant.

Two more, both mine:

- A surviving mutant showed the PAYLOAD half was unarmed: I added an `account` row
  to the response and asserted nothing about it, so replacing the whole expression
  with `null` changed nothing any test could see. Both shapes are asserted now.
- `runnerOf`'s fallback pointed the WRONG WAY and cited a FALSE reason. I claimed
  a bad store read would take the route down; `create.recordedRunner` says in its
  own header that it never throws. And `'claude'` on a throw would fall through to
  the Claude probe and restore the very defect the guard stops, while the sibling
  in this same file returns `null`, which fires the guard. Now matched, with the
  unreachability stated rather than an invented justification.

📌 One mutant here is INHERENTLY UNKILLABLE and is recorded rather than papered
over: because `recordedRunner` never throws, no test can reach that catch, so
mutating its return value survives by construction. The direction is fixed and the
unreachability is documented; a test asserting it would have to fake a throw the
product cannot produce.

### A stale number, and why the property is the right claim

My `Browser-check:` trailer cited "1134926 bytes both sides". The reviewer measured
1137891; re-measuring now gives 1137421. All three are correct at their moment: the
figure MOVES WITH EVERY REBASE because main keeps changing `web/index.html`.
⇒ Cite the PROPERTY (non-comment content identical, with a control that perturbs
the file and shows codeOnly differing), never the byte count, which is base
relative and stale the moment anybody merges.

## Round 9: the third site of one fact, and a claim that goes stale by construction

### I copied a sibling without checking the sibling's precondition

`accountForAgent` returns `isDefault: null` for a codex dir ON PURPOSE: `false`
reads as "on a NON-default account" and implies a named alternate that does not
exist. My round-8 codex short-circuit then copied the neighbouring arms'
`isDefault: account.isDefault === true`, which is a genuine NO-OP for them because
a Claude row's `isDefault` is always a real boolean, and so silently flattened the
deliberate null back to false. Then my new assertion pinned `false`, cementing the
exact value this branch exists to remove.

⭐ THIRD SITE OF ONE FACT on this branch: the live path (round 3), the record
fallback (round 4), this short-circuit (round 9). Each time the shape was
"borrowed a pattern from a sibling whose precondition did not hold here". The
duplicated `--model` regex in round 2 is the same shape in a different file.

### Line numbers are a claim that goes stale by construction

Five cited line numbers in `engine/status.js` were off by exactly 13, and wrong
against the merge-base too, so two rebases had never re-derived them. The CONTENT
of all three claims was true.

⇒ Rather than correct the numbers, they are gone. "`engine/status.js`'s only
`runner: null` site" survives a rebase; `status.js:5912` cannot. A citation whose
truth depends on nobody editing a file above it is a claim I have to re-verify
forever, and this card has already shown I do not.

Two citations the reviewer measured as EXACT (`engine/status.js:682`,
`engine/create.js:837`) are kept, and the plan's record of the earlier `:680`
correction keeps its number because naming the wrong one is the point of that
sentence.

### Deliberately not changed

`ok: true` with `account: null` is a shape no prior `ok: true` on this route could
emit. It is the honest answer for a default-account codex agent (we know what it
runs on, and it has no Claude account row), and `grep -rn account-status web/
install/` finds no consumer, so it is latent rather than live. Recorded here so the
next reader does not have to re-derive that it was considered.

## Rounds 10 to 12: every remaining defect was a SENTENCE

By round 10 the fix had been stable and green for nine rounds. Everything found
after that was prose, and the prose failures have three distinct shapes worth
separating, because they need different defences.

### 1. A claim contradicted by its own test, four lines away (round 10)

The tie-break rationale ended "the widening can turn a refusal into an answer, and
cannot turn one answer into another". A shallower codex above a deeper claude used
to resolve to the CLAUDE and now resolves to the codex, which the test `DEPTH still
decides before the runner preference` asserts in the same file. The test was right
and the sentence was wrong, through six rounds of review, because the sentence
SOUNDED like the kind of thing that would be true. Now scoped to the same-depth
tie, the only case it holds for.

### 2. Comments this change killed in files it never edits (rounds 10 to 12)

Eight sites said "a codex agent on the default home maps to the DEFAULT CLAUDE
account". Each was true when written; the provider gate is what made it false.
They live in `server.js`, `engine/observed.js`, `engine/status.js`, three of their
tests, `web.detail-openai-model-2140.test.js` and THIS PLAN. The guards they
justify are still correct as defence in depth, so only the stated reason had died.

⭐ A change can falsify a comment in a file it never touches, and no diff and no
test will ever show it. Grepping for what a change makes UNTRUE is a different
search from grepping for what it touched, and only the first one finds these.

⭐ AND MY OWN COMMENT CITED ONE OF THEM AS EVIDENCE ("the codebase already knew"),
so a new comment pointed at a dead one and presented it as current behaviour.

### 3. Sweeps that cannot find what they are looking for

Three separate causes, all in commands I wrote to hunt exactly this class:

- **`head -8`**: the sweep printed exactly 8 lines and the misses started at 9.
- **`--include='*.js' --include='*.html'`**: uncapped by line count, capped by FILE
  TYPE, which is how the plan's own copy survived a sweep whose commit message
  called it "redone uncapped".
- **A hard-wrapped phrase**: "default Claude\naccount" spans a line break, so NO
  single-line pattern can match it, whatever the file filter. Found only by
  searching a short distinctive token (`default home maps to`) and by a
  multiline-aware pass over every file type.

⇒ A zero from a blind sweep is indistinguishable from a zero from a clean repo.
Every sweep in this card now carries a control that proves it can still see a known
instance, and the count is asserted rather than eyeballed.

### A claim wider than its evidence, in the correction to a claim wider than its evidence

Round 12 caught "so it now maps to nothing" and "the real product now returns NO
ROW for such an agent". Both are true only when the CLAUDE list is passed: against
the OpenAI list a default-codex agent still resolves, to its own default OpenAI
row, which is the whole point of the gate. Two neighbouring sites had scoped it
correctly and these two had not. Now scoped.

### Two sites left alone on purpose

The final sweep reports two remaining present-tense statements of the falsified
sentence, both in OTHER CARDS' plan files (`badge-observed-1921-pre-challenge.md`,
`openai-observed-overlay-2413.md`). They are dated per-card records of the
reasoning at the time those cards were built, like a commit message, and editing
one to reflect a later change rewrites history rather than correcting
documentation. A live code comment claims what the code does NOW and carries a
different obligation; a plan claims what was believed THEN.

Recorded here so the next sweep does not read them as a miss.

## Round 13: I had been sweeping for one sentence, not for the class

The blocker was in `engine/runningas.js`, the file this change edits most, at a
line it does not touch. The `win32Answer` comment said `because` on a successful
read is a shape "which the darwin arm never does", and that `server.js` "reads only
ok/account/configDir/model". This change made both false, and the comment I ADDED
four lines from the darwin `because` cites that block as its precedent. So a new
comment pointed at one that denies the very property it claims.

⭐ THE GAP WAS THE METHOD, NOT THE MISS. For twelve rounds I swept for ONE
falsified sentence (the `accountForAgent` mapping) and never asked what OTHER
sentences this change falsifies. Fixing an instance is not fixing a class.

### The two sweeps that should have existed on day one

**1. What claims does this change falsify?** Enumerate the subjects the change
alters (`runningAs`, `agentUnder`, `whoamiFor`, `accountForAgent`, the darwin and
win32 arms, `/api/whoami`, `account-status`), then find every COMMENT mentioning
one of them that also contains an absolute word: never, only, always, cannot,
nothing, "reads only". The absolutes are the tell, because a claim with no
absolute is usually still true after a widening. 48 candidates, all reviewed.

**2. What enumerations does this change make SHORT?** The blocker's second clause
was a list of fields that no longer lists them all. Sweeping for that SHAPE rather
than that instance found a second one the review had not reported:
`runningAs`'s own docstring still documented the return as
`{ ok, account, organization, model, configDir, because }`, omitting the `runner`
field this card adds.

⇒ Corrected, and verified by DRIVING the function and comparing documented keys
against actual keys, rather than by reading the list and believing it:

```
documented: account,because,configDir,model,ok,organization,runner
actual    : account,because,configDir,model,ok,organization,runner
MATCH: true
```

A field list is a claim like any other.

🛑 AND THE LESSON AS FIRST WRITTEN WAS WRONG, falsified by the very fix that
produced it. It said a field list "goes stale in exactly one direction: silently
short, never long". Round 14 measured the opposite: the corrected docstring was
LONG for the win32 arm, which does not carry `runner` at all (the key is ABSENT,
not null). I had driven one arm, seen `documented == actual`, and published a
general claim from a single-arm measurement.

⇒ A field list goes stale in BOTH directions, and a function with two
platform arms has two shapes to document. The verification has to drive every
arm, which is now written into the docstring itself:
```
darwin -> account,because,configDir,model,ok,organization,runner
win32  -> account,because,configDir,model,ok,organization
```

### The sweep worked. I did not read its output.

⭐ THE SHARPEST FAILURE ON THIS CARD, and it is not a blind sweep. Round 14's
first blocker was `whoamiFor returns account/model/source`, which is short by
`resolvedRunner`, a key THIS CHANGE ADDS. That line was IN MY OWN SWEEP'S OUTPUT:

```
engine/runningas.js:550  it when `ok` is true today (`whoamiFor` returns account/model/source and
```

The sweep found it, printed it, and I fixed a different hit from the same run
(the docstring at 458) and never read the other sixteen.

⇒ Three blind sweeps earlier on this card failed because the COMMAND could not
see. This one failed because the command saw perfectly and the reader did not.
A sweep is not evidence until its output has been read line by line, and a
17-hit list is exactly the length that feels skimmable.

## Rounds 14 and 15: the remedy was the defect

### One field, three wrong docstrings, each narrower than the last

`runningAs`'s documented return shape was wrong three rounds running:

| round | claimed | wrong because |
|---|---|---|
| 13 | lists `runner` unconditionally | win32 never carries it |
| 14 | "darwin arm only" | darwin's REFUSALS do not carry it either |
| 15 | "successful darwin read only" | correct, and still only prose |

Every correction was generalised from the paths I had just been shown. A PARTIAL
verification feels identical to a complete one, and "I drove it" sounds like proof
regardless of how many paths were driven.

### The fix that mattered was not a better sentence

Round 15's third finding is the one that breaks the cycle, and it is a criticism
of my REMEDY rather than my code: the measured matrix was recorded in a COMMENT
and nothing kept it true. No test asserted the key-set on either arm. "Driven on
both arms rather than read" was accurate the moment it was written and decayed
immediately, in a file that demands the opposite standard eighty lines down
("Asserted in `runningas.test.js` so it is a checked value rather than
decoration").

⇒ That is why the same docstring was wrong three times. Each fix produced a better
SENTENCE, and a sentence is the thing that goes stale. The matrix is now a test
(`the ANSWER SHAPE is pinned per path`): four paths asserted, and mutants that add
a `runner` key to a darwin refusal or to a win32 success both go red.

⭐ A CLAIM THAT MATTERS NEEDS AN ASSERTION, NOT A CLEARER PARAGRAPH. Everything
this card fixed in prose stayed fixed only until the next change; the two things
converted into tests (the codex `because`, and now the answer shape) cannot
silently rot.

### A sweep keyed to a phrase cannot find a paraphrase

Round 15's blocker was `exactly this shape` while round 14 had swept for
`same answer shape` and corrected a different line. One file asserted both "NOT
the same answer shape" and "exactly this shape" about the same pair of arms.

⇒ The wrap trap in different clothes. A pattern matches a SPELLING; the claim
lives in the MEANING. Sweeping for one phrasing of a belief finds the instances
that happen to share your wording and silently misses the rest, which is why the
durable fix is an assertion rather than a better sweep.

## Round 23: the SOURCE of a premise I corrected at round 2, and an over-claimed message

Two findings from the reviewer, both verified against the source before acting, plus one
they did not name that the first finding led to.

### The reviewer's [MAJOR], confirmed

`server.test.js` still said `setProvider` "switches an agent claude -> codex by rewriting
the plist and nothing else". `setProvider` spans `create.js:1064` with no function boundary
before 1400, and two more statements sit inside it: the brief rename CLAUDE.md <-> AGENTS.md
(1386) and `store.writeProfile(clean, { provider })` (1389).

I corrected this exact sentence in `server.js` and in this plan at **round 2** (`git log -S`
names `1d1fa7bd`); the third copy, written at round 1 (`67bf1a29`), stood for 22 rounds.

### The reviewer's [NIT], HALF right, and the half that was wrong matters

They said `assert.doesNotMatch(said, /josh@example.com/)` cannot fail, because `acct` is
asserted null 20 lines above. I measured instead of agreeing:

```
mutant: a fallback in sentenceForWhoami when `account` is null
        -> kills THAT line by name (operator: 'doesNotMatch')
mutant: re-derive via `accounts.list()` when `account` is null
        -> that line stays GREEN (the fixture's rows are a local array, not on
           disk); 4 other arms red
```

So it is killable, but far narrower than its message claimed. ⭐ **Their reasoning named only
mutants of `accountForAgent`, and correctly showed those red the earlier assertion first. They
did not consider mutants of the OTHER function on the same line.** The line's message now says
what it actually guards, and CONTROL 3 was added: the same regex against the same rows for a
CLAUDE agent DOES match, so a passing `doesNotMatch` now proves the pattern can fire.

### What the MAJOR led to, which the reviewer did not name

A wrap-normalised sweep for `plist … nothing else` found the **source**: `setProvider`'s own
header in `engine/create.js`, a file this change never edits. Every clause of it is false, and
`git log -S` dates it:

```
"no record is copied, moved, or stamped"   written  8fe044b8  2026-08-24
store.writeProfile(clean, { provider })    added    8fe044b8  2026-08-24   <- SAME COMMIT
fs.renameSync(oldBrief, newBrief)          added    a98e282e  2026-09-05
```

⭐ **It was never true.** The profile write landed in the same commit as the sentence denying
it; the brief rename twelve days later widened an error that already existed. **A sentence
written beside the code it describes is not thereby checked against it.**

⭐ **And the third write is this card's own mechanism.** The profile `provider` is the SOLE rung
naming the runner on Windows (round 22). "Nothing else" denied the existence of the thing the
product depends on, in the header of the function that writes it.

### The durable fix, again an assertion rather than a sentence

`engine/create.setprovider-writes-2811.test.js`: one test, three writes, each with the fixture's
PRE state asserted first so a setProvider that did nothing reds all three.
🛑 **ROUND 24 MEASURED FOUR, AND REPLACED THIS TEST ENTIRELY.** See the round-24 section below;
the count above is left as the dated record of the error, and the sentence about everything
staying inside `workerDir` is false in three ways.

```
MUTANT: delete the brief rename    -> "write 2: the brief was renamed to AGENTS.md"   RED
MUTANT: delete the profile write   -> "write 3: the profile provider was stamped"     RED
```

It also pins the property the false premise was standing in for: everything that moves stays
inside `workerDir(name)` and the name never changes, which is the real reason a workdir-keyed
Claude transcript survives the switch and this card's stale-model guard is necessary.

The two earlier copies in this plan are LEFT IN PLACE with a correction stamped on each: they
are the dated record of what I believed, and rewriting them would erase the evidence that the
belief persisted across three files and 22 rounds.

⇒ **Eight claims on this card are now assertions.** Every one I fixed in prose has rotted. None
converted to an assertion has.

### Round 23 postscript: a count of MINE that drifted, caught from the reviewer's verification list

Round 23's reviewer appended a list of things they checked and found CORRECT. One line of it
disagreed with a summary of mine, so I measured rather than skimming past a passing item:

> "the docstring key-matrix in `runningas.js` ... matches the 9 real return sites: 3 in
> `runningAsDarwin` (594, 602, 643), 2 in `runningAsWin32` (408, 485), 4 in `win32Answer`
> (360, 362, 365, 367)."

**Their nine is right. My handoff said "asserted on all TEN return paths."** The table in
`engine/runningas.test.js` has TEN ROWS driving NINE RETURNS: `darwin ok:true codex` and
`darwin ok:true claude` both land on the same return (`runningas.js:643`). A count of CASES is
not a count of PATHS, and I had been quoting one as the other.

⭐ **AND MY OWN RE-COUNT WAS ALSO WRONG, IN THE OTHER DIRECTION.** `grep -nE '^\s*return'`
returned EIGHT answer returns, not nine, because it cannot see a **one-liner guard return**:

```
485:  if (!entry) return { ok: false, because: `no session called ${session} ...` };
362:  if (cmds == null) return { ok: false, because: 'we could not read the process table ...' };
```

Both sit after an `if` on the same line, so an anchored `^\s*return` skips them. **The pattern
was right about the thing it matched and wrong about the question it was asked**, which is this
card's recurring failure in its smallest form yet.

✅ **The committed FILES were correct the whole time.** `runningas.test.js:261` says "TWO of the
nine" and the table is the full set. Only my SUMMARY of the test drifted, in the handoff, and in
the 2026-09-11 daily note. **A summary is a third copy of a fact and rots exactly like the other
two.**

⚠️ One "all ten" survives in a COMMIT MESSAGE and is left alone: rewriting history to fix a
count is worse than the count.

📌 **What the reviewer did that is worth copying: they listed what they had checked and found
RIGHT, with line numbers.** Every prior round reported only defects. A verification list is
checkable in a way "I found nothing else" is not, and the one error in this loop's own
bookkeeping surfaced from a line that was reporting SUCCESS.

## Round 24: my round-23 correction was itself wrong, in the way it had just named

Round 24's reviewer measured that `setProvider` performs **FOUR** writes, not the three I
enumerated one round earlier, and that the fourth is the FIRST to execute:

```
engine/create.js, inside the `provider === 'openai'` branch:
    try { trustCodexFolder(workerDir(clean), acct.dir, !acct.dir); }
    catch { return { outcome: OUTCOME.REFUSED, because: '...' }; }
```

`trustCodexFolder` appends `[projects."<workerDir>"] trust_level = "trusted"` to
`<codexHome>/config.toml`. ⚠️ It is the **only one of the four that is not best-effort**: its
catch returns REFUSED, so it decides whether the switch happens at all.

⭐ **I made, in the correction, the exact error the correction names.** Its own text says the
card's pattern is "each version verified the rung it had just been shown and inferred the rest",
and then I enumerated the two statements the round-23 reviewer pointed at and inferred the set
was closed. **Being able to state a failure mode in one paragraph is no defence against
committing it in the next.**

### And the property I asserted alongside it was false THREE ways, of which the reviewer caught one

I wrote "everything that moved stayed INSIDE `workerDir(name)`" and asserted it. Measured, with
a control (the same probe with `setProvider` stubbed out changes nothing):

```
  MODIFIED > OUTSIDE  <sandbox>/data/Kosmos/profiles/<name>.json
  CREATED  > OUTSIDE  <sandbox>/home/.codex/config.toml
  MODIFIED > OUTSIDE  <sandbox>/launch/com.kosmos.agent.<name>.plist
  CREATED    INSIDE   <sandbox>/workers/<name>/AGENTS.md
  DELETED    INSIDE   <sandbox>/workers/<name>/CLAUDE.md
```

**Three of the five are outside it, and the plist and the profile always were.** The reviewer
found the newest one; the other two had been false since I wrote the sentence. A sentence about a
directory, written while looking at the one write that happens to be in it.

✅ **What is actually true**, and it is what the false premise was standing in for:
`workerDir(name)` is not itself MOVED and the agent's NAME does not change, so every lookup keyed
on either resolves the same directory afterwards. That is why #2811's stale-Claude-transcript
guard is necessary rather than moot.

### The durable fix: stop counting, start measuring

`engine/create.setprovider-writes-2811.test.js` no longer asserts a count or a list I wrote down.
It snapshots every path under the sandbox with a content hash, runs `setProvider`, and asserts
the **EXACT SET** of created/modified/deleted paths.

```
MUTANT delete the trust write     -> RED  ("a different set of paths than this test documents")
MUTANT delete the brief rename    -> RED
MUTANT delete the profile write   -> RED
MUTANT ADD A FIFTH WRITE          -> RED   <- the capability the counting version never had
```

⭐ **That last mutant is the whole point.** Three versions of this claim were wrong because a
human enumerated what a human could see. The machine now enumerates it every run, so there is no
reading of mine left to be wrong. The header says so and tells the reader to go to the test.

📌 The sandbox seal (`delete process.env.CODEX_HOME`, `AGENT_WORKFORCE_CODEX_HOME`) is
**load-bearing here rather than tidy**: this file asserts the FULL set of paths, so an unsealed
root would put the trust write on the real machine, outside the snapshot, and the assertion would
pass while missing it.

### Round 24, the rest: three more false claims, two found by the reviewer and two by me

**"a dozen lines below the sentence"** (reviewer's MAJOR 2, and I measured it independently before
their message arrived). The statements sit **322 and 325 lines** below `function setProvider`
🛑 **AND I ENDORSED A SECOND FIGURE WITHOUT RUNNING THE SUBTRACTION.** This sentence used to add
"(342 and 345 below the header line; the reviewer's figure, from a different datum, and both are
right about what they measured)". The reviewer's datum was the SENTENCE line, not the header line;
from the header line it was 360 and 363 at that commit, and it is 381 and 384 now. **I certified
somebody else's number as measured while mislabelling its anchor.**
⭐ **The surviving figure and the rotted one differ in exactly one way, and it is the general
rule: 322 is measured from `function setProvider`, a NAMED anchor that moves WITH its target, so
my header edits shifted both and the distance is still exact today. The header-line figure was
measured from a line my own edit landed above, so it rotted inside the same commit that wrote
it.** That is the round-9 citation rule in a form I did not recognise: **a distance from a named
anchor survives; a distance from a line number is a line number.** At the MERGE-BASE too, so it was never true. `git log -S` dates
the phrase to round 2, and **round 23 copied it into two more files while correcting the sentence
it sits inside.**

⭐ **Why a wrong distance is not cosmetic: it made the error sound glanceable**, which made its
22-round survival read as carelessness. At 322 lines the survival needs no explaining.

**`server.js`'s present-tense claim about a header my own next commit rewrote** (reviewer's MAJOR
3). It said "`setProvider`'s own header SAYS the mechanism is ... and nothing else"; `c32b1c7a`
replaced that header, so a reader following the pointer found the opposite of what they were
promised. ⚠️ **And that commit's own message asserted "engine/create.js is otherwise untouched:
comment-only"** while invalidating a sentence in a file it did not touch. The round-10/11 shape
("comments this change killed, in files it never edits") **recurring inside the commit that
corrected it.**

**"`setProvider` rewrites the plist AND THE MARKER"** (mine, not reported). Two live copies.
FALSE, measured: `setProvider` never invokes tmux over its whole body, and the control says who
does - `bin/agent-supervisor.sh:465` writes `@kosmos_runner` at agent **START**, which is AFTER
the restart the described window waits for. **So during that window the marker still holds its
OLD value, not the new one.**
📌 **What I did NOT do with that finding, deliberately:** conclude that the live-claude +
codex-marker state is unreachable. I measured how the marker behaves in THIS window, not every
route to that state, and the arm constructs the state directly so its behaviour is pinned either
way. **Measuring one mechanism and pronouncing on the whole space is this card's signature error;
naming the boundary is cheaper than committing it a sixth time.**

**A stale enumeration with stale line numbers** (mine). `server.test.js` still listed three writes
with `create.js:1386/1389`, which are now 1418/1421. Both the count and the coordinates rotted.

### The pattern across all of them, and it is now a rule I follow rather than a lesson I record

Every one of these is a **prose restatement of a fact that a test could hold.** So all three
prose enumerations of what `setProvider` writes are now DELETED rather than corrected, each
replaced by a pointer to the measuring test. The remaining sentences state only the PROPERTY the
guard rests on, which is the thing those enumerations were standing in for and is one line long:
`workerDir(clean)` is not moved and the NAME does not change.

⭐ **A correction that produces another sentence has changed the wording, not the failure mode.**

### Round 24, MAJOR 4 and NIT 5: the round-9 rule broken, and two vacuous assertions of mine

**MAJOR 4: round 23 reintroduced the exact citation style round 9 banned, and it rotted in 18
minutes.** Round 9 ruled (this plan, "Rather than correct the numbers, they are gone"):

> "A citation whose truth depends on nobody editing a file above it is a claim I have to
> re-verify forever, and **this card has already shown I do not.**"

Round 23 wrote `create.js:1386` and `create.js:1389` into `server.test.js`, and the very next
commit of the same round added 20 lines above them. **The prediction came true inside one round,
by the same author.** Both citations are gone rather than corrected, and I swept my whole diff:
three line-number citations were added on this branch and all three are now removed. (Pre-existing
ones elsewhere in `server.js`/`server.test.js` are not mine and are left alone.)

**NIT 5, and the reviewer reported the milder of the two.** They flagged
`assert.equal(nodePath.dirname(nodePath.join(dir, 'AGENTS.md')), dir)` as a tautology about
`node:path`. True, and it was already gone in the rewrite. But the rewrite I had just written
contained a worse one:

```js
assert.equal(create.readJob(name).name || name, name, 'the agent name is unchanged');
```

`readJob` returns `{ claude, tmux, model, configDir, runner }` and **no `name` key at all**, so
this read `undefined || name` against `name`. A literal tautology carrying a message about a
product property. A second, `assert.equal(outside.length, 3)`, was implied by the `deepEqual`
above it and so could never fail independently.

⭐ **I wrote both in the same session in which I was removing that class from two other files.**
Knowing a failure mode by name does not stop you producing it; only a mutant does.

### A third shape, found while fixing the second: AN ASSERTION CAN BE SHIELDED BY A CRASH

The replacement, `assert.ok(create.readJob(name))`, was still unreachable where I first put it.
The isolating mutant (a plist written at the SAME path but unparseable, so `readJob` returns null)
made the `.runner` read ABOVE it throw a TypeError first, and the arm died with a stack trace
instead of a sentence. Measured, both orders:

```
assertion BELOW the .runner read  ->  TypeError: Cannot read properties of null (reading 'runner')
assertion ABOVE it                ->  AssertionError: the launch job is no longer readable ...
```

⇒ **"What mutant kills this?" is not the whole question. "Does anything above it throw first?" is
the other half**, and a crash looks like coverage: the test IS red, so a mutation run scores it as
killed. Only the MESSAGE tells you which assertion did the work, and a stack trace tells you none
did.

Every assertion in `engine/create.setprovider-writes-2811.test.js` now has a named mutant that
reds it BY MESSAGE:

```
delete the trust write / the rename / the profile write   -> the exact-set assertion
ADD a fifth write                                         -> the exact-set assertion
profile records a different `dir`                         -> "the worker directory MOVED"
plist unreadable at the same path                         -> "the launch job is no longer readable"
```

## Round 25: two false claims, both from the round-24 fix, and a new shape

**[BLOCKER] "the ONLY one that is not best-effort" is false.** Inside `setProvider` **TWO** of the
four writes gate the switch, not one:

| write | catch | gating? |
|---|---|---|
| `trustCodexFolder` | returns REFUSED, "we could not let the OpenAI runner work in its folder" | **yes** |
| plist via `plistFor` | returns REFUSED, "we could not write <name>'s startup file" | **yes** |
| brief rename | comment-only swallow | no |
| `store.writeProfile` | comment-only swallow | no |

⚠️ **And gating is a property of the CALL SITE, not of `trustCodexFolder`** - a distinction
neither the reviewer nor I had made. The same function is called four times in `create.js`:
REFUSED in `setProvider`, `trust:{ok:false}` with a CREATED outcome on the create path, swallowed
outright on the adoption path, where a pre-existing comment calls it *"non-gating and
best-effort"* and is **right about its own site**. Two comments that look like they contradict
each other are both true, one scope apart. That is the same measuring-one-path-and-pronouncing
failure this card has now made six times, so the paragraph says which site it is about.

🛑 **ROUND 26 FALSIFIED THAT ENTIRE SENTENCE AND IT IS LEFT ABOVE AS THE DATED RECORD.** Three of
its four site attributions are wrong; see the round-26 section below. The paragraph written to FIX
a scope error contained the same scope error.

✅ **Converted to an ASSERTION, not a better sentence.** A new arm makes `config.toml` read-only so
`trustCodexFolder`'s `appendFileSync` throws a REAL EACCES (nothing injected), and asserts the
refusal, its wording, and that NOTHING was written before the gate fired.

```
MUTANT make the trust write swallow      -> "a failing TRUST write no longer aborts the switch"
MUTANT a write BEFORE the trust gate     -> "the refusal says nothing was changed but paths were written"
MUTANT a write after the gate            -> the exact-set assertion
```

📌 **The first mechanism I tried did not work and the arm told me instantly.** Chmodding the
account DIRECTORY to 0o500 changed nothing: directory write permission governs creating and
removing entries, not appending to a file that already exists, and the arm above had already
created `config.toml` in the shared sandbox. The test said `setProvider reported created` on the
first run. **A test that can tell you your mechanism is wrong is worth more than one that agrees
with you.**

**[MAJOR] the sandbox seal's stated failure mode was backwards.** I wrote that without the seal
"the assertion would pass while missing it". Measured, with the seal removed and an external
signed-in `CODEX_HOME`: the trust entry DOES land outside the sandbox, **and the test REDS**,
naming the missing path, because the expected list is built from the fixed `SIGNIN` constant so a
trust write that goes elsewhere always subtracts an expected element. It fails LOUD, exactly as
`create.switch-account-1373.test.js` already says of its own seal.

⭐ **A NEW SHAPE, AND THE MOST USEFUL THING IN THIS ROUND: A JUSTIFICATION CAN OUTLIVE THE THING
IT JUSTIFIED.** That sentence was TRUE of the PREVIOUS version of this file, which asserted
nothing about the trust write at all. I replaced the mechanism in round 24 and carried its
rationale across unchanged. **A rationale reads as checked because it WAS checked - once, against
code that no longer exists.** Neither a diff nor a test can see it: the comment did not change,
and nothing it describes is asserted.
⇒ **When you replace a mechanism, re-derive its rationale rather than moving it.**


## Round 26: the paragraph that fixed a scope error contained the same scope error

Round 25's repair added a paragraph headed **"GATING IS A PROPERTY OF THE CALL SITE"**, whose
purpose was to stop me measuring one call site and pronouncing on the space. It then named four
call sites and got three of them wrong.

| site | enclosing function | on throw | what I claimed |
|---|---|---|---|
| 1014 | `setCodexAccount` | `trust={ok:false}`, still CREATED | I attributed this to the create path |
| 1350 | `setProvider` | returns REFUSED | correct |
| 2542 | `installJob` | swallowed | I called it "the adoption path" and sourced a quote from it that is not there |
| 3861 | `createAgentInner` | `step()` -> `trustedFolder` false -> `wroteJob` false -> `rollBack()` -> **PARTIAL** | I called it non-gating |

**The create path is the MOST gating of the four**, and the only site where a throw UNDOES work
already done. I described it as the lenient one.

### The cause was a NAME COLLISION, and it is worth knowing before reading any "the trust write" comment in create.js

`trustFolder` (the **Claude** trust write, in `engine/trust.js`) and `trustCodexFolder` (the
**codex** one, in `create.js`) are DIFFERENT FUNCTIONS. The `⚠️ NON-GATING, AND NOT A STEP`
comment I cited in round 25 as a pre-existing comment that "is right about ITS site" describes
`trustFolder`. I read the words *"the trust write"*, saw the function I was already looking at,
and inherited a property that belongs to the other one.

⭐ **This is the failure mode in its purest form yet: not a careless claim, but a claim made
INSIDE the correction for that exact class, defeated by two functions whose names differ by one
word.** A rule cannot protect you from a misidentification, because you are applying the rule
correctly to the wrong object.

### The repair is DELETION, not a better enumeration

A `setProvider` header has no business describing other callers; that IS the scope error. Both
copies now assert one site and enumerate none, and name the collision so the next reader does not
repeat it. The claim that matters (this site gates, and nothing is written before the gate fires)
was already an assertion and is untouched.

⇒ **Where a rule failed, the structural fix is to remove the opportunity rather than restate the
rule.**


### Round 26's NIT: the header named TWO gates and round 25 converted only ONE

"the plist rewrite ... Also gating" was a true sentence with nothing holding it. Measured before
writing the arm, so the gap was real and not a silent grep: `grep -rn "startup file"` over
`engine/*.test.js` and `server.test.js` found only `setModel`, `remove` and `whoami` arms, while
the same grep DOES find the wording elsewhere.

✅ A symmetric arm now makes the PLIST read-only so its write throws a real EACCES, and asserts the
refusal, its wording, and **the exact set of writes already done when the gate fires** - which is
the trust append alone. That pins the ORDER as a by-product: the trust write had landed and
nothing after the plist write ran.

```
MUTANT setProvider's plist refusal -> CREATED   -> "a failing PLIST write no longer aborts the switch"
MUTANT delete the trust write                    -> the exact-set assertion
```

📌 **A mutation attempt that FAILS TO APPLY reads exactly like a surviving mutant.** My first try
asserted the refusal string was unique and it is not: that sentence appears FOUR times in
`create.js`. The assert fired, the file was left unmutated, and the suite printed `pass 3` - which
is "the mutant survived" in every visible respect. ⇒ **Assert that the mutation applied, not just
that the file parsed.** The header now warns that the string has four copies.


## Round 27: an arm that only passes in file order, and a claim of "asserted" covering half its subject

**[MAJOR] The round-26 arm was not independently runnable, and I had written the exact guard it
needed one round earlier.** The plist-gate arm expects `MODIFIED <signin>/config.toml`, and the
verb is only right if that file exists when the snapshot is taken. Nothing in the arm created it;
it inherited it from the arm above.

```
node --test --test-name-pattern='the PLIST write is the second gate' ...
✖ actual:   [ 'CREATED  /home/.codex/config.toml' ]
  expected: [ 'MODIFIED /home/.codex/config.toml' ]
```

The sibling arm passes alone because it carries `if (!fs.existsSync(cfg)) fs.writeFileSync(cfg,
'', 'utf8')` with the comment *"do not depend on that ordering"*. **I wrote that line, and omitted
it in the next arm I wrote.**

⚠️ **The damage is not the red, it is WHERE THE RED POINTS.** The failure message is "the plist
gate fired with a different set of writes already done", so a shard, a name filter, or a reorder
turns a green arm red and sends the reader into `setProvider`, which behaved identically in both
runs. ✅ **All FIVE arms in the file are now verified to pass alone**, not just the one reported.

**[MAJOR] The header said the four-way gate/swallow split "is now an ASSERTION"; only the two
gating halves were asserted.** The reviewer probed REACHABILITY rather than grepping for a test
name: both swallow catches were replaced with a `throw`, the mutation asserted applied, and every
file that exercises `setProvider` was run (`create.test.js`, `server.test.js`,
`switch-account-1373`, `runner-dir-1616`, `spoken-name-1367`, and this file). **Nothing surfaced.
Neither catch was entered by any test in the repo**, so "swallows" and "gates" were
indistinguishable for writes 3 and 4.

✅ **Two new arms, and the fix is an assertion rather than a retraction.** The worker directory is
made non-writable so the same-directory rename throws, and the profiles directory is made
non-writable so `store.writeProfile`'s temp-plus-rename throws. Each asserts the switch COMPLETES
around the failure, which is the entire content of "best-effort", and each asserts the failure
really happened so the arm cannot pass vacuously.

⭐ **And the verification is stronger than "the branch is currently unreached": under the throw
mutant, the two new arms RED WITH THAT THROW.** Proving a branch is unreached is a statement about
today; proving your arm reaches it is a statement about the arm.

📌 **Reachability is a better probe than a name grep.** A grep for a test name asks whether anybody
wrote something that looks like coverage. A throw in the branch asks whether anything actually goes
there. The two answers differed here for two of four writes.

## Round 28: round 27's own lesson, turned on round 27's code

**[MAJOR] Three of the four "everything else still landed" messages diagnose something the
execution order forbids.** `setProvider` writes plist -> rename -> profile with **no rollback**:

```
engine/create.js   fs.writeFileSync(plistPath(clean), ...)      write 2 (plist)
                   try { fs.renameSync(oldBrief, newBrief); }   write 3 (rename)
                   try { store.writeProfile(clean, ...) }       write 4 (profile)
```

A failure at write 3 cannot un-write write 2. So "the plist write did not happen, **so the rename
did gate it**" is not an available inference, and neither an absent plist nor an absent rename can
ever show that the **profile** write gated. Of the four, only one was sound: the profile check
inside the RENAME arm, because the profile follows the rename.

⭐ **This is round 27's finding applied to round 27's code**: *"the damage is not the red, it is
where the red points."* Those assertions CAN red (a rename failure still leaves
`outcome === CREATED`, so nothing shields them), and when they do they send the reader to the
wrong write.

✅ **The rule the messages now encode, which is the general form:**
- an assertion on a write **BEFORE** the mutation point is a **CONTROL** that the arm is
  exercising what it claims; its red means THE ARM IS INVALID
- an assertion on a write **AFTER** it is **EVIDENCE** of non-gating; its red means the write
  under test DID gate

⇒ **Message each assertion for what it can actually diagnose**, which is decided by its position
in the sequence, not by which arm it happens to live in.

**[MAJOR] "ALL FOUR are asserted" had the wrong nearest antecedent.** It sat inside the bullet for
write 2, one sentence after *"that string appears FOUR times in this file"* -- so it read as "all
four copies of the refusal string are asserted", a flat contradiction of the warning immediately
above it. The intended subject was the four WRITES, two bullets up.

✅ Fixed structurally rather than by a word: the paragraph is out of the bullet list entirely, its
subject is stated, and the reason it moved is recorded so nobody puts it back. **A pronoun whose
antecedent is two bullets away is a claim about whatever is nearest.**

### Round 28's two NITs, both sharper than their label

**A bare `return` under root reports the arm as PASSED, not skipped, so "cannot pass vacuously"
was false there.** All four EACCES arms guarded with
`if (process.getuid && process.getuid() === 0) return;`. Under root every one returns before a
single assertion runs, and the tally cannot tell that from a real pass.

⚠️ **And this was a DEPARTURE FROM AN EXISTING CONVENTION, not a missing one.**
`engine/instructions.test.js` already calls `t.skip('running as root, so ...')` for exactly this
mode-bits problem, twice, in the same directory. I invented a weaker form beside a working one.

✅ Converted to `t.skip`, and verified with a control rather than by reading: forcing the guard
true gives

```
before the fix (bare return):   ℹ pass 5   ℹ skipped 0     <- a lie the tally cannot expose
after  (t.skip):                ℹ pass 1   ℹ skipped 4
```

📌 The reviewer bounded it correctly as a NIT by measuring reachability: both workflows are
`runs-on: macos-latest` with no container or root path, so the vacuous-pass state is not currently
reachable in CI. **A true claim about an unreachable state is still a false claim**, and the fix
cost one line.

**"the MOST gating of the four" is a RANKING over the set the same paragraph says it no longer
enumerates.** Round 26 deleted the four-site enumeration and stated the remedy as *"assert one
site and enumerate none"*. The comparative survived the deletion, asserted by no test.

⭐ **A ranking is an enumeration that survived the deletion of the enumeration.** It reads as a
single word rather than a list, which is exactly why it was not noticed when the list went. Fixed
by deletion: the bounded mechanism (a throw there rolls the creation back, measured in round 26)
stays; "most" goes.

## A structural decision I made rather than waiting to be told: the header was the target

Not a review finding. Measured while round 28's suite ran:

```
setProvider's header at the merge-base:   18 lines
                        after round 27:   91 lines
defects found in that header:             rounds 23, 24, 25, 26, 27, 28  (six consecutive)
defects found in the ASSERTIONS beside it: zero
```

Every arm I have added has held. Every paragraph I have written about those arms has been wrong at
least once. **The loop was not failing to converge; I was moving the target each round by adding
prose, and each reviewer was correctly finding defects in the new prose.** That is the
`a-loop-can-converge-on-a-target-you-keep-moving` bulletin, and I was producing it rather than
suffering it.

✅ **The header is cut to 50 lines and now carries only what a reader of `setProvider` needs:**
what "with its memory" means, a pointer to the test that MEASURES the write set, a four-line
orientation table, the `trustFolder`/`trustCodexFolder` name-collision warning (a live hazard
when reading OTHER comments in the file), and the property callers actually depend on
(`workerDir` is not moved, the NAME does not change).

🛑 **Everything removed is the round-by-round history of my own wrong versions, and it was checked
into the plan BEFORE deletion, not after.** I probed nine distinct phrases; eight were present and
one returned zero. That zero was MY PROBE being wrong (the phrase wraps across a line break in the
plan), not a missing record - the same wrap trap this card has hit four times. **Check that the
record survives elsewhere before you delete it, and treat your own probe as the likelier failure.**

⭐ **The principle, and it is why the history had to move rather than shrink: A CODE COMMENT IS
READ AS CURRENT FACT; A PLAN FILE IS READ AS A DATED RECORD.** Keeping "here is what I used to
believe and why it was wrong" in a header puts falsified claims in the place reserved for true
ones, where each one is a fresh surface for the next reviewer. The history is worth keeping. It
was in the wrong file.

### And the half of that NIT I under-applied on the first pass

The reviewer flagged BOTH copies; I fixed the ranking in `create.js` and judged the test-file copy
safe because its cross-site claim is *bounded and measured* rather than a ranking. That was the
wrong test. The defect is in the **topic sentence**, and it is in both:

> "this arm asserts `setProvider` and **says nothing about the other three callers**. It used to
> name them and was wrong about all three, including calling the create path non-gating ..."

A sentence saying it says nothing about them, immediately followed by saying something about one
of them. The *content* is legitimate - a dated record of a measured error - but the topic sentence
is falsified two lines later by its own paragraph.

✅ Both now say what is actually true: the arm **ASSERTS** one caller and no other, and recording a
measured historical error is a different act from enumerating or ranking them. The distinction is
stated rather than implied, because implying it is what produced three rounds of this.

⭐ **The general form: "says nothing about X" is a much stronger claim than "asserts nothing about
X", and prose reaches for the stronger one.** Every version of this paragraph since round 26 has
over-claimed in exactly that slot.

📌 **HOW THOSE 15 LINES WENT MISSING, AND IT IS A TRAP WORTH THE NOTE.** A background job was
appending this section to the plan while a foreground edit rewrote the same file. Both read, both
wrote, last writer won, and the loser's `.tmp` survived because its `os.replace` never ran. The
plan file is append-only in practice, so nothing looked wrong: the file was longer than before,
just missing a section nobody was counting.
⭐ **It was recovered only because I READ the stray `.tmp` before deleting it.** A `rm` of an
obvious leftover would have destroyed the only copy, silently, in the same minute I wrote a
paragraph about checking that a record survives elsewhere before removing it.
⇒ **Do not run a file-appending background job and a foreground edit against the same file.**

## Round 29: the sentence about not enumerating the callers got the count wrong

**[MAJOR] "the other three callers" is four.** `trustCodexFolder` is EXPORTED
(`engine/create.js`, the module exports), and `server.js`'s trust route calls it live inside the
`job.runner === 'codex'` branch. Measured, every non-test call site in the REPO:

```
engine/create.js  setCodexAccount    catch -> trust:{ok:false}, returns CREATED
engine/create.js  setProvider        catch -> REFUSED                 <- this one
engine/create.js  adoption path      catch {} swallowed
engine/create.js  createAgentInner   inside step() -> PARTIAL + rollBack
server.js         POST trust route   catch -> trusted:{wrote:false, because}
```

⭐ **The sentence that got the count wrong is the one that exists to say I stopped enumerating
them because every version of that description has been wrong.** I grepped ONE FILE and pronounced
on the repo, inside the sentence about not doing that.

✅ **Fixed by DELETING THE NUMBER, not correcting it.** Corrected to "four" it would be true today
and wrong at the next call site. ⇒ **A NUMBER IS AN ENUMERATION IN MINIATURE** - the same shape as
round 28's "a ranking is an enumeration that survived the deletion of the enumeration". Both hide
as a single word where a list would have been noticed.

**[MAJOR, and right in substance while overstated in form] The `workerDir` assertion's message
named an event it cannot see.** `create.workerDir` consults `agentDirRecorded`, which reads
`store.readProfile(name).dir`; `setProvider` writes only `{ provider }` and `writeProfile` MERGES,
so no `dir` is ever recorded and both sides are the same pure path join. **A real move on disk does
NOT red that line** (the reviewer's probe moved the directory and the assertion still passed); a
move is caught by the `deepEqual`, as a CREATED/DELETED pair.

⚠️ **But it is NOT a tautology, and I said so back with the measurement rather than accepting the
stronger wording.** Mutation asserted applied:

```
store.writeProfile(clean, { provider })  ->  { provider, dir: os.tmpdir() }
APPLIED  ->  fail 1, AssertionError on that exact line
```

⭐ **Why their control returned "not killable" while mine returned "killable": we aimed at
different subjects.** Their probe tested the directory-MOVE reading, which the line genuinely
cannot see; my mutant tested the RECORDED-dir reading, which it can. **Their instrument was right
about the claim they tested, and the line has a different subject** - which is this card's own
signature error, arriving from the reviewer's side this time. The message now names the one
perturbation that reds it.

### Round 29's verification list is the first real independent audit of the PRODUCT code

Worth recording separately from the findings, because twenty-eight rounds had concentrated on my
descriptions and the guards around them. Round 29's brief pointed away from `setProvider`'s header
and at the change itself, and the reviewer audited it properly:

- `agentUnder`'s BFS rewrite: level/`fallback`/`seen` structure walked for cycle safety, duplicate
  `next` entries, and pids missing from `procs`; equivalent to the old FIFO on a tree, with the
  documented claude-wins-same-depth tie rule intact.
- `modelIn`'s widened alternation traced against `--model=x`, `--model x`, `-m x` and the
  near-miss `--model-foo bar` (correctly no match: `-m` cannot start mid-token behind `(?:^|\s)`).
- Every cross-file claim I had made about OTHER files re-verified at the source:
  `agent-supervisor.sh` uses `-m` for codex and `--model` for claude; `win32launch.js` pushes
  `--model` for both; `status.isCodexCommand` is exact-match so it could not have been reused;
  `status.js` clamps the marker to codex-or-claude; the paneless card is its only `runner: null`
  site; `engine/accounts.js` emits no `provider` key.

⭐ **AND THEY CHASED A REGRESSION LEAD AND CLOSED IT, which is the most valuable thing in the
list.** The suspicion: a codex agent whose plist predates the ninth argument would read back
`runner: 'claude'` (the `readJob` floor), flip `foreign` to false, and break the OpenAI overlay
join. **Not reachable, and I verified it myself rather than taking it:** `plistFor` writes
`<string>codex</string>` for every codex job AND writes the model line too (empty when unset) so
the runner can never slide into the model's slot. A codex plist always carries the ninth argument.

📌 **This is the answer to "is the loop finding real defects or just churning my prose?"** Pointed
at the product, a competent adversarial reviewer found nothing in it. Pointed at my prose, six
consecutive rounds found something. **The defect density was never in the change; it was in what I
wrote about the change.**

## Round 30: the first PRODUCT defect in many rounds, and it was my change's blast radius

**[MAJOR] A default-account Codex agent's detail panel said "We cannot tell which account this one
uses" - the exact sentence this branch declares false for that agent class.**

`accountForAgent`'s provider gate is GLOBAL, not whoami-local. The board route resolves every
card's account against `accounts.list()` (Claude rows, which carry no `provider`), so the gate's
`find` looks for an OpenAI row among Claude rows and returns `null`. `paintAccountPicker` reads
`ours = !!acct`, and that `null` lands on the unqualified sentence.

⭐ **I fixed that exact wording on the account-status route and missed this one.** `server.js` says
of it, in as many words: *"which is false: we CAN tell. The job says codex and the absent home IS
the default OpenAI home."* The change's blast radius reached a second user-facing surface and left
the card's own defect there: an absence of evidence rendered as a finding.

⚠️ **NOT a net regression** - before the change the panel handed a codex agent the operator's
CLAUDE account and ARMED the Move control, which is worse. It was an INCOMPLETE fix.

✅ **FIXED rather than deferred**, which was a judgment call. Deferral was defensible on the net
improvement, but the card exists to stop Kosmos saying false things about codex agents, and this
sentence is the ONLY thing that surface says about a whole agent class.
📌 **Inlined `a.runner === 'codex'` rather than calling the existing `providerOf` helper**: that
helper is a `const` declared ~440 lines BELOW this function, so a reference sits in the temporal
dead zone until evaluation reaches it. Every call path today is a runtime event so it would work,
but "works because nothing calls it early" is a reachability argument, and this file already
carries notes about those going stale.

### The browser check, and the three wrong probes it took to write

`docs/browser-checks/render-codex-account-picker-2811.js` (annotates `d-account-msg` for the #2518
surface gate). It PASSES on the fix and FAILS with the exact wrong sentence when the fix is
reverted, with a claude-runner CONTROL proving the branch is reached either way.

🛑 **All three failed probes were MY INSTRUMENT, not the product, and each is recorded in the
check so the next person does not repeat them:**
1. **Both arms in one page load** -> the second call bumps `ACCT_PICKER_EPOCH`, so the FIRST
   agent's continuation aborts rather than painting onto a panel the person has switched away
   from. The guard working exactly as documented.
2. **A settle loop that never settled** -> the branch condition is `!msg.textContent`, and
   `'Checking…'` fails it.
3. **`CURRENT` unset** -> past the awaited fetch, `if (!CURRENT || CURRENT.sessionName !==
   forAgent) return;` fires, so it returns BEFORE clearing the placeholder and the sentence never
   paints.

⭐ **The third one matters beyond this check. The reviewer's finding came from a SLICED function
run standalone, which bypasses that guard entirely.** Their conclusion was right and their path was
not the path the page takes. **A slice proves what the code says; only a render proves what a
person sees** - which is the #1720 gate's whole argument, arriving from the other direction.

### The repo caught me shipping an UNARMED GUARD, in the artifact added to close a gap

The suite reds on the new browser check, three times over, and every one was a registration guard:

| guard | what it caught |
|---|---|
| `tools.browser-checks-wired.test.js` | the check exists and **is never run by the runner** |
| `browser-checks-indexed.test.js` | it is not in the README (then: my prose broke the index) |
| `browser-checks-reason-grep.test.js` | two pinned emit-site counts drifted |

⭐ **This is `a-test-nothing-runs-is-an-unarmed-guard` caught by machinery rather than by me.** I
wrote a check, ran it by hand, saw it pass and fail correctly, and would have committed something
the runner never executes. **"I ran it" and "it runs" are different claims**, and only the second
one survives me.

📌 **Both pinned counts were set BY MEASUREMENT, not prediction**: ran the test, read 100 and 71,
confirmed each new site emits a single-line quotable `FAIL`, then updated the constants with the
reason. That test states why it is an equality rather than a floor: **a matcher that drifted to
zero would examine nothing and pass.**

📌 **The check was hardened on the way**: it had no top-level `.catch`, so an unhandled rejection
would surface as a stack trace the gate cannot quote instead of a quotable failure. That is why
the catch count moved by two rather than one.

⭐ **And the last failure is the whole lesson in miniature.** My README row said
"`server.js`'s account-status route" - and the indexer parses backticked names in that column as
SCRIPT REFERENCES, so prose mentioning another file registered as a missing script. **A
documentation format can be a parser, and prose written into it is input.** The row now names
other files without backticks and says why.

## The blast-radius audit round 30 demanded, done rather than delegated

Round 30's defect was a SHARED HELPER whose new return value reached a surface I had not
considered. That generalises, so I enumerated every consumer of every helper this change alters,
in parallel with round 31's reviewer rather than waiting to be told.

**`accountForAgent` - five call sites, all accounted for:**

| site | surface | status |
|---|---|---|
| `whoamiFor`'s record branch | the whoami answer | the card's own surface, asserted |
| the board route | every agent card -> detail panel | **round 30's defect**, fixed + browser check |
| the account-status route | the connect/auth probe | fixed earlier in the card |
| the observed join, Anthropic arm | account-keyed observation | guarded by `o.provider !== ANTHROPIC`, so a codex agent never arrives; the dir-less match maps to nothing and the filter is kept as defence in depth |
| the observed join, OpenAI arm | the same, openai rows | verified by round 29 |

**Web consumers of an agent's `a.account` - three, all checked:**

| reader | behaviour for a default-codex agent now |
|---|---|
| `paintAccountPicker` | round 30's defect, fixed |
| the OpenAI detail model's `acctDir` | reads `a.account.dir && !isDefault`; a null account yields `''`, the documented default-resolves path |
| `acctParenthetical` -> `runsOnLine` | returns `''`, and the caller guards with `acctEmail ? ' (' + … + ')' : ''`, so the parenthetical is OMITTED rather than rendered empty |

⭐ **That last one is an IMPROVEMENT, and it is the card's own defect disappearing from a surface
nobody had named**: before this change a default-codex agent's runs-on line named the OPERATOR'S
CLAUDE ACCOUNT in its parenthetical. #2811 is titled "reports wrong provider + model and can't
identify the .codex account"; that parenthetical was one of the places it did so.
📌 I checked the CALLER's guard rather than trusting the helper's comment that the caller "omits
the parenthetical entirely" - a helper describing its caller is exactly the kind of claim this
card has found wrong repeatedly. It is right here, and now measured.

**`resolvedRunner` - two consumers**, both the card's own surface: the wire `runner` field and the
`because` sentence (`sentenceForWhoami(account, model, seenLive.resolvedRunner)`), which
deliberately takes the CONFIGURED runner so a paneless, crashed or win32 codex agent is still told
it is a Codex agent. **`runnerOf`** is local to the account-status route.

⇒ **No further blast-radius surfaces exist for this change.** Recorded as a checked set rather than
an assurance: the list above is the instrument, and a new caller of any of those helpers is what
would invalidate it.

## Round 31: round 30's fix does not reach a PANELESS codex card, and I nearly pinned it with a vacuous test

**[MAJOR] The round-30 fix gates on `a.runner === 'codex'`, and a PANELESS card carries
`runner: null`.** `engine/status.js`'s `panelessCard` hardcodes it (its only such site) because
there is no pane to have recorded `@kosmos_runner`. So a default-account codex agent with no pane
- created through the wizard and not yet started - still reached `paintAccountPicker` with
`account: null` AND `runner: null`, and got the sentence round 30 declared false about that class.

⚠️ **Branch-caused, not pre-existing**, by round 30's own argument: before this branch the dir-less
match handed that agent the operator's CLAUDE row, so `account` was truthy and the panel wrote no
message at all. The provider gate is what makes it null.

✅ **FIXED SERVER-SIDE, and the derivation is not new.** The board map now fills an absent runner
from `create.recordedRunner`, which is exactly what the OFFLINE list beside it already does from
the profile, with the reason stated there: *"a stopped agent has no pane to have recorded it, so
the profile's provider is the record"*. A paneless row is the same case. Only when absent: a live
pane's own runner is better evidence and must not be overwritten.

### 🛑 AND I NEARLY SHIPPED A VACUOUS TEST FOR IT, ONE DAY AFTER RECORDING THAT LESSON

I wrote a route-level arm that seeded a codex plist, hit `/api/status`, and asserted the row
carried `runner: 'codex'`. It PASSED. Then the mutant - remove the fallback entirely - **also
passed**.

The probe said why: the seeded agent came back `running: false`, i.e. it landed in the **OFFLINE**
population, which already derived the runner from the profile before my change. **My test was
measuring code I did not write, and would have stood as the pin for code I did.**

⭐ **The test was green, the fixture was real (the product's own `plistFor`), the assertion was
specific, and it proved nothing about the change.** Only `assert the mutation applied` and then
running it caught that. A green test plus a surviving mutant is not a weak signal, it is a
complete refutation of the test.

📌 **I WROTE THAT THE FALLBACK WAS UNPINNED, THEN CLOSED IT, AND THE ROUTE MATTERS.** The first
attempt failed because I seeded plists and hoped the row would be paneless; it deduped into the
offline list. The fix was to stop hoping and drive the product's OWN SEAM: `status.setCreatedSource`
is exactly how production gets these rows (`server.js` wires `createdroster.make()` on non-win32),
and injecting it puts a real `panelessCard` into `snap.agents` - the population the change is in.

✅ **Pinned, with a POPULATION FLOOR that the first version lacked**: the arm asserts
`row.session === null` before asserting anything else, so it cannot silently drift back to
measuring the offline row. Both mutants die by the assertion that names them:

```
MUTANT remove the fallback entirely      -> "a PANELESS codex agent reaches the board with no runner…"
MUTANT return 'codex' without reading    -> "the runner fallback answered codex for a CLAUDE agent…"
```

⭐ **The second mutant is why the control arm exists.** A fallback that answers codex for everyone
would satisfy the first assertion perfectly, and a one-armed test would have shipped it.

### What round 31's fix ALSO closed, found by asking who else reads the field I filled

Round 31 filled `runner` on paneless board rows. I then asked the round-30 question about my own
fix: **who reads `a.runner` on a board row, and is any of them now different?** Three readers, and
two were silently wrong for a paneless codex agent before this:

**1. The provider label (`web/index.html`, the `runner === 'codex'` -> "OpenAI Codex" line).** The
comment directly above it already says the runner is *"the supervisor's option on running panes,
**the profile on stopped ones**"*. **The surrounding code already assumed a recorded runner would
be there; a paneless row was the case where that assumption was false.** Now it holds.

**2. 🛑 THE MODEL PICKER DELEGATION, AND THIS IS A SECOND USER-FACING DEFECT, SQUARELY ON THIS
CARD.** The detail surface delegates with
`if (a && (a.provider === 'openai' || a.runner === 'codex')) { await paintOpenaiDetailModel(...); return; }`.
Measured, from the emitting code: `panelessCard` emits **no `provider` field at all** and
`runner: null`. So for a created-not-yet-started Codex agent both disjuncts were false and it fell
through to the CLAUDE model list - which the comment beside that line names exactly:

> "an OpenAI agent would show Claude Sonnet 5 etc. as switchable options -- the exact 'Claude
> models under an OpenAI agent' bug Josh flagged on the create form (#2167), here on the detail
> surface."

⭐ **#2811 is titled "reports the wrong provider AND THE WRONG MODEL". A Codex agent being offered
Claude models to switch to is the model half, on a surface nobody had connected to this card.**
Round 31's server fix closes it as a side effect, because the guard now sees `runner: 'codex'`.

**3. `providerOf`** (`a.runner === 'codex' ? 'openai' : 'anthropic'`), which feeds the provider
picker: a paneless codex agent now reads `openai` rather than `anthropic`.

📌 **No render needed for (2), and that is a real distinction rather than a shortcut.** The claim
is a boolean over two fields whose absence I measured in the code that EMITS the card, not a
question about what a person sees. Where the question was "what does the panel say" (round 30) only
a render would do; where it is "is this disjunction false", the emitting code settles it.

⇒ **The generalisation, now three rounds deep: when this change alters a value, the next defect is
at its NEXT READER.** Round 30 found the account reader, round 31 the runner's absence, and this is
the runner's other readers. Asking that question of my own fix, unprompted, is what found it.

### And the blast radius of round 31's own fix, closed the same way

Asked of my own change rather than waiting for round 32 to ask it:

**Server side: ~~exactly ONE consumer~~ TWO.** 🛑 **ROUND 33 FALSIFIED THIS AND THE INSTRUMENT IS
WHY IT READ CLEAN.** I grepped for `snap.agents`; the second consumer is
`someAgentNeedsClaude(agents.concat(offline))`, which reads the LOCAL BINDING `agents` and never
mentions `snap.agents`. **The pattern was right about what it matched and wrong about the question
it was asked** - this card's signature error, committed by the very enumeration written to prevent
it. `dependsOnClaude` gates the "cannot reach a Claude subscription" banner (#2128), and the fill
changes its answer (measured: `someAgentNeedsClaude([{runner:null}])` is true,
`([{runner:'codex'}])` is false).

**The card SHAPE is unchanged, and that separation is deliberate.** My `engine/status.js` diff is
COMMENT-ONLY (3 insertions, 1 deletion, all prose): `panelessCard` still emits `runner: null`. The
engine continues to say "this card has no pane-recorded runner", which is true; the ROUTE says
"here is the runner the record knows", which is also true and is what the client needs. So every
engine-level test asserting `panelessCard().runner === null` stays correct, and the green suite is
evidence rather than luck.

📌 The three `runner: null` occurrences in `server.test.js` are unaffected for the same reason: two
construct `{...realCard, runner: null}` to drive `whoamiFor` DIRECTLY (not the route), and the
third asserts the whoami WIRE field, which is live-only by design and is my own assertion.

⇒ **Round 31's fix has one server consumer and four web readers, all four checked.** That is the
whole radius, and it is recorded as an enumeration so a new reader of `a.runner` is what would
invalidate it.

## Round 32: two derivations of one fact, and a fill that could not decline

**[MAJOR 1] My own comment said "ONE definition" while the code had two.** The paneless row used
`create.recordedRunner` (PLIST-first, profile as fallback); its sibling in the same payload
restated `profile.provider === 'openai'` (PROFILE-only). They disagree whenever the records
diverge - and **this branch's own EACCES arm constructs that state**: a completed claude->codex
switch whose best-effort profile write failed leaves plist=codex, profile=anthropic. The same
agent then read `codex` as a paneless row and `claude` once its beat lapsed into the offline list,
with the whole fix inert on the claude side.

✅ Unified on `recordedRunner`, which is also the MORE correct of the two: the plist is the launch
truth, as this file says everywhere else. My comment now states what the code does, and records
that it previously stated an intention.

**[MAJOR 2, and it is the target I flagged to the reviewer myself] The fill could not decline.**
`recordedRunner` FLOORS at 'claude' in both arms, so filling unconditionally answered 'claude' for
an agent this Mac holds no job and no profile for. `panelessCard`'s contract legislates against
exactly that:

> "runner is null because the token store does not record one -- the screen's fallback will read
> that as Anthropic, which is **a display default we inherit and not a claim this card makes**."

⭐ **Round 31 turned an inherited display default into a claim the card makes** - "an absence of
evidence rendered as a finding", which is this card's own thesis, committed by its own fix.

⚠️ **And the population is real.** Paneless rows have TWO sources and round 31 tested one:
`createdSource` is a plist this Mac wrote; `panelessKeys` enumerates the SENDER-TOKEN store, the
beat-known remote/win32 case that contract paragraph is written about. **For a remote CODEX agent
an unconditional 'claude' hands it the Claude model list - the #2167 shape, restored one
population over.**

✅ The gate asks whether a record EXISTS before asking what it says, so `recordedRunner` stays the
one derivation and null stays available. Pinned by an arm whose fixture control asserts the
absence (no job, no plist) rather than assuming it; the mutant removing the gate reds that arm
ALONE, leaving the other two green, which shows the three guard independent cases.

📌 **A RESIDUAL I AM NOT CLAIMING TO HAVE FIXED.** The reviewer also named a name-collision arm:
the value is keyed on `store.safeKey(sessionName)`, so a LOCAL agent and a beat-known REMOTE agent
sharing a safeKey make the remote card take the local agent's provider. My gate does not close
that - it fills precisely when a local record exists, which is the collision case. It is a
pre-existing ambiguity in the safeKey namespace that this change makes reachable for one more
field, and it is recorded rather than quietly inherited.

### Why only ONE of the two rows is gated, checked before being asked

Round 32 gated the PANELESS fill (return null when this Mac holds no record) and left the OFFLINE
row ungated. That reads as the exact inconsistency round 32 had just fixed, so I traced it rather
than waiting to be asked:

```
offline rows  <- register.survey() -> known() -> fs.readdirSync(store.PROFILES)
paneless rows <- panelessKeys      -> the SENDER-TOKEN store (beat-known, possibly remote)
```

⇒ **An offline row exists BECAUSE a profile file does.** The record is present by construction, so
there is nothing for a gate to decline, and `recordedRunner`'s floor is correct there: a profile
that records no provider IS claude, which is the documented "absent means claude, as everywhere".
A paneless row carries no such guarantee.

**Same derivation, different population guarantee, so only one needs the gate.** Written into the
code beside the gate, because the next reader sees two sibling expressions and one guard, and the
absence of a reason is what makes that look like a bug.


## Round 33: two of my own claims falsified, and the more useful one is about a harm I invented

**[MAJOR 1] My reader enumeration was incomplete, and the instrument is the story.** See the
correction stamped on that section above: `someAgentNeedsClaude` reads the local binding `agents`,
so a grep keyed on `snap.agents` could not see it. ⭐ **An enumeration is only as wide as the token
you searched for, and I chose the token from the code I had just written rather than from the
question.**

**[MAJOR 2, and it corrects my REASONING rather than my code] I justified the round-32 gate with a
harm the fill did not introduce.** I wrote that an unconditional fill "hands a remote codex agent
the Claude model list -- the #2167 shape restored one population over". Measured false, by render:

```
runner=null   -> "We cannot tell which account this one uses…"      providerOf: anthropic
runner=claude -> "We cannot tell which account this one uses…"      providerOf: anthropic
runner=codex  -> "This is a Codex agent, so it does not run on…"    providerOf: openai
null === claude ?  true
```

All four web readers of `a.runner` are `=== 'codex'` EQUALITY tests, so `null` and `'claude'` are
indistinguishable at every one; `someAgentNeedsClaude` counts an unknown runner (`''` / `'claude'`)
the same as null. **That agent rendered identically before the fill existed.** The third arm
(`codex`) is what makes the identity a measurement rather than a dead probe.

✅ **The gate STAYS, on the ground that survives measurement**, and the code now says so: it is a
WIRE-CONTRACT fix, not a behaviour fix. `panelessCard` legislates that null is "a display default
we inherit and not a claim this card makes", and a payload should not assert what this Mac cannot
know even where no reader currently reads the difference.

⭐ **A FIX JUSTIFIED BY A HARM THAT DOES NOT EXIST IS THE THING THIS CARD KEEPS CATCHING, AND I
PRODUCED ONE WHILE FIXING ONE.** The remedy is not to drop the fix but to state the reason that is
true. I removed the claim rather than softening it: softening would have left a smaller version of
the same invented harm.

### Round 33's third finding: I traced ONE source and pronounced on the population, for the third time

The justification I wrote THIS ROUND for not gating the offline row - "an offline row EXISTS
BECAUSE a profile file does, so the record is present by construction" - is measurably false:

```
register.survey()  = known()  (profile-backed, profile: true)
                   + strays() (pushed second,  profile: false)
the offline filter = (k.folder || k.job)        <- never mentions a profile
```

A folder-only stray reaches that list with no job and no profile and floored to a positive
`'claude'`, **under a comment asserting the case cannot arise**. I read `known()` and stopped.

⭐ **THAT IS THE SAME ERROR AS MAJOR 1 AN HOUR EARLIER (a grep keyed on `snap.agents` that could
not see a consumer reading `agents`) AND AS THE trustCodexFolder CALL SITES IN ROUND 26.** Three
instances, one shape: **trace one source, pronounce on the population.** Writing the rule down has
not stopped me producing it; what stops it is removing the thing that needs justifying.

✅ **So both rows now share ONE GATED HELPER.** There is no longer an asymmetry to explain
correctly or otherwise. The mutant restoring the ungated derivation reds TWO arms - the
disagreement arm and the new stray arm - each by its own message.

📌 **The stray arm reproduces the reviewer's own fixture discipline**: their first probe returned
`SURVEY ROW: undefined` until they added the birth-log tie, which is what proves the sweep was
REACHED rather than vacuously empty. A folder alone is not a stray (the tie exists so a checkout
dropped under a once-used name does not become one), so the arm writes both halves and asserts the
controls - no job, no profile provider, and `recordedRunner` still flooring at claude - BEFORE the
claim.

### And the exhaustive answer to "does any consumer distinguish null from 'claude'?"

Asked of the reviewer because it is a stronger statement than the finding, and worth recording
rather than assuming. **Six readers, and NONE distinguishes them:**

| reader | test |
|---|---|
| web "OpenAI Codex" model label | `a.runner === 'codex'` |
| web `paintOpenaiDetailModel` delegation | `a.provider === 'openai' \|\| a.runner === 'codex'` |
| web `paintAccountPicker` sentence | `a.runner === 'codex'` (rendered) |
| web `providerOf` | `a.runner === 'codex' ? …` (rendered) |
| server `someAgentNeedsClaude` | `a.runner !== 'codex'` (measured) |
| `tools/capture-agent-card.js` | `card.runner === 'codex'` |

⇒ **The gate changes no behaviour anywhere today.** It is kept because `panelessCard` legislates
that null is "a display default we inherit and not a claim this card makes", and a payload should
not assert what this Mac cannot know. **That is the whole reason, and it is the one that survives
measurement.**
