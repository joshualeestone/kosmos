# winroot-570: where a person's data lives on Windows

## Josh's v1, his words

> *"visit installkosmos.com and click Download for Windows... run locally, launch
> and install Kosmos, and access their agents just like they can on the Mac."*

**This is step zero of that, and it is the one that gets more expensive every day
it ships.**

## The defect does not crash, which is why it needed finding

`engine/store.js:35`

```js
path.join(os.homedir(), 'Library', 'Application Support', APP)
```

On Windows this **happily creates** `C:\Users\x\Library\Application Support\AgentWorkforce`.

⇒ **Nothing throws. Nothing warns.** The person's agents, profiles and avatars
just live somewhere Windows does not consider application data: not roaming, not
where an uninstaller looks, not anywhere they would think to look.

⚠️ **And once one Windows install exists, fixing this is a data migration on a
machine we cannot see.** That is the whole argument for doing it now.

## The change

`dataRootFor(platform, home, env)`, a **pure function of the three things that
decide it**, and `ROOT` is built from it.

```
win32     APPDATA (roaming), falling back to ~/AppData/Roaming
darwin    unchanged
linux     KNOWINGLY unhandled, falls through to the Mac path exactly as before
```

**Roaming rather than Local**: this is a person's own configuration and should
follow them to another machine on a domain.

## 🔑 Why it is a pure function rather than a module reading `process.platform`

**`process.platform` cannot be set, so a module that reads it directly is a
module whose Windows behaviour cannot be asserted from a Mac.** Unassertable is
exactly how this defect survived. Now a test on this machine can ask what Windows
gets.

## The test asserts COMPONENTS, not a string

`path.join` emits `/` here and `\` there. **A test pinning the exact string would
pass on the Mac and fail on the one platform it is about**, which is the same
shape of untestable all over again.

## Scope

**One file plus its test.** Nothing else in the engine hardcodes a Mac data path:
swept `engine/`, `server.js`, `bin/`, `install/` for `Library/Application
Support` and the only other hits are `install/setup.sh` (the Mac installer,
correct) and a comment in `engine/sandbox.js`.

The other home-relative paths (`~/.claude`, `~/.codex`, `~/work/workers`) are the
same on Windows, because those are Claude Code's and Codex's own conventions.

## Controls

- **The Mac arm must not move**, asserted.
- **The sandbox override must still win on every platform.** 17 files honour
  `AGENT_WORKFORCE_DATA`; if the platform branch could beat it, every fixture on
  a Windows machine would write to the real store.
- **`ROOT` is built by the same function**, asserted. Without that, `dataRootFor`
  could be a correct function nothing calls, **which is a defect I shipped twice
  this week.**

Suite 2975 pass, 0 fail.

## NOT done

**Nobody has run this on Windows.** It is a claim about what the code computes for
`win32`, not a claim about a machine.
