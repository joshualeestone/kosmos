# linuxsettings-8384: Linux Settings reads Linux's own restart and sleep settings (kosmos#8384)

Shape posted on the card first (issuecomment 6801308249). Built on `linuxrows-8375` (Ice Cream Kitty), which sits on #8383; rebase onto main as they merge.

## Change
- **Restart row** (`autostart`, engine/machine.js `linuxBoardAutostartCheck` + `readLinuxBoardAutostart`): the board's systemd user unit (file there, `systemctl --user show -p UnitFileState`) and linger (logind's file via `linuxjob.lingerFileOn`, then `loginctl show-user -p Linger`). Arms: from source OK; missing on a bundle, disabled, masked ATTENTION; enabled + linger OK; enabled + no linger ATTENTION with `loginctl enable-linger` in the row's `admin` field; unreadable UNKNOWN. Only looks, never enable/enable-linger.
- **Sleep row** (`linuxSleepCheck` + `readLinuxSleep`): logind IdleAction (+ minutes), the lid switch on AC and battery when there is a lid or a battery, GNOME automatic suspend only while `org.gnome.SettingsDaemon.Power.service` is active. Any plugged-in stop is ATTENTION, battery-only is battOnly, all quiet is OK naming what was read, nothing read is no row (#8375's rule).
- **sleepGate** on Linux uses that reading (no pmset), and returns the row's `detail`.
- **Wizard**: Energy pane and the macOS battery note hidden on Linux, the sleep row's Turn On hidden on Linux, and a `data-gate-say` line under the row shows the reading's sentence while it says the computer sleeps (only Linux's reading carries one).

## Decided
- Linger off is ATTENTION, not OK: the agents stop at logout on a desktop too, and do not start at boot.
- GNOME's settings count only while its power service runs: gsettings answers with schema defaults on a server where nothing acts on them, which would warn every headless box with GNOME installed.
- Other desktops (KDE) are not read; the OK sentence says only logind was read and that a desktop's own settings may still sleep.
- The per-agent Linux row (Mac `agentautostart`) is a follow-up, not here.
- A test never reads the host: the unit folder needs AGENT_WORKFORCE_SYSTEMD_DIR or AGENT_WORKFORCE_LAUNCH, and the lid needs opts.hasLid, else they read as unknown / no lid.

## Rejected
- Reading logind.conf files by hand: busctl gives the effective values, drop-ins included.
- A Linux-styled mock in the wizard: words are enough, and a picture of one desktop is wrong on the others.

## Weakest premise
Command output shapes (busctl `s "x"`, `t N`; gsettings `'x'`, `uint32 N`; `systemctl show` `UnitFileState=`) are from the tools' documented formats, not measured on a Linux board. The wizard's Accessibility step (step 2) still shows on Linux; not this card.
