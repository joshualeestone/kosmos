# cx5054leak: the #5054 test cleans up its temp dirs (the 0.7.19 cut's only red)

The 0.7.19 cut (step 3, 2026-10-02 ~16:08) went red ONLY on run-tests.sh's #4273 LEAK guard: the node suite was
14291 pass / 0 fail, and the shell run's tests passed. engine/codexsession-5054.test.js (#5054, merged 19aa2a1f5)
makes temp dirs with fs.mkdtempSync(os.tmpdir() ...) (cx5054-home, cx5054-cwd, cx5054-cwd2, cx5054-none) and never
removes them; test.after only resets the cache.

## Change
`require('../test-support/tmpscope')` first in the file, the documented fix the guard names (and the idiom other engine
tests use): it gives the test process its own TMPDIR and removes it on exit, so every mkdtempSync in the file is
contained, including future ones.

## Decided (Splinter agreed 16:31)
Fix forward, not revert 19aa2a1f5: the red is test hygiene, the product passed, and 0.7.19 exists for #5054.

## Tests
The file alone, then run-tests.sh's leak guard over it: no cx5054-* left in the real temp root.
- Review 1 (sonnet, blind): CONVERGED. tmpscope contains all four cx5054 mkdtemp calls (os.tmpdir() read per call), the exit handler removes them even on a failing test, placement first is right, codexsession caches no tmpdir/HOME at require time, same idiom as ~20 engine tests. NIT: Tests section reads as intent until the focused run records its numbers.
