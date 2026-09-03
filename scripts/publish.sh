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
# It then PUSHES, and the push is what deploys (changed 25 Aug 2026 — see step 14). Cloudflare
# Workers Builds regenerates the site from the commit, so git and the edge cannot drift: what
# is pushed is what is served. There is no wrangler here any more and no Cloudflare token on
# this Mac.
#
# This runs on this Mac and not in the cloud, deliberately. sync-vinted's session handshake
# works from a residential IP and would be challenged from a datacenter range; build-images
# shells out to ImageMagick and cwebp; and the 408 MB of camera originals the derivatives
# come from exist only here. Only the OUTPUT moves — hosting is Cloudflare's, building is
# ours. No Docker is involved any more: node, magick and cwebp are all native, and wrangler
# is now only a local preview tool (`wrangler dev`), not part of publishing.

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

step() { CURRENT_STEP="$1"; printf '\n\033[1m== %s\033[0m\n' "$1"; }

# THE ONE PLACE THAT SAYS WHETHER TODAY WORKED (27 Aug 2026)
# ----------------------------------------------------------
# This job runs unattended and reports into .sync.log, which is 116,000 lines long. On 26 and
# 27 Aug the Cloudflare build failed both mornings and nothing said so anywhere a person
# would look: the run itself was green, because from here a push looks like a success.
#
# So the run now records its own verdict in a file the admin dashboard reads, and the
# dashboard leads with it. The contract is deliberately small — a state, a step, a sentence —
# because the point is one glance answering "is my attention needed", not a second log.
#
# Not committed (see .gitignore). It is machine-local state about THIS Mac's last run, the
# same category as .sync-stamp, and on a fresh checkout its absence correctly reads as
# "no run yet" rather than as someone else's stale verdict.
STATUS_FILE="$(dirname "$0")/../.publish-status.json"
status() {                       # status <state> <step> <message...>
  local state="$1" stage="$2"; shift 2
  local msg="$*"
  printf '{"state":"%s","step":"%s","message":"%s","at":"%s","date":"%s"}\n' \
    "$state" "$stage" "${msg//\"/\'}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%Y-%m-%d)" \
    > "$STATUS_FILE"
}

# set -e means most failures leave through here, so the trap is what makes the dashboard
# honest about a run that died at step 4 rather than only about the ones that finish. It
# records the LAST step announced, which is the failing one.
CURRENT_STEP="starting"
trap 'code=$?; [ $code -ne 0 ] && status failed "$CURRENT_STEP" "the run stopped here — see .sync.log"; exit $code' EXIT

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

step "1/14 sync from Vinted"
node scripts/sync-vinted.mjs $FULL

# GOVINDA, ONCE A WEEK (25 Aug 2026).
#
# Govinda is retail stock on someone else's website, so the questions are "what is new" and
# "what has gone", and both are weekly questions — their catalogue does not move hourly and
# their server should not be scraped as though it did. It is one request every two seconds
# against a robots.txt-permitted path, under a User-Agent that names this site, by written
# agreement with the vendor.
#
# Sunday, and only on the day's FIRST successful run, because --if-needed already guarantees
# that. If the Mac is off all Sunday the week is skipped rather than doubled up on Monday:
# a scrape that runs a day late tells you exactly what a scrape that runs on time does, and
# "catch up on missed weeks" is a queue with nothing in it.
#
# Nothing here decides anything. build-listings.mjs writes the four change lists into
# changes.json for the dashboard, carries any SKU that vanished from their catalogue forward
# as out of stock rather than dropping it, and never touches data/overrides.json — which is
# where your own decisions live, including sold, which no vendor can know.
if [ "$(date +%u)" = "7" ] && [ -z "$LOCAL" ]; then
  step "1b/14 weekly Govinda sync"
  node vendors/govinda/scrape.mjs
  node vendors/govinda/build-listings.mjs
  # Photographs, in two passes: download what is genuinely new, then composite it onto the
  # backdrop the rest of the grid uses. A product with no lead image on disk is held back by
  # scripts/vendor-items.mjs rather than published as an empty card, so a failure in either
  # of these costs a week's delay on new arrivals and nothing else.
  node vendors/govinda/fetch-images.mjs
  node vendors/govinda/compose-images.mjs
else
  echo "(not Sunday — skipping the weekly Govinda sync)"
fi

step "2/14 derive responsive images"
node scripts/build-images.mjs

# The chrome — header and footer — lives in index.html and is copied from there into the
# hand-written pages that are not generated (404.html, clothes.html). It was in NEITHER
# pipeline until 17 Aug 2026 and had to be remembered by hand, which meant a footer edit
# reached ten generated pages automatically and silently skipped those two. It runs FIRST
# because it maintains the outer shell every later generator reads out of index.html.
step "3/14 sync the chrome into the hand-written pages"
node scripts/sync-chrome.mjs

