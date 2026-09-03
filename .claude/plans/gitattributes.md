# Add .gitattributes to pin line endings (LF) for Windows safety

**Branch:** `gitattributes` · **Source:** fleet-hygiene finding from windows-orchestrator,
routed via Splinter 2026-09-03. Not a numbered card. Angel (the usual owner) is stood down at
97% weekly, so this is routed to Mona Lisa to land; Splinter is observer PM and does not deploy
to Kosmos.

## The defect

The repo has **no `.gitattributes`**, so line endings are protected only by each contributor's
local git config. A Windows clone with stock Git-for-Windows settings (`core.autocrlf=true`)
would convert the whole tree to CRLF on its first commit and corrupt it. Latent, not a live
break: no Windows contributor has committed with stock settings yet (the one who found it
hand-configured his box to dodge it).

## The fix

A two-line `.gitattributes` that converts the per-machine convention into a repo-enforced
guarantee:

```
* text=auto eol=lf
*.sh text eol=lf
```

`text=auto` normalises text files to LF and auto-detects binaries (leaving them untouched);
the explicit `*.sh text eol=lf` states the intent for shell scripts, which must be LF to run.

## Verified safe BEFORE adding (the part that makes this a no-op for existing files)

- `git ls-files --eol`: **1558 text files, all LF; 0 CRLF; 0 mixed.** So `eol=lf` matches what
  is already committed and renormalises nothing.
- **No CRLF-mandatory files** in the tree (`.bat`, `.cmd`, `.sln`, `.ps1`, `.vcxproj`, `.rc`),
  so a blanket `eol=lf` needs no per-type CRLF exception.
- The ~50 binary files read as `w/-text`; `text=auto` auto-detects them and does not touch them.
- After committing the attribute, `git add --renormalize .` staged **0 files**, proving the
  change rewrites no existing content.

## What would change my mind

If the repo later adds committed `.bat`/`.cmd` files (which need CRLF to run on Windows), this
file must gain `*.bat text eol=crlf` / `*.cmd text eol=crlf`. There are none today; a future
Windows contributor adding one should add the exception in the same change.

## Scope

One new file. No code touched, no behaviour changed. The renormalize probe is the acceptance
test: adding the attribute must stage zero existing files.
