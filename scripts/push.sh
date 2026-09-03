#!/bin/bash
# Commit and push whatever you changed by hand today.
#
#   ./scripts/push.sh                 commits everything changed, with a dated message
#   ./scripts/push.sh "fixed a typo"  same, with your own message
#
# WHY THIS EXISTS (3 Sep 2026)
# ----------------------------
# publish.sh runs itself at 07:15 and commits everything the pipeline generates, so on a
# normal day there is nothing here to do and this script is not run at all. It is for the
# other case: an ad-hoc edit made during the day that the generators do not own — a page's
# wording, a diary post, a script.
#
# It does NOT build anything. The push is the deploy: Cloudflare Workers Builds regenerates
# the site from the commit, running build-dist.mjs's generators in its own container. So
# what has to be right is the COMMITTED SOURCE, not this Mac's dist/ — and the pre-push hook
# proves exactly that by building from the commit alone before the push is allowed out.
#
# `git add -A` here, where publish.sh uses a narrow pathspec, and the difference is the whole
# point: publish.sh runs unattended at 07:15 and must never sweep up a half-finished edit,
# whereas you are sitting here and everything dirty is something you did on purpose.
set -euo pipefail
cd "$(dirname "$0")/.."

# Same reason as check-clean-build.sh: launched from a GUI process, PATH is launchd's and
# node is not on it. The pre-push hook needs node.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

BRANCH=$(git symbolic-ref --quiet --short HEAD) || {
  echo "⚠ detached HEAD — check out a branch first" >&2
  exit 1
}

git add -A

if git diff --cached --quiet; then
  echo "nothing changed — nothing to push"
  exit 0
fi

echo "about to commit and push to ${BRANCH}:"
git diff --cached --stat

git commit -q -m "${1:-changes $(date +%Y-%m-%d)}"
echo "committed: $(git log --oneline -1)"

# No --no-verify, deliberately, and this is the opposite call to the one publish.sh makes.
# There the hook is skipped because an unattended 07:15 run must fail rather than hang. Here
# you are watching, and the hook is a clean build from the commit — the one check that
# catches "works on my Mac, missing from the commit" before it reaches the edge.
git push origin "${BRANCH}"
echo "pushed. Cloudflare is building it now; the site updates in a couple of minutes."
