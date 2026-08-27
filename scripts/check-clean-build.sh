#!/bin/bash
# Build the site from COMMITTED BYTES ONLY, the way Cloudflare Workers Builds does, and fail
# if it does not come out clean. Run by the pre-push hook and by publish.sh step 13b.
#
#   scripts/check-clean-build.sh [<commit-ish>]     default: HEAD
#
# WHY THIS EXISTS (27 Aug 2026)
# -----------------------------
# publish.sh has carried this claim in a comment since 25 Aug: "build-dist.mjs's GENERATORS
# list reads nothing but committed files ... so a cloud build reproduces a Mac build
# exactly." It was true when written, it is the entire reason the push is allowed to be the
# deploy, and nothing enforced it.
#
# It broke on 27 Aug. vendor-items.mjs gated every Govinda row on the SCRAPE ORIGINAL in
# vendors/govinda/images/, which .gitignore excludes as disposable. On this Mac the test
# passed for all 1,465 rows; inside Workers Builds, which has the commit and nothing else, it
# failed for all 1,465. The vendor shelves came out empty, build-shop.mjs deleted the
# now-empty category pages exactly as designed, and the links into them failed
# build-dist.mjs's link checker. The deploy stopped there, which was luck: the same commit
# would otherwise have shipped a shop missing 88% of its stock, with no error anywhere.
#
# A LOCAL BUILD CANNOT SEE THIS. That is the whole point. The failure class is "present on
# disk, absent from the commit", and the only thing that detects it is a build with no disk
# to fall back on. So: check out the commit into a throwaway worktree, build there, and let
# build-dist.mjs's own checks be the verdict.
#
# It deliberately does NOT diff this build's dist/ against the Mac's. Byte equality is the
# stronger claim and would be false every run — bump-assets.mjs stamps a fresh ?v= token, and
# a gate that cries wolf is a gate that gets bypassed by Friday.
set -euo pipefail

# GitHub Desktop launches git from a GUI process, which inherits launchd's PATH
# (/usr/bin:/bin:/usr/sbin:/sbin) and not your shell's — the same reason the launchd plist
# sets an explicit PATH. Without this the hook would fail with `node: command not found` on
# every Desktop push, which is a gate that blocks good commits for the wrong reason and
# teaches you to reach for --no-verify.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REF="${1:-HEAD}"
SHA="$(git rev-parse --short "$REF")"

# An explicit, greppable bypass. NOT `git push --no-verify`, which is the habit this is meant
# to avoid forming: --no-verify turns off every hook this repo will ever have, silently and
# permanently, whereas this names the one thing being skipped and shows up in shell history.
if [ -n "${SKIP_CLEAN_BUILD:-}" ]; then
  echo "clean-build check SKIPPED (SKIP_CLEAN_BUILD is set)"
  exit 0
fi

WT="$(mktemp -d "${TMPDIR:-/tmp}/iip-cleanbuild.XXXXXX")/tree"
cleanup() {
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$(dirname "$WT")"
}
trap cleanup EXIT

echo "clean-build check: ${SHA} in a worktree of its own"

# --detach: no branch is created, so this can run while that branch is checked out here.
git worktree add --detach --quiet "$WT" "$REF"

# node_modules is not committed (see .gitignore) and Workers Builds runs `npm ci` for it.
# Symlinking this Mac's copy is the one deliberate cheat in here: it saves ~40s per push, and
# the lockfile IS committed, so what npm would have installed is already pinned by the commit
# being checked. If the modules are missing, install them properly rather than skip the check.
if [ -d "$ROOT/node_modules" ]; then
  ln -s "$ROOT/node_modules" "$WT/node_modules"
else
  ( cd "$WT" && npm ci --silent --progress=false )
fi

# --no-generate is NOT passed. Workers Builds runs the generators; so must this, or the check
# would test a different program from the one that deploys.
if ( cd "$WT" && node scripts/build-dist.mjs ); then
  echo "clean-build check: PASSED — ${SHA} builds from committed files alone"
  exit 0
fi

cat >&2 <<EOF

clean-build check: FAILED for ${SHA}

The build above ran on the COMMITTED tree only, which is what Cloudflare Workers Builds
gets. It is failing there and would fail there. Your working tree may well build fine —
that is the symptom, not a contradiction: something the build reads is on this Mac and not
in the commit.

Look for, in order:
  1. a file the build reads that .gitignore excludes  (this was the 27 Aug 2026 cause)
  2. a new file never 'git add'ed
  3. a real content error — a dead link or anchor, which build-dist.mjs names above

Nothing was pushed. Fix it, commit, push again.
Genuinely need to push past this: SKIP_CLEAN_BUILD=1 git push
EOF
exit 1
