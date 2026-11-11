# aptzsh-8380: Linux CI installs only what it lacks, without the security mirror (kosmos#8380)

## Done when
On this PR's own CI, both Linux `suite (shell)` jobs get past the tools step and run their tests while security.ubuntu.com is unreachable; and once it is back, the step still installs or skips correctly.

## Change
.github/workflows/test.yml "Linux tools for test:shell" and linux.yml "install system dependencies": install only the tools `command -v` cannot find; if an install fails, point the security pocket at the runner's own Ubuntu mirror (read from its apt sources) and try again. Not `-t <codename>`: every pocket's Release file carries the same codename (review round 1).

## Decisions
- Rejected waiting it out: every PR's test check is red for a cause no PR can fix.
- The fallback edits the throwaway runner's apt sources only; the packages are the same versions, from a mirror.

## Weakest premise
That the runner's mirror carries the -security pocket (Ubuntu mirrors normally do) and resolves. This PR's own CI is the measurement.
