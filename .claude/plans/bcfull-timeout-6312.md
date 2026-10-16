# bcfull-timeout-6312: the nightly full browser-check run was cut off, not red (kosmos#6312)

## Finding
Run 38912844654 (10-16) hit the checks step's 120-minute limit: 8192 PASS lines, 0 FAIL, no
`FAILED-LIST` line (the driver never reached its summary). The step's time on GitHub-hosted
`macos-latest`, from the jobs API: 97 (10-13), 101 (10-14), 110 (10-15), 121 (10-16, cut off).
The runner was GitHub-hosted every night, so the CI mini drain (#5488) is not the cause.

## Change
`.github/workflows/browser-checks-full.yml`: checks step 120 to 240 minutes, job 170 to 285.
The workflow test requires step < job; 45 minutes stay for checkout, provisioning (20) and tmux (10).

## Why this and not sharding
A nightly run has no deadline and billing follows minutes used, so a limit of about twice the
measured run costs nothing extra and still bounds a hung run. Shards would each repeat checkout,
provisioning and board boots: roughly a third more macOS minutes a night. Revisit if the run nears 240.

## Weakest premise
That the growth is steady. 97 to 121 over three nights could include a slow check; a night far
off the trend would point there instead.

## Checks
`tools/test-browser-checks-workflow.sh` passes; it goes red with the step equal to the job.
