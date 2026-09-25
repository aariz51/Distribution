# Application runtime

Distribution needs a long-running Node web process, a separate media worker, Postgres, and shared persistent media storage. Deploying `apps/site` or only the web process does not deploy video processing. The current storage implementation supports a local filesystem; web and worker must see the same files at the same absolute `STORAGE_ROOT`. Do not use an ephemeral serverless filesystem for generated media.

## Install and start

Use Node 22.12 or newer and the pnpm version in `package.json`. Keep the complete workspace and vendored assets available to the worker. Workspace packages export TypeScript source; the worker currently runs through `tsx`, so install development dependencies as well as production dependencies.

```sh
pnpm install --frozen-lockfile
python3.12 -m venv .venv
.venv/bin/python -m pip install -r vendor/autoshorts-py/requirements.txt
uv venv --python python3.11 .venv-screen
uv pip install --python .venv-screen/bin/python -r vendor/screening/requirements.txt
python3 scripts/setup-screening.py
```

Install FFmpeg/FFprobe and ensure they are on PATH. The Python environment supplies yt-dlp. Set absolute `PYTHON_BIN`, `YTDLP_BIN`, `STORAGE_ROOT` and optional `SCRATCH_ROOT` in the repository-root `.env`. Python 3.12+ handles media. Female synthetic outro speech uses `TTS_PROVIDER=openrouter` (Thalia) or `openai` (Coral); configure the matching API key. The application does not clone the source speaker. The no-people B-roll policy also needs its detection model cache. First use can download those models and the pinned renderer checkout; account for network access and disk capacity.

Source and finished-clip screening additionally requires the isolated Python3.11 environment above and the pinned model downloads. Keep that environment separate: its TensorFlow/OpenCV/NumPy versions differ from the media sidecars. Set `SCREENING_PYTHON_BIN` to its absolute interpreter path if it is not at the workspace default `.venv-screen/bin/python`. Persist the model caches, or set `SCREENING_MODEL_DIR` and `SCREENING_VISUAL_MODEL_DIR` to persistent locations before setup and in both application processes. Missing models block clipping; they are not optional. See `vendor/screening/README.md` for the policy and model provenance.

Set `DATABASE_URL`, `APP_SECRET` and `APP_PASSWORD` before starting, and run migrations (`pnpm --filter @distribution/db migrate`), which include `0003_workspace_owner`. Never commit `.env`. Export `DATABASE_URL` into the migration command's environment through your secret manager; migrations do not load `.env` automatically. Back up the database and storage before upgrading.

```sh
pnpm --filter @distribution/db migrate
pnpm --filter @distribution/web build
pnpm --filter @distribution/web start
```

In a separate supervised process with the same configuration:

```sh
WORKER_QUEUES=light,media,llm,render pnpm --filter @distribution/worker start
```

The example intentionally runs video generation queues. Add the `publish` queue when the operator has configured Postiz and intends to execute approved schedules. Without `WORKER_QUEUES`, the worker polls every queue, including publishing. Use a process supervisor to restart crashed services and deliver SIGTERM for graceful shutdown. Termination grace must accommodate active job cleanup; do not assume cancelling a UI job means its subprocess has already exited.

For a small host, start with `WORKER_MEDIA_CONCURRENCY=1`, `WORKER_RENDER_CONCURRENCY=1`, and `WORKER_LLM_CONCURRENCY=1`. Size scratch/storage capacity for concurrent input copies, intermediate renders and final outputs. Current disk preflight thresholds are minimums, not capacity planning. The QA host recently hit the render free-space guard at about 2 GiB available.

## Workspaces and sign-up

Anyone can create a workspace at `/signup` (set `SIGNUPS=closed` to make the installation invite only). Each workspace is separate: products, media, jobs, channels and usage belong to it alone.

- **Sign-in** checks each user's own argon2 hash. `APP_PASSWORD` only creates the owner workspace and its first user on a fresh database; once an owner exists it grants nothing.
- **Owner workspace** (`accounts.is_owner`) is the only one that adopts `POSTIZ_API_KEY` from the environment. Every other workspace pastes its own Postiz key on `/channels`; the key is checked against Postiz before it is stored encrypted.
- **Channels** are added from `/channels` with each platform's own sign-in (Postiz `GET /public/v1/social/:provider`). The OAuth callback lands on Postiz, so the page polls for the new channel.
- **Spending**: signed-up workspaces share a monthly AI cap (`DEFAULT_ACCOUNT_MONTHLY_USD`, default 10) across all their products, on top of the per-product cap. Override per workspace with a `limits` row: `scope='account'`, `scope_id=<account id>`, `key='usd_month'`.
- **Attempt limits** on sign-in and sign-up live in the web process's memory. Run one web process, or move them to shared storage before scaling out.

Verify a deployment with `pnpm exec tsx scripts/test-workspaces.ts` (set `APP_URL`); it creates and removes throwaway workspaces.

## Before exposing the service

Run the production build and test the authenticated workflow against the actual deployed database, worker and storage mount. Verify upload, queue progress, generated-file playback and byte-range seeking, download, failure, retry and cancellation. A healthy database response alone does not prove worker readiness: inspect the live worker queues returned by `/api/health`. Put the web process behind HTTPS, restrict database access and retain encrypted backups of both database and media.

Provider calls reserve estimated spending against each product's `usd_month` limit, with `DEFAULT_PRODUCT_MONTHLY_USD` as the fallback. Unknown paid model rates fail before sending. Uncertain failures retain rows in `budget_reservations`; reconcile those against provider usage before releasing them. Do not blindly delete holds to clear a budget error. Estimates and retry allowances are not provider invoice guarantees.

## Current verification limits

Local SafeChoice promo and clipping runs have produced decoded, usable files. The audit in `production-video-audit-2026-09-21.md` records the exact runs and remaining gaps. This runbook is an operational contract, not proof that an external deployment has passed acceptance. Female speech has passed a real queued SafeChoice enrichment run and full output decode. Authenticated browser acceptance, uncertain Postiz submission reconciliation and external deployment verification still need completion.

## Inspecting uncertain provider charges

Run the read-only hold report from the repository root with your normal environment:

```sh
DOTENV_CONFIG_PATH="$PWD/.env" pnpm --filter @distribution/scripts exec tsx report-provider-holds.ts <product-uuid>
```

It lists reservation IDs, job status and recorded usage for that job. Do not release a hold while its job is active. For a terminal job, compare the provider's request-level billing evidence with the recorded usage first: a job can make several calls and an existing ledger charge may already include retries. Keep unresolved holds. The report deliberately does not guess actual costs or delete reservations. SafeChoice's main product currently has zero outstanding reservations; this observation is not a provider invoice reconciliation.

## Remotion bundle lifecycle
Production rendering keeps its isolated bundler worker (`packages/promo-kit/src/bundle-worker.mjs`) alongside the TypeScript workspace sources. Bundles live under an application-specific namespace in the OS temporary directory, are shared only while renders overlap, and are removed after the last consumer finishes. A later render can reclaim a crashed process's bundle only when the ownership marker matches this workspace/host and the PID is proven absent. Unmarked or foreign temporary directories are never deleted. Public inputs must remain immutable throughout a render, as they are in saved project snapshots.
