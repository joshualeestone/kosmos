# codexsand-1500: the Codex walk went around the sandbox refusal

## Measured before

A fully sandboxed `discover.found()` (`AGENT_WORKFORCE_CONFIG_ROOT` and
`AGENT_WORKFORCE_DATA` both in a temp dir, five fixture folders):

```
agents:      Renet Probe   <- another agent's scratchpad, on this real machine
             Testy McFixture
unreadable:  8             <- this Mac's number, not the fixture's
```

## Measured after

```
agents:      Testy McFixture
unreadable:  1
skipped:     {noTranscript:1, noWorkingFolder:1, noInstructions:1}
```

Every number is now the fixture's.

## Why it happened

`status.configRoots` refuses to read the operator's machine when a process has
declared itself a fixture. `foundCodex` reaches `~/.codex` through
`codexupdate.defaultHome()` and **never calls `configRoots`**, so the refusal
could not fire for it.

⭐ **The refusal's own comment predicted this.** It says it exists *"for every
harness anyone writes next, including the one that does not exist yet and will
forget"*. **The harness that forgot is in this repo**, and it forgot because the
guard was reachable from exactly one function.

## The change

`sandboxIsInconsistent()` extracted from `configRoots` and exported. `foundCodex`
refuses **before** the read, not after: a walk that opens the operator's rollouts
and then discards them has still opened them.

⚠️ **Scope, stated rather than implied:** this covers `found()`, which is where
the defect was reported. A caller reaching `codexsession` **directly** is still
unsandboxed. Today `discover.js` is the only such caller outside the module
itself, **checked rather than assumed**.

## Perturbed, five arms

```
the Codex walk stops honouring it   -> the walk test, red
the guard runs AFTER the read       -> the walk test, red
the predicate always says yes       -> the consistent-sandbox control, red
the predicate always says no        -> the leak test, red
it is no longer exported            -> the leak test, red
```

## ⭐ A control failed and the code was right

My "consistent sandbox" control set `AGENT_WORKFORCE_HOME` and went red.
**`status.js`'s `homeDir()` is a bare `os.homedir()`** and does not read that
variable, unlike `accounts.js`, `runningas.js` and four others which do.

⇒ **The only way to sandbox this module's idea of home is `HOME` itself.** The
failing control is what told me; **the code was right and my premise was not**,
and I would have shipped a control that could never have passed.

## The suite was green throughout, and still is

**This was never a failing test.** It was every discover assertion quietly
reading whoever ran it. 2980 pass, 0 fail.
