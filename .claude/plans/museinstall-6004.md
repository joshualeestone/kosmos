# museinstall-6004: install Muse Code from inside Kosmos

Card: #6004 (split from #3939). Stacked on musedefault-3939 (Meta Muse on by default on the Mac); merges after it.

## Finished looks like
On a Mac without Muse Code, Settings, AI Models, Add a provider offers Meta; its step says Muse Code is a download
from Meta and offers Install Muse Code (the press is the confirm, as Antigravity's is). Installed, the same button
becomes Sign in with Meta. The first-run Meta row's Connect opens the same panel. A failed install says why and
offers Try again (a refusal a retry cannot change hides the button and focuses the reason); a double press installs once;
a sign-in refused because Muse Code went missing returns to the Install step. Nothing touches the person's shell profiles.

## Change
- engine/museinstall.js: install() (Mac only, Muse on, not sandboxed, already-installed is a no-op): Meta's
  installer from the fixed https://dev.meta.ai/install.sh, saved to a private temp file and run by bash (never
  piped), with only PATH/HOME/USER/LOGNAME/SHELL/TMPDIR/LANG plus MUSE_NO_MODIFY_PATH=1 (no PATH line in ~/.zshrc)
  and MUSE_INSTALL_DIR=~/.local/bin (where resolveBin('muse') looks); a hard cap; concurrent presses share one run
  (inflight.collapse); success only if musestatus.installed() then finds it.
- server.js: POST /api/muse/install.
- web/index.html: museSigninFlow gains an install step (needsInstall/onInstalled per place; press() installs or
  signs in); museAsk offers Meta whenever Muse is on (MUSE_CODE_HERE records whether Muse Code is here); first run's
  Connect opens the panel on its install step; the create forms point at Settings again ("set up in Settings"),
  since Settings can now install it.
- engine/musestatus.js NOT_INSTALLED_BECAUSE, engine/create.js's refusal and engine/connections.js point at Settings.

## Decided
- Mirror the Antigravity install (engine/agystatus.js) rather than invent a new pattern.
- No checksum pin on the installer: it is Meta's moving script (same fingerprint on 09-26 and 10-12, but pinning
  would break every install on Meta's next release). The result is verified instead (the launcher is where Kosmos
  looks and runnable).
- Windows: not offered (the Muse runner is Mac only).

## Weakest premise
That Meta's installer keeps honouring MUSE_NO_MODIFY_PATH and MUSE_INSTALL_DIR (read in the 10-12 script; a test
pins that Kosmos passes them, not that Meta honours them). Measured: the real installer ran on Mortals 10-12 and put
muse 1.4.6 at ~/.local/bin/muse.
