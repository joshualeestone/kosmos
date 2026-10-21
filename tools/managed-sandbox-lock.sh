#!/bin/bash
# tools/managed-sandbox-lock.sh [--install | --uninstall]   (kosmos#4491)
#
# The one admin step that makes the token-only guard durable on a Mac: a root-owned Claude Code managed-settings file
# that locks the sandbox's filesystem block, so an agent cannot switch off, from USER settings it can write, the
# board.token denies its own project settings carry.
#
# WHY THIS AND NOTHING MORE. A token-only agent's project settings turn the sandbox on and deny board.token (engine/
# setup-assistant.js). The hole found on 2026-10-02: USER settings (~/.claude/settings.json, which every agent on the
# Mac user can write) may set `sandbox.filesystem.disabled: true`, which project settings cannot, and so undo the guard.
# Claude Code's docs (sandboxing, "Which settings can disable it"): when MANAGED settings configure `sandbox.filesystem`
# at all, only managed settings can set that key. So the file needs only a `sandbox.filesystem` block:
#   allowManagedReadPathsOnly: true   lower tiers cannot re-open a read path (an allowRead over board.token)
#   denyRead: [board.token]           a concrete entry, so the block is not empty
# It deliberately does NOT set sandbox.enabled or allowUnsandboxedCommands: managed settings apply to EVERY Claude Code
# session on the Mac, so either would sandbox the fleet's builders too. Sessions whose sandbox is off (every agent but
# the token-only ones) are not restricted by a filesystem list, which only the sandbox enforces.
#
# DEFAULT IS A DRY RUN: it prints the file it would write and changes nothing. --install needs root (sudo); it keeps a
# copy of any file already there, merges into it with /usr/bin/plutil (no other tool runs as root), and leaves the file
# owned by root, mode 644. --uninstall puts the kept copy back, or removes the file if there was none.
#
# Test seam: KOSMOS_MANAGED_SETTINGS_PATH points every read and write at another file; with it, root is not required
# and ownership is not changed (deploy is never through the seam).
set -u
PATH=/usr/bin:/bin:/usr/sbin:/sbin
TARGET=${KOSMOS_MANAGED_SETTINGS_PATH:-/Library/Application Support/ClaudeCode/managed-settings.json}
KEEP="$TARGET.before-kosmos-4491"
TOKEN_PATH='~/Library/Application Support/Kosmos/board.token'
mode=${1:-dry-run}
case "$mode" in dry-run|--dry-run) mode=dry-run ;; --install|--uninstall) ;; *) echo "usage: $0 [--install | --uninstall]  (no argument: show what --install would write)"; exit 2 ;; esac
[ -n "${KOSMOS_MANAGED_SETTINGS_PATH:-}" ] && seam=1 || seam=''
[ "$(uname -s)" = Darwin ] || [ -n "$seam" ] || { echo "managed-sandbox-lock: macOS only (managed settings are the Seatbelt sandbox's lock)"; exit 2; }
if [ "$mode" != dry-run ] && [ -z "$seam" ] && [ "$(id -u)" != 0 ]; then
    echo "managed-sandbox-lock: $mode writes $TARGET, which only an administrator can: run it with sudo"; exit 2
fi

