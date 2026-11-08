# kosmos#8250: test-light-side-4911 on ubuntu-26.04

Cause (reasoned from the failure, to be confirmed by the 26.04 run below): the real-matcher fixture made its three
browser stand-ins by copying /bin/sleep to a browser path. On ubuntu-26.04 /bin/sleep is the Rust coreutils
multicall binary, which chooses its tool from the name it is run as, so a copy named chrome-headless-shell (or
com.apple.WebKit.WebContent, or chrome_crashpad_handler) exits at once. The three copies were exactly the three
stand-ins reported not running; the fourth, a perl wait, ran.

Fix: each stand-in is a perl wait started with `exec -a <browser path>`, so its command line begins with the path,
which is all the matcher reads (`_kosmos_pgrep_cmdlines`: pgrep -fa on Linux, -fl on macOS). No copied binary, so no
codesign on macOS either.

Checked: the file passes on this Mac (0 failures, the four real-matcher arms PASS). A perturbation that moves the
browser path out of ms-playwright/ turns "the real matcher lists a browser executable" red. On 26.04: a temporary
commit on the draft PR points both shell shards at ubuntu-26.04; it is dropped once that run is read.
