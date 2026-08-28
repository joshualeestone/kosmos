# adoptbin-1359: the adopt test could not tell a codex job from a claude job

**Test-only change. No product code.** The adopted-OpenAI path was verified end to end by
PigeonPete this morning and is correct; this makes the tests able to notice if it stops being
correct.

## Defect 1: both assertions were satisfied by the same string

```js
const p = plistOf('scoutcodex');
assert.match(p, /<string>codex<\/string>/, 'the adopted agent was written as a Claude job');
assert.match(p, /codex<\/string>/,          'the job does not point at the codex binary');
```

`create.js` writes the runner LABEL as its own plist argument:

```js
const runnerLine = isCodex ? `\n    <string>codex</string>` : '';
```

So `<string>codex</string>` is present for **any** codex agent, whatever binary the job points
at. The first assertion matches that. **So does the second**, whose regex `codex<\/string>` has
no leading `<string>` and is therefore satisfied by the label just as well as by a real path.

⇒ **A plist that runs the CLAUDE binary while labelled `codex` passed both** - precisely the
"an adopted Codex agent starts Claude in its own folder" defect adoption exists to prevent. And
the assertion whose message reads *"the job does not point at the codex binary"* was the one
that could not check it.

**Fix:** read argument 4 by POSITION through `create.readJob`, and split the two facts into two
assertions. (`readJob` calls that field `claude`; it is the runner-binary slot whatever runner
holds it, named before runners existed.)

**Proved by mutation.** Swapping `plistFor(clean, runnerBin, ...)` to `claudeBin` in
`installJob`:

```
before this change   full suite GREEN            <- the defect was invisible
after  this change   2 failures, both naming the wrong binary:
   "the job does not point at the codex binary, it points at .../bin/claude"
   "on a machine with no Claude the job points at .../bin/no-claude-here"
```

⭐ The second message is the sharper one: on the machine Josh's 2x2 cell describes, the job
would point at a Claude that is not installed.

## Defect 2: the file needed the operator's real codex to pass

Six variables were sandboxed and `AGENT_WORKFORCE_CODEX_BIN` was not, so `resolveBin('openai')`
fell through to the vendor path and found this Mac's Homebrew codex. Measured before the fix:
with the seam pointed at nothing, **4 of 9 tests failed**; unset, all 9 passed. **Every green
was partly a statement about this machine**, and a runner without codex would have failed.

**Fix:** sandbox the seam and ship a `codex` stub beside the existing `claude` one.

## And a guard, because a sandbox that is not checked is a belief

The file already refuses to run if `create.plistPath` resolves outside the sandbox. That proves
the plist LANDS in the sandbox; it says nothing about what the plist POINTS AT. Added the
matching refusal for both runner binaries.

**Negative control, run:** removing the codex seam makes it fire with the real path -
`the codex binary resolves to /opt/homebrew/bin/codex, outside the sandbox`. So the guard can
return the dangerous answer, and it also demonstrates the file really was using that binary.

### ⚠️ The guard's first version was wrong, and failing closed is how I found out

I wrote `resolveBin('codex')`. **`resolveBin` keys on the PROVIDER name and returns
`{bin: null}` for anything it does not recognise**, so it answered null on a correctly
configured machine and the guard refused to run. The product calls `resolveBin('openai')`
(`create.js:1285`), and the guard now matches it.

⭐ Worth recording rather than quietly fixing: **the guard failed CLOSED.** A guard built the
same way but defaulting to "looks fine" would have passed, proved nothing, and left me
believing the file was sandboxed.

## Deliberately not done

- **Not touching `installJob`.** The mutation used above is a coverage probe, not a defect: the
  shipped line is already `runnerBin`. I filed a card this morning claiming otherwise, having
  read a working tree another agent was mid-mutation on, and closed it. The code is correct.
- **Not renaming `readJob`'s `claude` field** to something runner-neutral. It is right that it
  is confusing, and it is a product change with callers, so it does not belong in a test-only
  PR fixing a different thing.


## Round 2: three claims of mine that were wrong, and a control that controlled nothing

**1. The guard's remediation advice named the wrong cause.** It said *"Set
`AGENT_WORKFORCE_CODEX_BIN` before the first require of `engine/runners.js`"* - wording I
copied from the `plistPath` guard twenty lines above, where it is correct because `create.js`
resolves `AGENTS_DIR` ONCE at module load. **`resolveBin` reads `process.env` at CALL time**,
measured: requiring `./runners` first and setting the variable afterwards is still honoured.
⇒ Anyone tripping my guard was sent hunting a require-ordering fault that cannot happen here.
Now: *"Set it above this guard."*

