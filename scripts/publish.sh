#!/usr/bin/env bash
# Publish the site: pull the closet, rebuild every generated artefact, upload to Cloudflare,
# tell the search engines.
#
# This is the whole operating procedure. Adding a product to the website means listing it
# on Vinted and running this — there is no second place to type anything.
#
#   ./scripts/publish.sh              # normal: only new listings are fetched in full
#   ./scripts/publish.sh --full       # re-enrich every item (after a taxonomy change)
#   ./scripts/publish.sh --local      # rebuild and check locally, do not deploy or ping
#
# Order matters and is not arbitrary:
#   sync        must precede build-images (it downloads the photos that get derived)
#   build-images must precede build-shop  (build-shop reads the image manifest for
#                                          width/height, which is what stops the grid
#                                          reflowing as photos load)
#   build-shop  must precede build-jsonld (jsonld reads data/catalog.json and the pages
#                                          build-shop just wrote)
#   build-diaries must follow build-shop   (it lifts the header/footer out of index.html,
#                                          which build-shop rewrites) and precede bump-assets
#                                          (it writes diaries.html, which needs stamping)
#   sync-chrome must precede both          it maintains the header/footer in the hand-written
#                                          pages, which is the shell everything else reads
#   bump-assets must precede build-dist — it rewrites the ?v= token in the HTML, and
#               build-dist is what copies that HTML to the upload. Without a fresh token
#               Cloudflare keeps serving the old CSS at the edge; DEPLOY.md records a fix
#               that shipped correctly and stayed invisible for a day exactly this way.
#   build-dist  must precede the deploy — it is the definition of what is public, and the
#               only thing keeping scripts/, data/ and inventory.html off the internet.
#   commit      must precede the deploy, not follow it. See below.
#   indexnow    must follow the deploy, or it invites crawlers to fetch the previous build.
#
# WHY THIS SCRIPT COMMITS (added 16 Aug 2026)
# -------------------------------------------
# There are now TWO ways this site publishes: this script, and a push to `main`, because the
# repo is connected to Cloudflare Workers Builds. That second path deploys whatever is
# COMMITTED; this one deploys whatever is in the WORKING TREE (build-dist stages from disk,
# not from git). Two publishers reading two different definitions of "the site" is a
# regression waiting for a quiet morning: the 07:15 job rebuilds every generated page and
# deploys it, nobody commits the result, and the next push — days later, for an unrelated
# one-line fix — ships the older tree and silently reverts a week of catalog updates. There
# is no error anywhere in that sequence. The site just goes backwards.
#
# So the run commits what it published. Two details that are not arbitrary:
#
#   BEFORE the deploy, not after. If committing fails we stop, and git and the edge are both
#   still on yesterday — consistent, and obvious in the log. Commit AFTER a successful deploy
#   and a failure there leaves the edge ahead of git, which is the exact divergence this is
#   here to prevent.
#
#   Scoped to what build-dist stages, plus data/. NOT `git add -A`. Human-authored files the
#   pipeline never touches — scripts/, wrangler.jsonc, package.json, the .md files — stay out,
#   so a half-finished edit sitting in the tree at 07:15 is not committed by a cron job. The
#   published pages ARE in scope even when hand-edited, because build-dist stages them from
#   the working tree: they went live, so they belong in the commit that records what went live.
#
# It deliberately does NOT push. A push would trigger Workers Builds, which would deploy the
# same bytes a second time — and the credentials for it are not in launchd's environment
# anyway. Pushing stays a human action; the commits queue up until then, and because they
# hold exactly what is already live, pushing them later is a no-op at the edge.
#
# This runs on this Mac and not in the cloud, deliberately. sync-vinted's session handshake
# works from a residential IP and would be challenged from a datacenter range; build-images
# shells out to ImageMagick and cwebp; and the 408 MB of camera originals the derivatives
# come from exist only here. Only the OUTPUT moves — hosting is Cloudflare's, building is
# ours. No Docker is involved any more: node, magick, cwebp and wrangler are all native.

set -euo pipefail
cd "$(dirname "$0")/.."

FULL=""
LOCAL=""
IF_NEEDED=""
for arg in "$@"; do
  case "$arg" in
    --full)  FULL="--full" ;;
    --local) LOCAL="1" ;;
    --if-needed) IF_NEEDED="1" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# ONCE A DAY, WHENEVER THE MACHINE HAPPENS TO BE ON (added 17 Aug 2026)
