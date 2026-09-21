# apps/site

The public marketing site: https://web-azure-five-fohgv9130t.vercel.app

It shares no workspace packages and touches no database, so it builds and
deploys on its own. That is deliberate — the app in `apps/web` needs Postgres
and a worker running ffmpeg, Python and a headless Chromium, none of which a
static host provides.

- `/` states the problem and what one profile produces.
- `/demo` plays the **real** files a promo run produced, next to the
  `CREATIVE_DIRECTION.md` and storyboard JSON that produced them.

## Refreshing the demo with a new run

```bash
pnpm exec tsx scripts/run-promo.ts <productId> 24     # from the repo root
apps/site/scripts/stage-demo.sh storage/promo/<projectId>
```

Demo media is gitignored: it is generated output, and re-encoding it is one
command. Run the staging script before deploying.

## Deploying

```bash
vercel --global-config ~/.vercel-accounts/rashiqxd deploy --prod --yes
```
