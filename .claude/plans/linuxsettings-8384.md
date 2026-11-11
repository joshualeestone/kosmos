# linuxsettings-8384: Linux Settings reads Linux's own restart and sleep settings (kosmos#8384)

Shape posted on the card first (issuecomment 6801308249). Built on `linuxrows-8375` (Ice Cream Kitty), which sits on #8383; rebase onto main as they merge.

## Change
- **Restart row** (`autostart`, engine/machine.js `linuxBoardAutostartCheck` + `readLinuxBoardAutostart`): the board's systemd user unit (file there, `systemctl --user show -p UnitFileState`) and linger (logind's file via `linuxjob.lingerFileOn`, then `loginctl show-user -p Linger`). Arms: from source OK; missing on a bundle, disabled, masked ATTENTION; enabled + linger OK; enabled + no linger ATTENTION with `loginctl enable-linger` in the row's `admin` field; unreadable UNKNOWN. Only looks, never enable/enable-linger.
- **Sleep row** (`linuxSleepCheck` + `readLinuxSleep`): logind IdleAction (+ minutes), the lid switch on AC and battery when there is a lid or a battery, GNOME automatic suspend only while `org.gnome.SettingsDaemon.Power.service` is active. Any plugged-in stop is ATTENTION, battery-only is battOnly, all quiet is OK naming what was read, nothing read is no row (#8375's rule).
- **sleepGate** on Linux uses that reading, so /api/sleep-status never runs pmset there.
- **Wizard: no change.** The card's note (review 3 of #8375) said the macOS sleep step shows on Linux; it does not. `frStepSequence` drops panes 2, 3, 4 and 7 on Linux since #5877, so a Linux board never walks the sleep step. A first build hid the Energy pane and added a Linux sentence there; it was dead code and was taken out.

## Decided
- Linger off is ATTENTION, not OK: the agents stop at logout on a desktop too, and do not start at boot.
- GNOME's settings count only while its power service runs: gsettings answers with schema defaults on a server where nothing acts on them, which would warn every headless box with GNOME installed.
- Other desktops (KDE) are not read; the OK sentence says only logind was read and that a desktop's own settings may still sleep.
- The per-agent Linux row (Mac `agentautostart`) is a follow-up, not here.
- A desktop whose own power settings are not read (KDE, a logged-out GNOME; a display manager runs) is OK under the title "Linux's own settings do not put this computer to sleep", and the detail says the desktop's and login screen's settings were not read. Rejected: UNKNOWN (review 5's ask, again review 16), because on such a desktop it never clears, and #8375 keeps a row that can never read something out of the could-not-check count (review 6). A GNOME older than 3.34, whose power service is not a user unit, falls in this same class (its settings are not read) and is decided the same way.
- A bundle install where systemd does not run (a container) is ATTENTION and says something else may start it, not UNKNOWN (reviews 12 and 16): Kosmos itself does not start there, which is what the row is about.
- GNOME inside a virtual machine is not special-cased: gsd-power may skip its idle suspend there, but that is from memory of its source, not measured, and a false alarm costs less than a false OK (reviews 7 and 8 split; decided).
- A GNOME timeout that could not be read, beside a type that stops, is a finding ("after a while"), not a non-finding: an unreadable read must not become "never" (review 4; review 12 asked the opposite, kept).
- sleepGate: a GNOME reading that is all clear answers prevented (the desktop's settings were read; only the login screen's were not, and the row says so), while an unread desktop (a display manager, no settings read) answers not checkable. No Linux screen shows the gate today (review 13 asked for one rule; kept two, on purpose).
- A stock laptop (logind's default lid suspend) shows a standing battOnly attention row, as a Mac laptop that sleeps on battery does; Settings draws both the same way. Kept (review 15).
- GNOME running but its settings unreadable is could-not-check, unlike a desktop Kosmos never reads (review 15).
- A desktop holding logind's handle-lid-switch inhibitor (KDE always, GNOME with another screen) decides the lid itself: no logind lid finding or fix, and the row says the desktop's Power settings decide it (review 29).
- A laptop with a logind lid finding and a desktop whose own settings were not read (a logged-out GNOME) is a full attention row, not battOnly: the plugged-in half is not known (reviews 28, 29).
- The Windows arm of boardAutostartCheck keeps reading opts.platform, not platformOf: changing it would change Windows behaviour on a Linux card (review 32 asked; kept).
- A sandboxed board has no restart row (review 32), not a standing could-not-check.
- The lid and battery are battOnly, as on the Mac; the logind fix is a pasteable command in the admin field, for a root shell (machine.js never runs sudo: its own guard test).
- The readers' test guards ask live-execution.inTestRun() (true in a child a test spawns too, review 30); a guard test pins it under the repo's runner (review 22 asked for explicit folder flags instead; kept).
- A test never reads the host: the unit folder needs AGENT_WORKFORCE_SYSTEMD_DIR or AGENT_WORKFORCE_LAUNCH, and the lid needs opts.hasLid, else they read as unknown / no lid.

## Rejected
- Reading logind.conf files by hand: busctl gives the effective values, drop-ins included.
- Any wizard change: Linux does not show that screen (above).

## Weakest premise
`held` (systemd runs this board now) compares the unit's MainPID with this process, which holds because board-run ends in `exec node`, as linuxboard.canRestart also relies on; a wrapper in front of node would make a held board read as loose.
Command output shapes (busctl `s "x"`, `t N`; gsettings `'x'`, `uint32 N`; `systemctl show` `UnitFileState=`) are from the tools' documented formats, not measured on a Linux board.