# ---------------------------------------------------------------------
# StartCalendarInterval alone was not a daily guarantee, and the day that proved it was
# 17 Aug 2026: the Mac was shut down at 23:50 and booted at 08:21, so at 07:15 there was
# nothing running to fire. launchd does NOT replay a calendar event missed while the
# machine was OFF (it does after sleep — this Mac never sleeps, so that path never helped).
# `launchctl print` read `runs = 0` and the site simply did not update that day. Silently:
# no error, no log line, because the job that would have written the log never started.
#
# So the schedule is now three overlapping triggers in the plist — RunAtLoad, a 07:15
# calendar entry, and an hourly StartInterval — and THIS FLAG is what stops that from
# meaning three publishes a day. Each trigger passes --if-needed; the first run to succeed
# on a given date stamps the date, and every later trigger that day exits here in
# milliseconds. Turn the Mac on at 3pm and the day's sync happens at 3pm. Leave it on and
# nothing changes: 07:15, as before.
#
# The hourly trigger is also the retry. A run fired at boot can fail simply because the
# network is not up yet, and a failed run deliberately does NOT stamp the date — so the
# next hour tries again, and keeps trying, until one succeeds. That is the whole recovery
# mechanism; there is no other retry around the Vinted fetch.
#
# A HAND-TYPED `./scripts/publish.sh` IS NEVER BLOCKED. The flag is opt-in and only the
# launchd job passes it, because "publish now" typed by a person means now, not "only if
# the robot has not already been here today".
STAMP="$(dirname "$0")/../.sync-stamp"
TODAY=$(date +%Y-%m-%d)
if [ -n "$IF_NEEDED" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TODAY" ]; then
  echo "already published today ($TODAY) — nothing to do"
  exit 0
fi

# Checked here, in the first second, rather than at step 9 — a git problem should surface
# before the Vinted sync and the image derivation, not after six minutes of work that is
# then thrown away because the run cannot record itself.
if [ -z "$LOCAL" ]; then
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "⚠ not a git work tree — publish.sh commits what it deploys; see the header" >&2
    exit 1
  }
  GIT_BRANCH=$(git symbolic-ref --quiet --short HEAD) || {
    echo "⚠ detached HEAD — commit or check out a branch before publishing" >&2
    exit 1
  }
fi

step "1/12 sync from Vinted"
node scripts/sync-vinted.mjs $FULL

step "2/12 derive responsive images"
node scripts/build-images.mjs

# The chrome — header and footer — lives in index.html and is copied from there into the
# hand-written pages that are not generated (404.html, clothes.html). It was in NEITHER
# pipeline until 17 Aug 2026 and had to be remembered by hand, which meant a footer edit
# reached ten generated pages automatically and silently skipped those two. It runs FIRST
# because it maintains the outer shell every later generator reads out of index.html.
step "3/12 sync the chrome into the hand-written pages"
node scripts/sync-chrome.mjs

step "4/12 build shop pages"
node scripts/build-shop.mjs

# Added 17 Aug 2026. It was never in this script — the Diaries was built by hand — which was
# tolerable while that page was a hub of cards and became a bug the moment it started holding
# the writing itself: a post edited in data/posts.json or content/ would not have reached the
# site until somebody remembered to run one command. AFTER build-shop, because it lifts the
# header and footer out of index.html and build-shop rewrites index.html's own regions.
step "5/12 build the diaries"
node scripts/build-diaries.mjs

step "6/12 build local inventory view"
node scripts/build-inventory.mjs

step "7/12 inject JSON-LD"
node scripts/build-jsonld.mjs

step "8/12 build sitemap"
node scripts/build-sitemap.mjs

step "9/12 bump asset cache tokens"
node scripts/bump-assets.mjs

step "10/12 stage dist/"
# --no-generate because steps 3-7 above ARE the generators build-dist would otherwise run
# itself. It gained that ability on 17 Aug 2026 so that a plain `git push` — which triggers
# Workers Builds, whose build command is just `npm ci && node scripts/build-dist.mjs` —
# regenerates the site instead of deploying whatever HTML was committed. See the header of
# build-dist.mjs. Here that work is already done, so the flag skips a duplicate pass.
node scripts/build-dist.mjs --no-generate

if [ -n "$LOCAL" ]; then
  printf '\n\033[1m-- local only: skipping deploy and IndexNow\033[0m\n'
  # Serve dist/ rather than the repo root, so what you check is what ships — including the
  # absence of inventory.html. Wrangler's dev server also applies _headers and _redirects,
  # which python3 -m http.server does not, so the CSP and the /shop.html 301 are testable.
  echo "serve with: ./node_modules/.bin/wrangler dev   # serves dist/ exactly as Cloudflare will"
  echo "inventory:  open ./inventory.html directly — it is not in dist/ by design"
  exit 0
fi

step "11/12 commit what is about to be published"

# The pathspec IS the contract: these are the paths build-dist stages into dist/, plus data/,
# which is the master the pages are generated from — committing pages without the catalog
# that produced them would record a result with no cause. Everything else in the repo is
# hand-authored and stays out, so an unfinished edit to scripts/ or a half-written note in
# DEPLOY.md is never swept into a 07:15 commit.
#
# ':!inventory.html' excludes the stock-taking view for the same reason build-dist withholds
# it from the upload: cost prices and unlisted stock. It is tracked from before that rule
# existed, so it is excluded explicitly here rather than silently riding along on the glob.
# content/ joined this list on 17 Aug 2026, when the Diaries stopped pointing at two other
# pages and started holding the writing itself. It is the same argument that put data/ here:
# it is a master the pages are generated FROM, and committing diaries.html without the prose
# it was built from would record a result with no cause. It is never uploaded — build-dist
# ships root .html/.txt, assets/ and images/derived/ only — so it is source, not output.
PUBLISHED=( '*.html' ':!inventory.html' '*.txt' sitemap.xml assets images/derived edge data content )

