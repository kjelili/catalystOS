# Deploying Catalyst OS Backend to Vercel

This package deploys the backend API as a Vercel Serverless Function.

## 1) Create a Vercel project

- In Vercel, import this repository.
- Set **Root Directory** to `backend`.
- Framework preset: **Other**.

## 2) Environment variables

Set at minimum:

- `NODE_ENV=production`
- `API_PREFIX=/api/v1`
- `DATABASE_URL=<postgres-connection-string>`
- `JWT_SECRET=<strong-random-secret>`
- `JWT_EXPIRY=7d`
- `BCRYPT_ROUNDS=12`
- `RATE_LIMIT_WINDOW_MS=900000`
- `RATE_LIMIT_MAX_REQUESTS=100`

Optional platform keys:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `INSTAGRAM_ACCESS_TOKEN`
- `LINKEDIN_ACCESS_TOKEN`
- `X_API_KEY`
- `X_API_SECRET`
- `YOUTUBE_API_KEY`

## 3) Deploy

Click Deploy in Vercel.

## 4) Verify endpoints

- `GET /healthz`
- `GET /readyz`
- `GET /api/v1/auth/me` (with valid bearer token)

## Important limitations

- If `DATABASE_URL` is not set, backend falls back to local SQLite file.
- On Vercel without `DATABASE_URL`, SQLite uses ephemeral storage (`/tmp/catalyst.db`) and is not durable.
- Cron jobs are not running in this serverless deployment. Use Vercel Cron or an external scheduler.
