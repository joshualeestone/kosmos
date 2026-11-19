# devkeyvk-7116: ship escrowd's device-key history verifying key (kosmos#7116 step 3)

Step 3 of #7116's minimum chain for #8710 hand-over (comment 7015973250). The key was read by Baron Draxum from
escrowd's start line and audit record on the production box; a golden vector (an empty history escrowd signed for
throwaway names) proves it is the key escrowd signs with.

- `engine/devkeyhist.js`: VERIFYING_KEY set; the key verify trusts comes from trustAnchor() (a test key inside a node
  test process, else the shipped key); header states who calls verify and what a rotation costs.
- Tests: the pin, trustAnchor outside and inside a test process, the golden vector with two controls.
- Deferred (on #7116): a golden vector WITH entries, after the first two-admin enrolment (#7116 step 1).
