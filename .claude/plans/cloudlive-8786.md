# kosmos#8786 S2 follow-up: the Cloud nightly units on real systemd (CI)

S2 (PR #8803, merged 956cbbfa5) was tested only against a stub systemctl. This adds a live test on GitHub's ubuntu
runner, in linux-systemd.yml beside #6667's pause-check test: real installBoard and removeBoard, the real Cloud latch
(the tunnel state folder) and the real install/kosmos cloud-update, the board stubbed as in #4918's test.

Cases: no latch, no nightly unit (CONTROL); the latch, both units written, `systemd-analyze --user verify` accepts
them, the timer enabled with a next firing; the service started by systemd runs the real chain and logs its skip
(no signed check in a test home); the Updates switch off logs that reason instead; the latch gone skips quietly;
removeBoard takes both units away. Nothing is installed: no case reaches the update look.

The test points the latch and the data root at its own folders through `systemctl --user set-environment` (the
services inherit the user manager's environment) and unsets them on exit.

Not measured here: an actual nightly INSTALL (a newer prod build replacing an older one under the timer). That needs
a published build newer than the one installed and stays the throwaway Cloud box's measurement.