**2. "Exercise the real binary" overstated it.** Nothing in the adoption path RUNS the runner -
`installJob` uses it for `unusablePath`, `fs.existsSync` and `plistFor`, and the exec seam is
stubbed in `beforeEach`. The job **pointed at** the operator's Homebrew codex; it never invoked
it. The load-bearing half (4 of 9 failing with the seam pointed at nothing) reproduced exactly.

**3. 🛑 THE NAMED CONTROL DID NOT CONTROL MY NEW ASSERTION, AND ITS COMMENT SAID IT DID.**
`#1159 CONTROL: a Claude agent is still adopted as Claude` says it stops *"a change that makes
EVERYTHING a codex job"*. True of the LABEL assertion it was written for. **Not true of the
BINARY assertion I added**, which had no negative arm at all: nothing in the file asserted that
a Claude agent's job points at the CLAUDE binary.

Measured - `installJob` mutated so every job takes the codex binary:

```
before  the control passed GREEN on a mutant pointing every job at codex
        (caught elsewhere by accident: with runnerBin never claudeBin, the
         missing-Claude refusal stops firing)
after   2 failures, one of them "a Claude agent's job does not point at the
        claude binary"                                     <- caught on purpose
```

⭐ **Incidental capture is not coverage.** The mutation was detected before this change, by a
test aimed at something else, for an unrelated reason. That is luck with a green tick on it,
and it would have evaporated the moment the unrelated test changed.

**4. A suffix match, replaced by the exact path.** `/\/codex$/` is satisfied by ANY file named
`codex` anywhere - including `/opt/homebrew/bin/codex`, the exact value this file used to depend
on. It was machine-independent only by borrowing strength from a guard fifty lines away.
`assert.equal(job.claude, path.join(SANDBOX, 'bin', 'codex'))` means something on its own.

**5. Corrected a pre-existing false claim I was building on.** The file's header says a
multi-file `node --test` run shares a process. On node v25.6.1 it does not: `--test-isolation=process`
is the default, measured with a two-file env probe. The recorded pollution incident really
happened; it cannot recur by that mechanism on this node. The guard stays - it costs nothing and
older node still shares.

**Full suite 2780 pass 0 fail exit 0.**


## Round 3: my guard was the shape main had removed that morning, and I was 16 commits behind

**The green suite was a pass against a base that no longer existed.** The branch was 16 behind
`origin/main` and conflicted in the one file it edits. ⭐ Second time today that a review caught
me measuring against a stale base; the first was `titlename-1168`, four behind.

### The conflict was the finding

`origin/main` `b725abdf` (#1365, landed 12:27 the same day) had **replaced the sibling sandbox
guard with a COLLECTING one**, for this stated reason:

> a guard that stops at the first bad root cannot be tested per root: my own control could not
> tell whether the LAUNCH check still worked, because the DATA check answered first.

**My branch added a second guard, twenty lines below it, that short-circuits.** Measured with
both seams removed: it named codex only and claude was invisible.

✅ **Resolved by folding the two runner binaries into main's collecting list rather than keeping
a second guard.** The conflict and the finding had the same fix. Verified: with three seams
removed the guard now names BOTH failing binaries.

### And the claude row is a weaker control than the codex row

Measured, restoring between arms:

```
remove AGENT_WORKFORCE_CODEX_BIN    -> guard FIRES, names /opt/homebrew/bin/codex
remove AGENT_WORKFORCE_CLAUDE_BIN   -> guard does NOT fire; 3 tests fail elsewhere
remove CLAUDE_BIN and HOME together -> guard fires, names ~/.local/bin/claude
```

`resolveBin('claude')` falls back to `homeDir()/.local/bin/claude`, and `homeDir()` already
honours `AGENT_WORKFORCE_HOME`, which is pointed inside the sandbox above. **So the claude row
passes for a reason unrelated to its own variable.** Kept - it still catches what it is named
for - but the comment now says which of the two rows is proof and which is not, because a
control that passes for the wrong reason is the thing this file keeps being caught by.

### A comment of mine that another comment in the same commit refuted

I wrote that `resolveBin('codex')` "fell through the env override to the vendor path". **It
cannot**: `runners.js` returns `{bin: null}` for any provider that is not `claude` or `openai`.
The call that found the Homebrew codex is `resolveBin('openai')` - **and my own guard comment
eighty-five lines below says so at length.** One file, two comments, one of them impossible.

**Full suite on the rebased base: 2806 pass, 0 fail, exit 0.**
