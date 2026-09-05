# win-runnable-2270: on win32 a runner is runnable by its extension, not X_OK

## The bug (found on the Windows box, #570 Gap-B arm)

`engine/runners.js` `runnableExactly` decided "is this a usable runner" with
`fs.accessSync(p, X_OK)`. On Windows that access mode is a no-op (behaves like
F_OK), and `chmod` there only toggles the read-only bit - so BOTH halves of the
POSIX check are inert, and any file that merely exists reads as runnable. A
plain extensionless `claude` sitting where the resolver looks then reports a
runner present that cannot be launched: #1592 ("reports missing with no
diagnostic") with the sign flipped. Runner resolution is load-bearing for the
Windows port (it is how `claude.exe` is found), so this wants closing before the
platform.js SUPPORTED flip.

## The fix

On Windows executability is the EXTENSION - the loader launches a file only if
its suffix is in PATHEXT - which is why `pathextCandidates` (#2183) exists.
`runnableExactly` now branches:
- win32 -> `hasExecutableExt(p, env)`: the path's extension (path.win32.extname,
  so it parses on the POSIX CI host too) is in PATHEXT (default
  `.COM;.EXE;.BAT;.CMD`), case-insensitive.
- POSIX -> `fs.accessSync(p, X_OK)`, unchanged (the right question there).

`platform`/`env` are injectable (default the host's), the same seam
`pathextCandidates` carries, so the win32 branch is testable from the Mac CI runs
on. They are deliberately NOT added to `isRunnable`, which is used as an Array
callback (element, index, array) and must stay single-argument; isRunnable calls
`runnableExactly(candidate)` with the host platform, correct on the machine it
runs on. `runnableExactly` is now exported for the test.

## Verification

`engine/runners.win-runnable-2270.test.js`: the discriminating cases that
isolate the changed branch on a POSIX host - a 0o755 extensionless file
(X_OK-true, ext-false: win32 -> false, darwin -> true) and a 0o644 .exe
(X_OK-false, ext-true: win32 -> true, darwin -> false) - plus PATHEXT injection
(a .BAT-only PATHEXT accepts .bat, rejects .exe), case-insensitivity, and
directory/missing rejection. Red-capable: reverting the win32 branch to X_OK
flips both win32 assertions.

Also turns green the pre-existing red on the Windows box ("isRunnable accepted a
non-executable file", a `plain` no-ext file). The #1592 weak-call set sweep still
passes (the POSIX accessSync line is unchanged; no new comment matches the
weak-call shape). 60 runner/runnable tests green. The full node suite runs on
CI (the local box was reserved for a release cut).

## Not in scope

The platform.js SUPPORTED flip (#570) and other Windows-hostile assumptions
(#1592, #2183) - this closes the runner-resolution one.
