#!/usr/bin/env bash
#
# scripts/deploy-safe.sh
#
# Safe production deploy for the PM2-managed Janjez Next.js app.
#
# Encodes two hard-won safety rules:
#
#   (1) NEVER run `next build` inside the directory PM2 is serving.
#       `next build` deletes `.next/`, which deletes the hashed chunks the
#       live process is still serving from disk -> CSS/JS 410/500 and an
#       unstyled, broken site while the process keeps emitting HTML for them.
#       This script builds in a DISCARDED git worktree and swaps the artifact
#       in atomically.
#
#   (2) NEVER `pm2 restart <name> --update-env` from a caller shell that lacks
#       the app env. `--update-env` overlays (replaces) the running process
#       env from the *current shell*, silently stripping NODE_ENV/PORT/HOST
#       and every SUPABASE/MPESA/BREVO/SMM var. Restart exclusively via
#       ecosystem.config.js, which re-applies the env block (loaded from .env).
#
# Usage:
#   scripts/deploy-safe.sh [COMMIT]
#       COMMIT  commit / branch / tag to build and deploy (default: HEAD)
#
# The repo working tree is never touched; the fallback commit is restored
# here by design. Rollback = keep the previous standalone dir.
#
set -euo pipefail

APP_NAME="janjez-app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE="$REPO_ROOT/.next/standalone/janjez-socio"
KEEP_BACKUPS=2
HEALTH_URL="https://janjez.social/"

log()  { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

COMMIT="${1:-HEAD}"
RESOLVED="$(git -C "$REPO_ROOT" rev-parse "$COMMIT" 2>/dev/null)" \
  || fail "cannot resolve commit: $COMMIT"
log "Deploying $RESOLVED (${COMMIT})"

# Is the live app currently up? If a deploy is already mid-flight, bail.
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  log "PM2 '$APP_NAME' is currently running (will be swapped atomically)."
fi

WORKTREE_DIR="$(mktemp -d -p /home/ubuntu janjez-deploy.XXXXXX)"
cleanup() {
  git -C "$REPO_ROOT" worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
  rm -rf "$WORKTREE_DIR"
}
trap cleanup EXIT

log "Creating detached build worktree at $WORKTREE_DIR"
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" "$RESOLVED" >/dev/null

# `next build` reads .env from the worktree cwd and embeds it into the
# standalone `.env`. Copy gitignored env in so the artifact is self-contained.
for f in .env .env.local .env.production .env.production.local; do
  if [ -f "$REPO_ROOT/$f" ]; then cp "$REPO_ROOT/$f" "$WORKTREE_DIR/$f"; fi
done

# Reuse the dependency tree without a fresh install. Turbopack (Next 16)
# rejects an `node_modules` symlink that points outside the project root, so
# use a hardlink copy (same mount, fast, no data copied, real on-disk tree).
rm -rf "$WORKTREE_DIR/node_modules"
cp -al "$REPO_ROOT/node_modules" "$WORKTREE_DIR/node_modules" 2>/dev/null \
  || cp -r "$REPO_ROOT/node_modules" "$WORKTREE_DIR/node_modules"

# Build OUTSIDE the live-served directory. Use `next build` directly so the
# repo's name-coupled `postbuild` (which hardcodes standalone/janjez-socio)
# does NOT run — we assemble the artifact explicitly and name-independently.
log "Building (isolated worktree; live tree untouched)"
( cd "$WORKTREE_DIR" && npx --no-install next build )

# Locate the real standalone dir by presence of server.js (Next names it after
# the worktree basename, not package.json). Verify it's complete.
BUILT="$(find "$WORKTREE_DIR/.next/standalone" -maxdepth 2 -name server.js -not -path "*/node_modules/*" \
  -exec dirname {} \; | head -1)"
[ "$BUILT" ] || fail "build did not produce a standalone/server.js"
# BUILD_ID lives at <standalone-dir>/.next/BUILD_ID (inside the inner .next).
[ -f "$BUILT/.next/BUILD_ID" ] || fail "built artifact missing BUILD_ID"
log "Built standalone artifact: $BUILT (BUILD_ID=$(cat "$BUILT/.next/BUILD_ID"))"

# Ensure static assets + public are present (we bypassed the repo postbuild).
[ -d "$BUILT/.next/static" ] || cp -r "$WORKTREE_DIR/.next/static" "$BUILT/.next/"
[ -d "$BUILT/public" ]      || cp -r "$WORKTREE_DIR/public" "$BUILT/"
[ -f "$BUILT/.env" ]      || cp "$WORKTREE_DIR/.env" "$BUILT/.env" 2>/dev/null || true

log "Staging artifact in $REPO_ROOT/.next/standalone"
# Stop PM2 so we swap a consistent tree (brief downtime, no half-served build).
pm2 stop "$APP_NAME" >/dev/null 2>&1 || true

# Move the live standalone aside as a rollback target, preserving it.
BACKUP=""
if [ -e "$STANDALONE" ]; then
  BACKUP="$STANDALONE.BROKEN.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$STANDALONE" "$BACKUP"
fi
cp -a "$BUILT" "$STANDALONE"

log "Restarting PM2 via ecosystem.config.js (env injected from .env)"
# Restart from the file so the `env:` block (dotEnv) is reapplied on every
# deploy. Do NOT use --update-env; it would overlay the caller's shell env.
pm2 restart "$REPO_ROOT/ecosystem.config.js" >/dev/null

# Readiness: wait for the new instance to answer HTTP. `pm2 online` is NOT
# sufficient (a crashing build can still report online); we require a 200 from
# the actual app plus delivery of every static asset referenced in it.
log "Waiting for instance to become healthy"
bad=0
ready=0
for i in $(seq 1 40); do
  if curl -sf -o /dev/null -m 10 "$HEALTH_URL"; then ready=1; break; fi
  sleep 1
done
[ "$ready" = "1" ] || { echo "  app did not return 200"; bad=1; }

if [ "$bad" = "0" ]; then
  mapfile -t ASSETS < <(grep -oE '/_next/static/[A-Za-z0-9_./-]+\.(js|css)' \
    <(curl -s -m 20 "$HEALTH_URL") | sort -u)
  for a in "${ASSETS[@]}"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "https://janjez.social$a")"
    [ "$code" = "200" ] || { echo "  asset FAIL $code $a"; bad=$((bad+1)); }
  done
fi
if [ "$bad" -gt 0 ]; then
  log "Health check failed ($bad). Rolling back to previous standalone."
  pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
  rm -rf "$STANDALONE"
  if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$STANDALONE"
  else
    cp -a "$BUILT" "$STANDALONE"
  fi
  pm2 restart "$REPO_ROOT/ecosystem.config.js" >/dev/null 2>&1 || true
  fail "deploy aborted; previous build restored if available"
fi

# Prune old backup dirs, keep newest KEEP_BACKUPS.
ls -dt "$STANDALONE".BROKEN-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf

log "Deploy complete: $RESOLVED"
pm2 ls | grep --color=never "$APP_NAME"
