# promotegate-7942: a Linux promote requires both Linux check runs green for the exact staged sha (kosmos#7942)

## Goal (Splinter, 11-04 08:12)
tools/promote-channel.sh refuses to move latest-linux.json unless linux-family-install-7281.yml and
linux-promote-check-7933.yml are both green for the exact staged Linux build; --skip-linux-check overrides, loudly.

## Decided (reversible, mine per Splinter)
- **How a run proves which build it checked:** the workflows read the live pointer at run time, so each one, when
  every check passed, uploads an artifact named `<workflow>-<version>-<sha256>` (linux-family-install-...,
  linux-promote-check-...). 7281 re-reads the pointer at the end and records only if it still names the installed
  sha; 7933's legs each write the build they checked to step outputs and a `record` job uploads only if all three
  are the same build. Only from main, against https://installkosmos.com, and for 7281 only on channel staging.
- **The lookup:** tools/linux-check-runs.sh <version> <sha256> asks the REST API for the artifact by exact name
  (unexpired), and counts it only if its run concluded success, on main, from that workflow's file. Exit 0/1/2
  (green / missing or red / cannot tell). Rejected: grepping run logs (heavy, and log text is not a contract); run
  names (a dispatch cannot name the sha it has not read yet).
- **In promote-channel.sh:** right after promote_linux_prepare (so before every gate and write), only when
  PROMOTE_LINUX=yes. 1 refuses, 2 holds, both say "Nothing was written". --force does not skip it (it is for the
  Mac gates). --skip-linux-check prints a banner at the start and a line in the closing output; with no Linux
  pointer to move it says it had nothing to skip. KOSMOS_PROMOTE_LINUX_CHECK_CMD overrides the lookup (tests).
- docs/staging-channel.md step 4 says to run the two workflows first.

## Weakest premise
That the promoter's gh can read Actions artifacts and runs on joshualeestone/kosmos. If it cannot, the lookup
answers 2 and the promote HOLDS (fail closed); the override is --skip-linux-check, loudly.

## Tests
- tools/test-linux-check-runs-7942.sh (new, in test:shell): a fake gh from fixtures: green, missing, another build
  of the same version, a failed run, another branch, another workflow's artifact, an @ref path, mixed runs, GitHub
  down (both calls), no gh, bad sha, bad version. 19 arms.
- tools/test-promote-linux-7281.sh e2e: green promotes and asks for the exact sha; red refuses and writes nothing;
  cannot-tell holds; --force does not skip; --skip-linux-check promotes, loudly, without asking; a Mac-only promote
  asks for nothing. Perturbed: each of refuse, ask, banner, force-does-not-skip turns arms red.
- Real API: the lookup against joshualeestone/kosmos for 0.7.88 answers 1 (no records exist yet), the expected
  answer. After merge: run both workflows from main, then the lookup must answer 0.