step "3b/14 give any new node a featured photograph"

# Fills the gaps in data/featured.json and nothing else — a node you chose a photo for in the
# admin dashboard is marked `by: "you"` and is never touched (see pick-featured.mjs). It runs
# BEFORE build-shop because build-shop reads the file for the homepage tiles.
#
# On the Mac only, and that is not an oversight: this WRITES a data file, and a Cloudflare
# build's writes are thrown away with the container. The file is committed by step 13 like
# every other piece of data, so the cloud build reads exactly what was decided here.
node scripts/pick-featured.mjs

step "4/14 build shop pages"
node scripts/build-shop.mjs

# Added 17 Aug 2026. It was never in this script — the Diaries was built by hand — which was
# tolerable while that page was a hub of cards and became a bug the moment it started holding
# the writing itself: a post edited in data/posts.json or content/ would not have reached the
# site until somebody remembered to run one command. AFTER build-shop, because it lifts the
# header and footer out of index.html and build-shop rewrites index.html's own regions.
step "5/14 build the diaries"
node scripts/build-diaries.mjs

# Everything readable on the English pages is now written, which is the earliest this can
# run: scripts/translate.mjs extracts its source strings FROM the built pages. It is also
# the only step that talks to DeepL, and the only one that needs .env — which is why it
# lives here and not in build-dist.mjs's generator list, where a cloud build with no keys
# would hit it.
#
# Running out of quota is not a failure here. translate.mjs records the shortfall in
# data/i18n/status.json, exits 0, and the language trees below are simply built with more
# English in them — visible on the dashboard, invisible to a visitor beyond the language.
step "6/14 translate what is new"
node scripts/translate.mjs

step "7/14 build local inventory view"
node scripts/build-inventory.mjs

step "8/14 inject JSON-LD"
node scripts/build-jsonld.mjs

# AFTER build-jsonld, because it mirrors the finished English pages including their
# structured data, and BEFORE build-sitemap, which lists the URLs it writes.
step "9/14 build the language trees"
node scripts/build-i18n.mjs

step "10/14 build sitemap"
node scripts/build-sitemap.mjs

step "11/14 bump asset cache tokens"
node scripts/bump-assets.mjs

step "12/14 stage dist/"
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

step "13/14 commit what is about to be published"

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
# 'images' replaced 'images/derived' on 3 Sep 2026, and it is not a widening for tidiness:
# build-images.mjs builds the derivative manifest by ITERATING the source .jpgs, so a cloud
# build with the derivatives but not the originals writes a manifest missing every new
# photo. That is the same failure class as the vendors/govinda/images/ break on 27 Aug —
# present on disk, absent from the commit. The originals were already tracked (611 of them);
# what was missing was any step that committed the NEW ones, so every morning left them
# behind for a hand commit. inventory.html and *.cards left the repo the same day, so the
# ':!inventory.html' exclusion below is now belt and braces rather than the only guard.
PUBLISHED=( '*.html' ':!inventory.html' '*.txt' sitemap.xml assets images edge data content )

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
fi

step "13b/14 prove the commit builds from committed bytes alone"

# The pre-push hook runs this too, and would catch the same thing a second later. Calling it
# here anyway is deliberate: this job runs unattended at 07:15, and a failure inside a hook
# surfaces as a one-line "pre-push hook declined" at the bottom of a launchd log. Here it
# prints as a numbered step, in the run's own output, with the failing build above it.
#
# It also fails BEFORE the commit is pushed rather than during the push, which keeps this
# script's own rule intact: git and the edge stay in step, both on yesterday.
#
# See scripts/check-clean-build.sh. Roughly 15s, and it is the only thing standing between a
# gitignored input and a silently wrong deploy — which is exactly how 27 Aug 2026 went.
if [ -z "$LOCAL" ]; then
  ./scripts/check-clean-build.sh HEAD || {
    echo "⚠ the commit does not build from committed files alone — NOT pushing" >&2
    exit 1
  }
fi

step "14/14 push, and let Cloudflare build it"

# ONE DEPLOY PATH, NOT TWO (25 Aug 2026).
#
# This step used to run `wrangler deploy` from here and deliberately NOT push, so that the
# Mac and Workers Builds could never deploy the same commit twice. It worked, and it cost:
#   · an API token on this Mac, in the Keychain, scoped or not;
#   · a silent split between what git holds and what the edge serves;
#   · and on 25 Aug 2026 it simply stopped — wrangler authenticated against the wrong
#     Cloudflare account and returned `Authentication error [code: 10000]`. Because the
#     stamp is written after the deploy, every hourly trigger then re-ran the entire
#     pipeline into the same error, about two dozen times, and the site sat on the 24th.
#
# So the push IS the deploy now. The repo is connected to Cloudflare Workers Builds, whose
# build command regenerates the site from committed data and serves the result. That is
# safe precisely because build-dist.mjs's GENERATORS list reads nothing but committed files
# — data/*.json, content/, the image manifest — so a cloud build reproduces a Mac build
# exactly. The three steps that CANNOT move to the cloud (the Vinted session handshake from
# a residential IP, ImageMagick over 408 MB of camera originals, and the DeepL key) have
# already run above, and their output is in the commit being pushed.
#
# What this buys: no token here, no second deploy path, and git as the single record of
# what is live. What it costs: about a minute of Cloudflare build time before a change is
# visible, instead of wrangler's direct upload.
if git push origin "${GIT_BRANCH}"; then
  echo "pushed ${GIT_BRANCH} — Cloudflare Workers Builds is building it now"