# `git add` first, and not only because of modified files: build-images writes NEW
# derivatives every time a listing gains a photo, and build-shop can write a page that did
# not exist yesterday. Those are untracked, and untracked files are invisible to both
# `git diff HEAD` and a path-scoped `git commit` — without this add, the day a product
# category appears is the day the commit quietly omits it.
git add -- "${PUBLISHED[@]}"

# Both the test and the commit are scoped to the same pathspec, so anything the user had
# staged by hand before 07:15 is neither counted as "something to publish" nor carried into
# an automated commit. `git commit -- <paths>` ignores the rest of the index by design.
if git diff --cached --quiet -- "${PUBLISHED[@]}"; then
  echo "nothing generated changed — no commit (deploying anyway; dist/ is already staged)"
else
  # --no-verify: this runs unattended at 07:15. A hook that prompts, or one that shells out
  # to something slow, would hang the publish rather than fail it, and a hung publish is the
  # one failure mode nothing here recovers from.
  git commit --no-verify -q -m "publish: $(date +%Y-%m-%d) generated output" -m \
    "Automated commit from scripts/publish.sh, recording the tree that step 10 deploys.
Committed before the upload so git can never trail the edge. Not pushed — see the
header of publish.sh." -- "${PUBLISHED[@]}" || {
    echo "⚠ commit failed — stopping BEFORE the deploy so git and the edge stay in step" >&2
    exit 1
  }
  echo "committed on ${GIT_BRANCH}: $(git log --oneline -1)"
  echo "not pushed — run: git push origin ${GIT_BRANCH}"
fi

step "12/12 deploy to Cloudflare"

# Cloudflare credentials, in order of preference.
#
# 1. A scoped API token in the macOS Keychain, if one is there. This is the tighter option:
#    the token is scoped to "Workers Scripts:Edit" on this account and nothing else, so it
#    cannot touch DNS, the zone or the other tunnels, and the worst case if it leaks is a
#    defaced indianinprague.jains.es rather than a lost domain. Set one up with:
#      security add-generic-password -a "$USER" -s indianinprague-cf-token -w
#
# 2. Otherwise, whatever `wrangler login` stored in ~/Library/Preferences/.wrangler. That is
#    a browser OAuth session, which is far easier to set up but grants broader account
#    access than the token above. It refreshes itself, so the unattended 07:15 run keeps
#    working; if it ever does expire, wrangler exits non-zero, this script stops on `set -e`,
#    and IndexNow is never pinged — a failed publish, not a broken site.
#
# Either way the credential is NEVER put in the launchd plist: that file lives in scripts/
# and its EnvironmentVariables are readable by anything that can read this directory.
if CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s indianinprague-cf-token -w 2>/dev/null); then
  export CLOUDFLARE_API_TOKEN
  echo "auth: scoped API token from Keychain"
else
  echo "auth: wrangler's stored browser login"
fi

# ./node_modules/.bin/wrangler, NOT npx wrangler. npx resolves the latest version from the
# npm registry at run time, and this script runs unattended with the token above already in
# the environment — a newly published (or newly compromised) wrangler, or any of its 37
# transitive dependencies, would execute here before anyone saw it. The version is pinned in
# package.json and locked in package-lock.json; upgrading is a decision, not a sunrise.
if [ ! -x ./node_modules/.bin/wrangler ]; then
  echo "⚠ wrangler is not installed — run: npm ci" >&2
  exit 1
fi

# A static-assets-only Worker — see wrangler.jsonc for why this is not Cloudflare Pages
# (short version: Pages force-redirects /wardrobe.html to /wardrobe and cannot be told not
# to, which would fight every canonical tag on the site).
#
# wrangler hashes every file and uploads only the ones Cloudflare does not already hold, so
# a normal morning sends the rebuilt HTML and the day's new photos rather than 171 MB.
./node_modules/.bin/wrangler deploy

# Confirm the live site is actually serving this build before inviting crawlers to it.
# Checking the real hostname rather than a local port is the point: it exercises DNS, the
# custom domain binding and the edge, which is the whole surface that replaced nginx.
if curl -fsS -o /dev/null "https://indianinprague.jains.es/wardrobe.html"; then
  echo "live origin healthy"
  node scripts/indexnow.mjs

  # Stamped HERE and nowhere else: after the deploy is up and the live site has answered.
  # Anything that stops the run short leaves the stamp on yesterday, which is what turns
  # the hourly trigger into a retry instead of a silent daily miss. Never stamped for
  # --local, which deploys nothing.
  echo "$TODAY" > "$STAMP"
  echo "stamped $TODAY — the launchd triggers will now no-op until tomorrow"
else
  echo "⚠ indianinprague.jains.es did not answer — skipping IndexNow so crawlers are not sent to a broken build" >&2
  exit 1
fi
