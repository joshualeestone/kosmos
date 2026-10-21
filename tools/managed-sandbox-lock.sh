#!/bin/bash
# tools/managed-sandbox-lock.sh [--install | --uninstall]   (kosmos#4491)
#
# The one admin step that makes the token-only guard durable on a Mac: a root-owned Claude Code managed-settings drop-in
# that locks the sandbox's filesystem block, so an agent cannot switch off, from USER settings it can write, the
# board.token denies its own project settings carry.
#
# WHY THIS AND NOTHING MORE. A token-only agent's project settings turn the sandbox on and deny board.token (engine/
# setup-assistant.js). The hole found on 2026-10-02: USER settings (~/.claude/settings.json, which every agent on the
# Mac user can write) may set `sandbox.filesystem.disabled: true`, which project settings cannot, and so undo the guard.
# Claude Code's docs (sandboxing, "Which settings can disable it"): when MANAGED settings configure `sandbox.filesystem`
# at all, only managed settings can set that key. So the drop-in holds one non-empty `sandbox.filesystem` block:
#   denyRead: [~/Library/Application Support/Kosmos/board.token]
# Deliberately NOT here:
#   sandbox.enabled, allowUnsandboxedCommands   managed settings reach EVERY Claude Code session on the Mac, so either
#                                              would sandbox the fleet's builders too (the agent's project settings
#                                              already set both, and they outrank user settings)
#   allowManagedReadPathsOnly                  Claude Code 2.1.306 warns it "would drop the sandbox's own directories
#                                              from the readable set" (review 1)
#
# A DROP-IN, not an edit of managed-settings.json: Claude Code reads every file in managed-settings.d/ beside it (2.1.306
# loads and merges them; lists concatenate), so nothing another administrator wrote is touched, and --uninstall removes
# exactly this one file.
#
# DEFAULT IS A DRY RUN: it prints what --install would write and changes nothing. --install needs root (sudo). It refuses
# when a managed file already sets sandbox.filesystem.disabled (that would leave the guard off while this said it was on),
# and when any path it would write through is a link or a folder not owned by root.
#
# Test seam: KOSMOS_MANAGED_DIR stands in for /Library/Application Support/ClaudeCode; with it, root is not required and
# ownership is neither checked nor set.
set -u
PATH=/usr/bin:/bin:/usr/sbin:/sbin
BASE=${KOSMOS_MANAGED_DIR:-/Library/Application Support/ClaudeCode}
DROPDIR="$BASE/managed-settings.d"
FILE="$DROPDIR/kosmos-token-guard.json"
CONTENT='{"sandbox":{"filesystem":{"denyRead":["~/Library/Application Support/Kosmos/board.token"]}}}'
mode=${1:-dry-run}
case "$mode" in dry-run|--dry-run) mode=dry-run ;; --install|--uninstall) ;; *) echo "usage: $0 [--install | --uninstall]  (no argument: show what --install would write)"; exit 2 ;; esac
[ -n "${KOSMOS_MANAGED_DIR:-}" ] && seam=1 || seam=''
[ "$(uname -s)" = Darwin ] || [ -n "$seam" ] || { echo "managed-sandbox-lock: macOS only (managed settings are the Seatbelt sandbox's lock)"; exit 2; }
if [ "$mode" != dry-run ] && [ -z "$seam" ] && [ "$(id -u)" != 0 ]; then
    echo "managed-sandbox-lock: $mode writes under $BASE, which only an administrator can: run it with sudo"; exit 2
fi

# Paths root writes through: never a link, and an existing folder must be root's (else its owner could swap in a link).
for p in "$BASE" "$DROPDIR" "$FILE"; do
    [ -L "$p" ] && { echo "managed-sandbox-lock: $p is a link; refusing to write through it"; exit 1; }
done
if [ -z "$seam" ]; then
    for d in "$BASE" "$DROPDIR"; do
        [ -d "$d" ] && [ "$(stat -f %u "$d")" != 0 ] && { echo "managed-sandbox-lock: $d is not owned by root; refusing"; exit 1; }
    done
fi

# disabled_in <file>: the file sets sandbox.filesystem.disabled to true (read-denies are then not enforced at all).
disabled_in() { [ "$(plutil -extract sandbox.filesystem.disabled raw "$1" 2>/dev/null)" = true ]; }
blocking=''
for f in "$BASE/managed-settings.json" "$DROPDIR"/*.json; do
    [ -f "$f" ] && [ "$f" != "$FILE" ] && disabled_in "$f" && blocking="$blocking $f"
done

case "$mode" in
dry-run)
    echo "managed-sandbox-lock: DRY RUN. --install (with sudo) would write $FILE:"
    printf '%s\n' "$CONTENT"
    [ -n "$blocking" ] && echo "and would REFUSE: sandbox.filesystem.disabled is true in$blocking"
    exit 0 ;;
--install)
    [ -z "$blocking" ] || { echo "managed-sandbox-lock: sandbox.filesystem.disabled is true in$blocking, so read-denies are not enforced and this lock would do nothing; nothing written"; exit 1; }
    if [ -f "$FILE" ] && [ "$(cat "$FILE")" = "$CONTENT" ]; then echo "managed-sandbox-lock: $FILE is already in place; nothing changed"; exit 0; fi
    for d in "$BASE" "$DROPDIR"; do
        if [ ! -d "$d" ]; then
            mkdir "$d" || exit 1
            # Only a folder this created is given owner and mode (an existing one, perhaps a device manager's, is left as is).
            if [ -z "$seam" ]; then chown root:wheel "$d" && chmod 755 "$d" || exit 1; fi
        fi
    done
    tmp=$(mktemp "$DROPDIR/.kosmos-token-guard.XXXXXX") || exit 1
    printf '%s\n' "$CONTENT" > "$tmp" || { rm -f "$tmp"; exit 1; }
    if [ -z "$seam" ]; then chown root:wheel "$tmp" || { rm -f "$tmp"; exit 1; }; fi
    chmod 644 "$tmp" && mv -f "$tmp" "$FILE" || { rm -f "$tmp"; exit 1; }
    echo "managed-sandbox-lock: installed $FILE. Restart the board so token-only agents start under it; --uninstall removes it." ;;
--uninstall)
    if [ -f "$FILE" ]; then rm -f "$FILE" && echo "managed-sandbox-lock: removed $FILE"
    else echo "managed-sandbox-lock: nothing to undo ($FILE is not there)"; fi ;;
esac
