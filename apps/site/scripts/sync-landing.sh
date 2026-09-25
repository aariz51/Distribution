#!/usr/bin/env bash
# Copy the landing page from apps/web into this static site.
#
# apps/web owns the landing (components, styles, showcase media). This site is
# the same page without the app behind it: no database, no sessions. The only
# file that differs is src/lib/app-links.ts, which points the calls to action
# at the hosted app (NEXT_PUBLIC_APP_URL) instead of local routes.
#
#   ./scripts/sync-landing.sh
set -euo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$SITE/../web"

rm -rf "$SITE/src/components/landing" "$SITE/public/showcase"
mkdir -p "$SITE/src/components"
cp -R "$WEB/src/components/landing" "$SITE/src/components/landing"
cp "$WEB/src/components/PlatformIcon.tsx" "$SITE/src/components/PlatformIcon.tsx"
cp -R "$WEB/public/showcase" "$SITE/public/showcase"
cp "$WEB/src/app/globals.css" "$SITE/src/app/globals.css"
cp "$WEB/src/app/favicon.ico" "$WEB/src/app/icon.svg" "$SITE/src/app/"
cp "$WEB/src/app/privacy/page.tsx" "$SITE/src/app/privacy/page.tsx"

# The app's Wordmark lives in its AppShell; here it stands alone.
grep -rl '@/components/AppShell' "$SITE/src" | xargs sed -i.bak 's#@/components/AppShell#@/components/Wordmark#g'
find "$SITE/src" -name '*.bak' -delete

# The landing route itself, minus the session lookup.
sed -e '/import { getSession } from "@\/lib\/auth";/d' \
    -e 's/const signedIn = Boolean(await getSession());/const signedIn = false;/' \
    -e 's/export default async function LandingPage/export default function LandingPage/' \
    -e '/export const dynamic = "force-dynamic";/d' \
    "$WEB/src/app/page.tsx" > "$SITE/src/app/page.tsx"

echo "landing synced from apps/web"
