#!/bin/bash
# Writes the export options archive.sh exports with, and prints the extra build settings its archive takes, one per
# line (kosmos #6262). archive.sh calls it; test-archive-config.sh runs it on its own, so what the hand-signing mode
# does to both is tested without archiving anything.
#
#   ios/tools/export-options.sh <team> <bundle-id> <out.plist> [<app profile> <notice profile>]
#
# Without a profile: the committed ExportOptions.plist with the team added (automatic signing), and no build settings.
# With them: manual signing with the Apple Distribution certificate, the app's profile for the bundle id and the
# notification extension's (kosmos#6487, KosmosNotice) for <bundle-id>.notice, each read back so a name PlistBuddy
# mangled is refused (archive.sh checks the names before this), and the settings that sign the archive the same way.
# Each target takes its own profile through its own setting (KOSMOS_APP_PROFILE, KOSMOS_NOTICE_PROFILE in
# project.pbxproj): PROVISIONING_PROFILE_SPECIFIER on the command line would give both targets the app's profile.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
team=$1; bundle=$2; options=$3; profile=${4:-}; notice=${5:-}
pb=/usr/libexec/PlistBuddy

cp "$here/ExportOptions.plist" "$options"
"$pb" -c "Add :teamID string $team" "$options"
[ -n "$profile" ] || exit 0
[ -n "$notice" ] || { echo "export-options.sh: signing by hand needs the notification extension's profile too ($bundle.notice)" >&2; exit 1; }
"$pb" -c "Set :signingStyle manual" -c "Add :signingCertificate string Apple Distribution" \
  -c "Add :provisioningProfiles dict" -c "Add :provisioningProfiles:$bundle string $profile" \
  -c "Add :provisioningProfiles:$bundle.notice string $notice" "$options"
got=$("$pb" -c "Print :provisioningProfiles:$bundle" "$options" 2>/dev/null || true)
[ "$got" = "$profile" ] || { echo "export-options.sh: the export options name profile '$got', not '$profile'" >&2; exit 1; }
got=$("$pb" -c "Print :provisioningProfiles:$bundle.notice" "$options" 2>/dev/null || true)
[ "$got" = "$notice" ] || { echo "export-options.sh: the export options name profile '$got' for $bundle.notice, not '$notice'" >&2; exit 1; }
printf '%s\n' CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=Apple Distribution" "KOSMOS_APP_PROFILE=$profile" "KOSMOS_NOTICE_PROFILE=$notice"
