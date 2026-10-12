# openerenv-5889: the company sign-in opener gets a desktop allowlist, not the board's whole environment (kosmos#5889)

## What
- engine/childenv.js (new): openerEnv(env) keeps only the desktop list (#5881's, copied from its branch, where it is
  inline in projects.js and not yet on main); hasDesktop(env).
- engine/remote.js runCompanyOpener: on macOS and Linux the child gets openerEnv; on Linux with no display it is not
  started (the answer is "use the link" at once). Windows keeps inheriting: rundll32 needs Windows' own variables
  (SystemRoot and others) and a list for it is not checked on a Windows machine here.
- Test seam setCompanyOpenSourceForTests ({ platform, env }), excused in engine.reachable.test.js like its sibling.

## Decided, not missed
- Not stacked on #5881 (April's branch, in review): projects.js is left alone; once #5881 lands, a short follow-up
  points it at childenv.js. Said on #5889.
- Windows unchanged (above). Weakest premise: that macOS `open` needs nothing outside the list (it hands the URL to
  LaunchServices; measured only through a node child here, not a real browser launch).

## Tests
engine/remote.test.js: a real child (node) writes the env it got: on darwin and linux the listed variables arrive and two
tokens do not; linux with no display starts nothing; win32 still inherits. The existing opener test now sets a display
through the seam, so it keeps testing exit codes on a Linux runner. remote.test.js 215/215.

## Next
Mutants (env omitted; display check removed), then blind review, the four guards, Mortals, proof, PR.

## Mutants (22:05 CDT, engine/remote.test.js, control 215/215)
- env omitted (`const env = undefined`, the child inherits everything): red, 214 pass 1 fail.
- the Linux display check removed: red, 214 pass 1 fail.
File restored by a trap and compared with cmp after each run.

## Review 1 (sonnet, blind, on 2dd89e63b): NOT CONVERGED
- FIXED (WARNING): the list missed what xdg-open and a browser it starts read: BROWSER, XDG_DATA_HOME, XDG_CACHE_HOME,
  XDG_STATE_HOME, LANGUAGE, every LC_ variable (by prefix), USER, LOGNAME, TMPDIR, GDK_BACKEND, QT_QPA_PLATFORM,
  MOZ_ENABLE_WAYLAND, WSL_DISTRO_NAME, WSL_INTEROP and the proxy variables. Added. Decided: the proxies are kept; they
  are the person's own network settings and a browser without them may not reach the page. Weakest premise: a proxy URL
  can carry a user and password. Not added: SHELL (nothing in an opener reads it), GTK_*/QT_* beyond the one backend
  hint (theme variables, not needed to show a page).
- FIXED (WARNING): "no display" sent WSL and a named BROWSER straight to "use the link". hasDesktop now also counts
  BROWSER and WSL_DISTRO_NAME. Tests: each starts the opener on Linux with no display.
- FIXED (WARNING): the leak test's secrets lived only in the injected env, so a child spawned with process.env passed
  the negative checks. The secrets now sit in the real process.env and the source is a copy of it, so only the filter
  keeps them out. Mutant "filter passes everything" (positives unchanged): red.
- FIXED (WARNING): vouchSignedIn (and so every vouch test after it) now names a display through the seam, so a Linux
  machine with none still opens. Reasoned only: this Mac always has the darwin path, so the Linux arm is not run here.
- FIXED (NIT): the end-of-test reset sets the source seam to null again. FIXED (NIT): childenv required at the top.
- Windows: unchanged, as decided above.
- Mutants after the fixes (control 215/215), each red with 214 pass 1 fail: env omitted; display check removed; filter
  passes everything; hasDesktop display only; LC_ prefix dropped.
