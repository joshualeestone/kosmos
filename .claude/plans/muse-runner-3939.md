# muse-runner-3939: Meta's Muse Code as a Kosmos runner, slice 1 (Mac): find it, read its version

Card #3939 (Josh's spec, 2026-09-26; research complete: Homer's Windows captures, Angel's Mac findings on the Mortals Mac). Splinter, 23:00: start the Mac runner in small slices, the runner and detect-installed first, no UI.

## What finished looks like (this slice)
- runners.resolveBin('muse') finds Meta's launcher at ~/.local/bin/muse under the sandboxable home (AGENT_WORKFORCE_HOME), honours AGENT_WORKFORCE_MUSE_BIN (first, on any platform, like every runner), and otherwise on anything but a Mac says it is not wired up yet.
- engine/musestatus.js: installed() (a file check) and version() (`muse --version` through the live-execution gate, with a timeout; only Muse Code's own line counts as a version; never rejects).
- Nothing lists it yet: 'muse' is not in MANIFEST, so runners.status() and every screen that reads it are unchanged. No sign-in, no session, no writes.

## Decisions
- Never override HOME for Muse on a Mac (measured: `muse exec` writes a register to the real ~/Library/Application Support/Muse whatever HOME says). This slice only reads a file and runs --version, which wrote nothing when measured.
- Windows is its own slice: its install location differs (Homer's captures), so the Mac branch does not guess it.

## Next slices (not this one)
- 2: the runtime adapter: `muse exec --json --workspace <real path> --session-id <uuid>` per turn, the JSONL events (run.output.delta, run.terminal.completed), resume on the same session and workspace, paths resolved (Muse refuses a path through a symlink).
- 3: sign-in state (`muse login` / META_API_KEY), then the provider row in Settings, only once a signed-in run has been measured (needs Josh to approve one device code).

## Review round 1 (decided)
- version() is bounded: the child is stopped with SIGKILL (a launcher that ignores TERM kept it waiting 25 s, measured), its output is capped, and a hard-cap timer answers unknown if no callback ever comes (late callbacks ignored), as engine/agystatus.js does.
- Only the WHOLE trimmed output may be Muse Code's version line (no line picked out of a banner).
- The unknown and not-installed sentences are named constants.
- Round 2: installed() runs inside the try, so version() resolves even if finding muse throws (tested). The CLAUDE.md Where to Find Things row waits for the slice that wires the provider in.
- Round 3: the version match is anchored at the end too (tested); the SIGKILL is proven on a real child that ignores TERM (a TERM kill fails the test at its timeout); a failed install check reads installed: null with its own sentence; VERSION_ARGS named once; the not-installed reason is derived in installed(); the override-first rule stated in the comment and plan.
