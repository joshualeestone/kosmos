#!/bin/bash
# Writes the export options archive.sh exports with, and prints the extra build settings its archive takes, one per
# line (kosmos #6262). archive.sh calls it; test-archive-config.sh runs it on its own, so what the hand-signing mode
# does to both is tested without archiving anything.
#
#   ios/tools/export-options.sh <team> <bundle-id> <out.plist> [<profile name>]
#
# Without a profile: the committed ExportOptions.plist with the team added (automatic signing), and no build settings.
# With one: manual signing with the Apple Distribution certificate and that profile for the bundle id, read back so a
# name PlistBuddy mangled is refused (archive.sh checks the name before this), and the three settings that sign the
# archive the same way.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
team=$1; bundle=$2; options=$3; profile=${4:-}
pb=/usr/libexec/PlistBuddy

cp "$here/ExportOptions.plist" "$options"
"$pb" -c "Add :teamID string $team" "$options"
[ -n "$profile" ] || exit 0
"$pb" -c "Set :signingStyle manual" -c "Add :signingCertificate string Apple Distribution" \
  -c "Add :provisioningProfiles dict" -c "Add :provisioningProfiles:$bundle string $profile" "$options"
got=$("$pb" -c "Print :provisioningProfiles:$bundle" "$options" 2>/dev/null || true)
[ "$got" = "$profile" ] || { echo "export-options.sh: the export options name profile '$got', not '$profile'" >&2; exit 1; }
printf '%s\n' CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=Apple Distribution" "PROVISIONING_PROFILE_SPECIFIER=$profile"
