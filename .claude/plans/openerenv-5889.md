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
