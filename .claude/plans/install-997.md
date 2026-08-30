# install-997: extract the Claude Code install out of runFlow

## The problem

`runFlow` in `engine/connect.js` did two jobs in one function: it installed
Claude Code, and it drove the sign-in. The install half is the piece a Windows
runner and a non-Claude runner both have to reimplement, and it could not be
reached without also driving a sign-in.

## What this does

Lifts the install sequence into `installClaudeCode(hooks)`, which returns a
result rather than reaching for module state. Behaviour-neutral by intent.

The five concerns it used to touch directly are injected:

| hook | was |
|---|---|
| `cancelled()` | `driver !== owner` |
| `maySweepDownloads()` | `driver === owner \|\| driver === null` |
| `wantsProgress()` | `mem.phase === PHASE.DOWNLOADING` |
| `onPhase()` | a `writeState` call |
| `onProgress()` | a `writeState` call, throttle moved to the caller |

`maySweepDownloads` is deliberately NOT the negation of `cancelled`. The
`driver === null` arm is load-bearing for #458 and collapsing the two
reintroduces that bug.

## The decision that cost the most

**Cancelled is not failed.** The original expressed cancellation as two bare
`return`s inside `runFlow`. Extracting the sequence turns those into a result
the caller has to read, and the first pass silently dropped both, so a cancelled
flow carried on installing. They are now `{ ok: false, cancelled: true, message }`
and the caller checks `cancelled` before `ok`. The message is present so that a
future caller who ignores the flag still cannot render `undefined` as a stuck
reason.

## Deliberately not done

- No behaviour change to the install sequence itself. This is enabling work for
  a Windows runner, not the Windows runner.
- No change to `launchSignin`, which stays in `runFlow`.

## Verification

- full suite on `origin/main`: 3051 pass, 0 fail
- full suite on the branch: 3067 pass, 0 fail (the branch ADDS tests, so the
  two figures cannot match; an earlier version of this line reported the main
  number for both, which is arithmetically impossible for a change that adds
  a test file)
- `engine/connect.install-997.test.js`: direct contract tests for the three
  return shapes, the hook guard, and the #458 predicate distinction, each arm
  perturbed and confirmed to go red independently
- coverage is not vacuous: planting a throw in `installClaudeCode` turns
  existing tests red, so they do reach it

## Known open item

An earlier suite run on this branch showed 3 failures that did not reproduce
under higher load and are green in isolation. Carded separately as kosmos#1551
with four dead candidate mechanisms. Not caused by this change: more load made
it cleaner, which falsifies "the diff broke it".