# merge_into <file>: add the lock to a settings file in place, keeping every other key. Fails on a file plutil cannot read.
merge_into() {
    f=$1
    # JSON text only (Claude Code reads JSON): plutil would also take an XML plist, and write it back as XML.
    [ "$(tr -d ' \t\r\n' < "$f" | head -c 1)" = '{' ] || { echo "managed-sandbox-lock: $f is not a JSON object; nothing changed"; return 1; }
    # (plutil -lint reads plists, not JSON; a conversion is what proves plutil can read this JSON.)
    plutil -convert json -o - "$f" >/dev/null 2>&1 || { echo "managed-sandbox-lock: $f is not JSON plutil can read; nothing changed"; return 1; }
    # plutil writes a file back in the format it read, and a bare {} reads as an old OpenStep plist, which it cannot
    # write: an empty file starts from a shape only JSON has.
    [ "$(plutil -convert json -o - "$f" 2>/dev/null)" = '{}' ] && printf '{"sandbox":{"filesystem":{}}}\n' > "$f"
    if plutil -extract sandbox raw "$f" >/dev/null 2>&1; then
        [ "$(plutil -type sandbox "$f" 2>/dev/null)" = dictionary ] || { echo "managed-sandbox-lock: sandbox in $f is not a block; nothing changed"; return 1; }
    else plutil -insert sandbox -dictionary "$f" || return 1; fi
    if plutil -extract sandbox.filesystem raw "$f" >/dev/null 2>&1; then
        [ "$(plutil -type sandbox.filesystem "$f" 2>/dev/null)" = dictionary ] || { echo "managed-sandbox-lock: sandbox.filesystem in $f is not a block; nothing changed"; return 1; }
    else plutil -insert sandbox.filesystem -dictionary "$f" || return 1; fi
    plutil -replace sandbox.filesystem.allowManagedReadPathsOnly -bool YES "$f" || return 1
    if plutil -extract sandbox.filesystem.denyRead raw "$f" >/dev/null 2>&1; then
        [ "$(plutil -type sandbox.filesystem.denyRead "$f" 2>/dev/null)" = array ] || { echo "managed-sandbox-lock: sandbox.filesystem.denyRead in $f is not a list; nothing changed"; return 1; }
    else plutil -insert sandbox.filesystem.denyRead -array "$f" || return 1; fi
    # Added once: a second --install leaves the list as it is.
    plutil -extract sandbox.filesystem.denyRead json -o - "$f" 2>/dev/null | grep -qF 'Kosmos\/board.token"' \
        || plutil -insert sandbox.filesystem.denyRead -string "$TOKEN_PATH" -append "$f" || return 1
}

# has_lock <file>: the lock is already in it (both keys). Then --install changes nothing: re-merging would rewrite the
# file, and keeping a copy of it would make --uninstall put the lock back instead of taking it away.
has_lock() {
    [ "$(plutil -extract sandbox.filesystem.allowManagedReadPathsOnly raw "$1" 2>/dev/null)" = true ] \
        && plutil -extract sandbox.filesystem.denyRead json -o - "$1" 2>/dev/null | grep -qF 'Kosmos\/board.token"'
}
if [ "$mode" = --install ] && [ -f "$TARGET" ] && has_lock "$TARGET"; then
    echo "managed-sandbox-lock: $TARGET already holds the lock; nothing changed"; exit 0
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/managed-lock.XXXXXX") || exit 1
trap 'rm -rf "$work"' EXIT
case "$mode" in
dry-run|--install)
    if [ -f "$TARGET" ]; then cp "$TARGET" "$work/new.json" || exit 1; else printf '{}\n' > "$work/new.json"; fi
    merge_into "$work/new.json" || exit 1
    if [ "$mode" = dry-run ]; then
        echo "managed-sandbox-lock: DRY RUN. --install (with sudo) would write $TARGET:"
        cat "$work/new.json"; echo
        [ -f "$TARGET" ] && echo "(merged into the file already there, which would be kept as $KEEP)"
        exit 0
    fi
    dir=$(dirname "$TARGET")
    mkdir -p "$dir" || exit 1
    # Kept once: a second --install must not overwrite the original with our own earlier output.
    if [ -f "$TARGET" ] && [ ! -e "$KEEP" ]; then cp -p "$TARGET" "$KEEP" || exit 1; fi
    cp "$work/new.json" "$TARGET.tmp.$$" || exit 1
    if [ -z "$seam" ]; then chown root:wheel "$TARGET.tmp.$$" "$dir" && chmod 755 "$dir" || { rm -f "$TARGET.tmp.$$"; exit 1; }; fi
    chmod 644 "$TARGET.tmp.$$" && mv -f "$TARGET.tmp.$$" "$TARGET" || { rm -f "$TARGET.tmp.$$"; exit 1; }
    echo "managed-sandbox-lock: installed $TARGET. Restart the board so token-only agents pick it up; --uninstall undoes it."
    ;;
--uninstall)
    if [ -e "$KEEP" ]; then mv -f "$KEEP" "$TARGET" && echo "managed-sandbox-lock: put back the file that was there before ($TARGET)"
    elif [ -f "$TARGET" ]; then rm -f "$TARGET" && echo "managed-sandbox-lock: removed $TARGET (there was none before)"
    else echo "managed-sandbox-lock: nothing to undo ($TARGET is not there)"; fi
    ;;
esac
