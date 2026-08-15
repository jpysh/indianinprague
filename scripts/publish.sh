#!/usr/bin/env bash
# Publish the site: pull the closet, rebuild every generated artefact, upload to Cloudflare
# Pages, tell the search engines.
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
  echo "serve with: npx wrangler pages dev dist"
  echo "inventory:  open ./inventory.html directly — it is not in dist/ by design"
  exit 0
fi

step "9/9 deploy to Cloudflare Pages"

# The deploy token comes from the macOS Keychain, not from a file and not from the launchd
# plist. The plist lives in scripts/ and its EnvironmentVariables are world-readable to
# anything that can read the repo; a token there would be a credential checked in beside the
# code. Keychain keeps it encrypted at rest and out of every backup of this directory.
#
# One-time setup:
#   security add-generic-password -a "$USER" -s indianinprague-cf-token -w
#     (paste the token at the prompt — it does not appear in shell history that way)
#
# The token itself is scoped to Pages:Edit on this one project. It cannot touch DNS, the
# zone, Workers or the other tunnels on this account, so the worst case if it leaks is a
# defaced indianinprague.jains.es and not a lost domain. That scoping is the real control
# here; everything else is depth.
if ! CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s indianinprague-cf-token -w 2>/dev/null); then
  echo "⚠ no Cloudflare token in the Keychain — add it with:" >&2
  echo "    security add-generic-password -a \"\$USER\" -s indianinprague-cf-token -w" >&2
  exit 1
fi
export CLOUDFLARE_API_TOKEN

# ./node_modules/.bin/wrangler, NOT npx wrangler. npx resolves the latest version from the
# npm registry at run time, and this script runs unattended with the token above already in
# the environment — a newly published (or newly compromised) wrangler, or any of its 37
# transitive dependencies, would execute here before anyone saw it. The version is pinned in
# package.json and locked in package-lock.json; upgrading is a decision, not a sunrise.
if [ ! -x ./node_modules/.bin/wrangler ]; then
  echo "⚠ wrangler is not installed — run: npm ci" >&2
  exit 1
fi

# Direct upload: wrangler hashes every file and sends only the ones the project does not
# already have, so a normal day pushes the rebuilt HTML and the morning's new photos, not
# 171 MB. --commit-dirty because there is no git repo here; the deploy is the record.
./node_modules/.bin/wrangler pages deploy dist \
  --project-name=indianinprague \
  --branch=main \
  --commit-dirty=true

# Confirm the live site is actually serving this build before inviting crawlers to it.
# Checking the real hostname rather than a local port is the point: it exercises DNS, the
# Pages custom domain and the edge, which is the whole surface that replaced nginx.
if curl -fsS -o /dev/null "https://indianinprague.jains.es/wardrobe.html"; then
  echo "live origin healthy"
  node scripts/indexnow.mjs
else
  echo "⚠ indianinprague.jains.es did not answer — skipping IndexNow so crawlers are not sent to a broken build" >&2
  exit 1
fi
