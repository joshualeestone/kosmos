# install-gate-624: the release installs the bundle it just built, in a sandbox, before anything is served

## Finished looks like
release.sh step 4b runs tools/test-install.sh in gate mode (KOSMOS_INSTALL_GATE=1) on the
bundle step 4 just packed, with the served tmux bundle extracted into the frozen dist, and
a red stops the cut before step 5. Gate mode runs the install, update, uninstall and
download-path passes plus the closing "nothing leaked" checks, then exits before the probe
blocks. tools/test-install-gate-control.sh proves the gate reds on a bundle missing a file the
installer's post-extract check expects (removed from a copy's staged tree and tarball), with
the untouched copy green as the control of the control.

## Why
Every check in the cut measured bytes (the suite, served == built file by file); none ever
installed the thing. #583's shape change was proven by running the harness by hand, off
script. Found by Angel + Splinter before that cut (#624).

## Not in this change
The probe blocks' seven fixture failures (Baron's, #664/#665 uid keying). The sign-in leg: a
sandboxed install must override HOME, and that is what makes sign-in untestable in the same
run (Splinter, 2026-08-24). The gate is not in test:shell (minutes); it is `yarn
test:install-gate` and the cut.
