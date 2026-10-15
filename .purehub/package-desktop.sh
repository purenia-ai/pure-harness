#!/bin/sh
# Package the desktop app with a PureHub build version, without touching package.json.
#
# The repository already carries an identity into every artifact: the packaged
# commit is read from git automatically (apps/desktop/scripts/package-target.ts),
# and the build version is read from DSH_DESKTOP_BUILD_VERSION
# (apps/desktop/scripts/desktop-build-version.mjs). Only the version has to be
# supplied, which is what this script computes.
#
# The product version in package.json stays on the upstream number so merging
# upstream never conflicts on it; the build version extends it under the rule
# the repository already validates: <product version>.<UTC date>.<sequence>.
#
# Usage:
#   .purehub/package-desktop.sh [--print] [desktop script] [extra args...]
#
# Examples:
#   .purehub/package-desktop.sh --print
#   .purehub/package-desktop.sh package:mac:arm64:unsigned
#   PUREHUB_BUILD_SEQ=2 .purehub/package-desktop.sh package:win:x64:unsigned
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)

DRY=0
if [ "${1:-}" = "--print" ]; then
  DRY=1
  shift
fi
SCRIPT=${1:-package}
if [ $# -gt 0 ]; then
  shift
fi

VERSION=$(node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync('$ROOT/package.json','utf8')).version)")
PREFIX=$(node --input-type=module -e "import {desktopBuildVersionPrefix} from '$ROOT/apps/desktop/scripts/desktop-build-version.mjs';process.stdout.write(desktopBuildVersionPrefix('$VERSION'))")
SEQUENCE=${PUREHUB_BUILD_SEQ:-$(date -u +%H%M | sed 's/^0*//')}
[ -n "$SEQUENCE" ] || SEQUENCE=0
BUILD_VERSION="${PREFIX}$(date -u +%Y%m%d).${SEQUENCE}"

echo "product version : $VERSION"
echo "build version   : $BUILD_VERSION"
echo "package script  : $SCRIPT"

# Fail here rather than after a long packaging run. The sequence keeps no leading
# zero: semver rejects numeric prerelease identifiers that carry one.
node --input-type=module -e "
import { validateDesktopBuildVersion } from '$ROOT/apps/desktop/scripts/desktop-build-version.mjs'
validateDesktopBuildVersion('$BUILD_VERSION', '$VERSION')
"

if [ "$DRY" = "1" ]; then
  exit 0
fi

# The packaging entry reads the published version from its command line and copies
# it into DSH_DESKTOP_BUILD_VERSION for the builder, so setting that variable here
# would be overwritten by the product version.
exec pnpm --filter @deepseek-ai/dsh-desktop run "$SCRIPT" --build-version "$BUILD_VERSION" "$@"