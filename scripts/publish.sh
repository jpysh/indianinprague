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
#   bump-assets must precede build-dist — it rewrites the ?v= token in the HTML, and
#               build-dist is what copies that HTML to the upload. Without a fresh token
#               Cloudflare keeps serving the old CSS at the edge; DEPLOY.md records a fix
#               that shipped correctly and stayed invisible for a day exactly this way.
#   build-dist  must precede the deploy — it is the definition of what is public, and the
#               only thing keeping scripts/, data/ and inventory.html off the internet.
#   indexnow    must follow the deploy, or it invites crawlers to fetch the previous build.
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
for arg in "$@"; do
  case "$arg" in
    --full)  FULL="--full" ;;
    --local) LOCAL="1" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "1/9 sync from Vinted"
node scripts/sync-vinted.mjs $FULL

step "2/9 derive responsive images"
node scripts/build-images.mjs

step "3/9 build shop pages"
node scripts/build-shop.mjs

step "4/9 build local inventory view"
node scripts/build-inventory.mjs

step "5/9 inject JSON-LD"
node scripts/build-jsonld.mjs

step "6/9 build sitemap"
node scripts/build-sitemap.mjs

step "7/9 bump asset cache tokens"
node scripts/bump-assets.mjs

step "8/9 stage dist/"
node scripts/build-dist.mjs

if [ -n "$LOCAL" ]; then
  printf '\n\033[1m-- local only: skipping deploy and IndexNow\033[0m\n'
  # Serve dist/ rather than the repo root, so what you check is what ships — including the
  # absence of inventory.html. Wrangler's dev server also applies _headers and _redirects,
  # which python3 -m http.server does not, so the CSP and the /shop.html 301 are testable.
  echo "serve with: ./node_modules/.bin/wrangler dev   # serves dist/ exactly as Cloudflare will"
  echo "inventory:  open ./inventory.html directly — it is not in dist/ by design"
  exit 0
fi

step "9/9 deploy to Cloudflare"

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
else
  echo "⚠ indianinprague.jains.es did not answer — skipping IndexNow so crawlers are not sent to a broken build" >&2
  exit 1
fi
