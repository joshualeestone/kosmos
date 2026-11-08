# kosmos#8250: test-light-side-4911 on ubuntu-26.04

Cause (reasoned from the failure, to be confirmed by the 26.04 run below): the real-matcher fixture made its three
browser stand-ins by copying /bin/sleep to a browser path. On ubuntu-26.04 /bin/sleep is the Rust coreutils
multicall binary, which chooses its tool from the name it is run as, so a copy named chrome-headless-shell (or
com.apple.WebKit.WebContent, or chrome_crashpad_handler) exits at once. The three copies were exactly the three
stand-ins reported not running; the fourth, a perl wait, ran.

Fix: each stand-in is a perl wait started with `exec -a <browser path>`, so its command line begins with the path,
which is all the matcher reads (`_kosmos_pgrep_cmdlines`: pgrep -fa on Linux, -fl on macOS). No copied binary, so no
codesign on macOS either.

Checked: the file passes on this Mac (0 failures, the four real-matcher arms PASS). Perturbed: moving the browser
path out of ms-playwright/ turns "the real matcher lists a browser executable" red; removing the .xpc/ exclusion from
_kosmos_playwright_browsers turns "leaves out a WebKit XPC helper" red; removing the crashpad exclusion turns "leaves
out Chrome's crash reporter" red.

Not here: the unpin. Review 2 caught that folding it in would have unpinned without the sbroot control fix (#8248)
and clashed with it. Ice Cream Kitty's order (Fleet Builders, 09:23): #8248 lands the sbroot control on the pinned
main, this lands, then her small unpin PR restores the four pinned files; that PR's own CI on ubuntu-latest (26.04),
with both fixes on main, is the proof. So #8250 is NOT done when this merges: it is parked until that run is green,
and the cause stays REASONED until then.
