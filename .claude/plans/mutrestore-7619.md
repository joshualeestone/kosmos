# mutrestore-7619 (kosmos#7619)
Goal: tools/prove-it-fails.sh restores its break when killed (HUP/INT/TERM), restoring only the files the break changed and only while they still hold it, and ends the test it was running. SIGKILL stays uncatchable; the existing dirty-tree refusal names the file at the next start.
Out of scope: the tmux guard and resume note (agent1-dot-claude branch resume-7619).
