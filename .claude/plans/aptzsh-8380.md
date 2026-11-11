# aptzsh-8380: Linux CI installs only what it lacks, without the security mirror (kosmos#8380)

## Done when
On this PR's own CI, both Linux `suite (shell)` jobs get past the tools step and run their tests while security.ubuntu.com is unreachable; and once it is back, the step still installs or skips correctly.

## Change
.github/workflows/test.yml "Linux tools for test:shell" and linux.yml "install system dependencies": install only the tools `command -v` cannot find; if an install fails, try again from the release's own archive (`apt-get install -t <codename>`, codename from /etc/os-release), which the runner's mirror serves.

## Decisions
- Rejected waiting it out: every PR's test check is red for a cause no PR can fix.
- Rejected editing the runner's apt sources to drop the security pocket: more moving parts, and -t picks the same versions without touching files.
- The fallback installs a release-pocket zsh, possibly without the latest security fix, on a throwaway CI runner only.

## Weakest premise
That the release pocket's zsh, tmux and lsof are on the runner's mirror and resolvable. This PR's own CI is the measurement.
