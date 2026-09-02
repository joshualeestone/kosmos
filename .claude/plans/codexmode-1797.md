# codexmode-1797: pass the mode on the codex-config temp write

## The defect (kosmos#1797)

`engine/create.js` `forgetCodexFolder` rewrites `~/.codex/config.toml` (removing an agent's
codex trust entry) by writing a pid-named temp and renaming it over the target. The temp write
was `fs.writeFileSync(tmp, next)` with **no mode**, so the temp was created at the umask default
(0644) and the `chmodSync(tmp, mode)` a line later closed that window. For the moment between
the two calls the whole config -- trust entries, sitting beside `auth.json` -- was
world-readable at a known (pid-named) path. Same create-time-mode class as #1761/#1776/#1784.

The #1414 fix already ensures the END mode is preserved (the rename carries the temp's mode);
this closes the transient window that fix left open.

## The fix

`fs.writeFileSync(tmp, next, { mode })`. The temp is a fresh file each call, so the create-time
mode lands it private with no window. The existing `chmodSync(tmp, mode)` stays as
belt-and-suspenders and as the re-assert on the rare path where the create mode is a no-op (an
NFS/FUSE mount), the same reasoning as securewrite's `fchmod`. Plain `writeFileSync` (not
`{ flag: 'wx', mode }`) is kept so the current overwrite-a-stale-temp behaviour is unchanged.

## Why not securewrite.js (the #1787 writer)

Decision recorded on #1797 (Splinter raised the question). `writeSecret` takes a mode and its
atomic path also replaces a symlinked target via rename, so the mechanics largely fit -- but it
refuses a symlinked target file on the stated premise that "nothing legitimately symlinks a
secret file". That premise is true for Kosmos-owned credential stores and **false for the
user's own `config.toml`**, which a dotfiles setup legitimately symlinks and whose mode the user
sets (the code preserves `statSync(cfg).mode`, not a forced 0600). config.toml sits outside
securewrite's contract by that contract's own reasoning, so the minimal create-time-mode fix is
correct here and securewrite is reserved for Kosmos-owned files.

## Test

The end-state mode is already guarded by #1414 and cannot see the window. The #1797 arm isolates
the create from the chmod: it neutralizes `fs.chmodSync` (a no-op, as on a mount where chmod
does nothing) and pins `process.umask(0o022)` (the window only exists under a permissive umask,
so pinning makes the discrimination deterministic on any runner), then asserts the config comes
out 0600 -- which is only possible if the create carried the mode. An embedded control writes a
plain unmoded file in the same harness and asserts it lands 0644, so the assertion is not
vacuous. Proven: reverting `{ mode }` reddens the arm by name; `create.test.js` 144 pass, 0 fail.