else
  echo "⚠ push failed — nothing was deployed; the commit is still here and can be pushed by hand" >&2
  exit 1
fi

# WAIT FOR THE EDGE TO SERVE *THIS* COMMIT (rewritten 27 Aug 2026)
#
# What was here polled for a 200 from /wardrobe and printed "live origin healthy". That
# sentence was true and worthless, and it cost two days. On the 26th and the 27th the
# Workers build failed; the edge went on serving the 25th's bytes, answered 200 to every
# poll, and the run declared itself healthy and pinged Seznam, Yandex and Bing about pages
# that had not changed. Live sat five items behind and nobody was told.
#
# A push is not a deploy. The only question worth asking the edge is "are you serving the
# commit I just pushed", and the answer is /build-id.txt, written last by build-dist.mjs
# after every check in it has passed (see the block that writes it).
#
# cache-busted with ?t=: the marker is a static asset on a CDN, and asking Cloudflare for a
# cached copy of the answer to "have you updated yet" is a question that answers itself
# wrong. Five minutes at ten-second intervals — a Workers build of this site takes about
# one, so a timeout here is a real failure and not impatience.
PUSHED_SHA="$(git rev-parse HEAD)"
printf 'waiting for the edge to serve %s' "$(git rev-parse --short HEAD)"
LIVE_SHA=""
for _ in $(seq 1 30); do
  sleep 10
  printf '.'
  LIVE_SHA="$(curl -fsS "https://guldaarbazaar.com/build-id.txt?t=$(date +%s)" 2>/dev/null | tr -d '[:space:]' || true)"
  [ "$LIVE_SHA" = "$PUSHED_SHA" ] && break
done
printf '\n'

if [ "$LIVE_SHA" = "$PUSHED_SHA" ]; then
  echo "live: guldaarbazaar.com is serving $(git rev-parse --short HEAD)"

  # NOT fatal, and the reason is a bug this caused. IndexNow is a NOTIFICATION: it tells
  # Bing and Seznam that URLs changed, after a deploy that has already succeeded and been
  # health-checked. It has been answering 403 UserForbiddedToAccessSite for days.
  #
  # Under `set -e` that non-zero exit aborted the script one line before the stamp — and the
  # stamp is what makes --if-needed no-op for the rest of the day. So every hourly trigger
  # found an unstamped date, ran a full sync, rebuilt every page, committed and deployed
  # again: twenty-four publishes a day, each one green, none of them stamping. The site was
  # never broken; the pipeline was retrying a ping.
  #
  # A notification failing must never cost a deploy. It is reported and the run continues.
  node scripts/indexnow.mjs || echo "⚠ IndexNow submission failed — deploy is live, crawlers were not pinged" >&2

  # Stamped HERE and nowhere else: after the deploy is up and the live site has answered.
  # Anything that stops the run short leaves the stamp on yesterday, which is what turns
  # the hourly trigger into a retry instead of a silent daily miss. Never stamped for
  # --local, which deploys nothing.
  echo "$TODAY" > "$STAMP"
  echo "stamped $TODAY — the launchd triggers will now no-op until tomorrow"
  status ok "14/14 deployed" "live is serving today's catalogue ($(git rev-parse --short HEAD))"
else
  # The push happened and the commit is safe; what failed is Cloudflare turning it into a
  # site. Do NOT stamp: an unstamped date is what makes the hourly trigger retry, and a
  # retry is the right response to a build that timed out or a Workers outage.
  #
  # The message names what a person can actually do about it, because this is the sentence
  # the dashboard shows and it is all they will read.
  SEEN="${LIVE_SHA:0:7}"; [ -n "$SEEN" ] || SEEN="no build marker at all"
  echo "⚠ the edge is not serving ${PUSHED_SHA:0:7} after five minutes (it has ${SEEN}) — skipping IndexNow" >&2
  status failed "14/14 deploy not confirmed" \
    "Cloudflare did not build it: pushed ${PUSHED_SHA:0:7}, the live site still serves ${SEEN}. Open the Cloudflare build log. Your commit is safe and the next hourly run retries."
  exit 1
fi
