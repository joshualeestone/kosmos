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
