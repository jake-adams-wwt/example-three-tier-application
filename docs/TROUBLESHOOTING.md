# Troubleshooting Guide

Common problems when running this three-tier app (Next.js web, Express API, PostgreSQL) and how to fix them. Each entry lists the **symptom**, the likely **cause** and the **fix** commands.

## Table of contents

- [Quick reference](#quick-reference)
- [First steps for any problem](#first-steps-for-any-problem)
- [Startup failures](#startup-failures)
- [Database connection errors](#database-connection-errors)
- [API 4xx and 5xx errors](#api-4xx-and-5xx-errors)
- [Frontend build problems](#frontend-build-problems)
- [docker-compose issues](#docker-compose-issues)
- [Resetting everything](#resetting-everything)

## Quick reference

| Item | Value |
|------|-------|
| Compose services | `postgres`, `migrate`, `api`, `web` |
| Web (host-exposed) | `http://localhost:3000` |
| API (internal only) | `http://api:3001` inside the Compose network |
| Database | PostgreSQL 17, db/user/password all `app` |
| Connection string | `DATABASE_URL=postgres://app:app@postgres:5432/app` |
| Web to API URL | `API_URL=http://api:3001` (falls back to `http://localhost:3001`) |
| Migrations | `node-pg-migrate` in `src/db/migrations/` |
| API tests | `cd src/api && npm test` |
| Web lint / build | `cd src/web && npm run lint` / `npm run build` |

## First steps for any problem

```bash
# 1. Which services are running, restarting or exited?
docker compose ps -a

# 2. Read recent logs for everything, or for one service
docker compose logs --tail=100
docker compose logs --tail=100 api

# 3. Validate the Compose file
docker compose config --quiet && echo "compose file OK"
```

Startup order is `postgres` (healthy) -> `migrate` (completed successfully) -> `api` -> `web`. A failure early in the chain stops everything after it, so always find the **first** failing service.

## Startup failures

### `docker compose up` stops and `api` / `web` never start

**Symptom:** `docker compose ps -a` shows `migrate` as `Restarting` or `Exited (1)`, and `api` and `web` stay in `Created`.

**Cause:** `api` waits for `migrate` with `condition: service_completed_successfully`. If migrations fail, the API never starts.

**Fix:**

```bash
docker compose logs migrate
```

Fix the reported error (usually a database or migration issue, see [Database connection errors](#database-connection-errors)), then:

```bash
docker compose up --build
```

### `postgres` is `unhealthy`

**Symptom:** `dependency failed to start: container ... postgres is unhealthy`.

**Cause:** The healthcheck (`pg_isready -U app -d app`, 5 retries every 5 seconds) did not pass. Common reasons are a corrupt or incompatible data volume, low disk space or a port/permission problem.

**Fix:**

```bash
docker compose logs postgres
df -h

# If the volume came from a different Postgres major version or is corrupt (deletes data):
docker compose down -v
docker compose up --build
```

### API exits immediately with `Cannot find module`

**Symptom:** `api` logs show `Error: Cannot find module 'express'` or `'pg'`.

**Cause:** Dependencies are missing from the image. The API image runs `npm ci --omit=dev`, so a stale image or a `package.json` / `package-lock.json` mismatch can leave modules out.

**Fix:**

```bash
cd src/api
npm install            # regenerates package-lock.json if out of sync
cd ../..
docker compose build --no-cache api
docker compose up
```

## Database connection errors

### `ECONNREFUSED` to the database

**Symptom:** `Error: connect ECONNREFUSED 127.0.0.1:5432` or `... ::1:5432` in the `api` or `migrate` logs.

**Cause:** `DATABASE_URL` is unset or points at `localhost`. Inside a container `localhost` is the container itself, not Postgres.

**Fix:** Use the Compose service name as host:

```bash
docker compose exec api printenv DATABASE_URL
# expected: postgres://app:app@postgres:5432/app
```

If it is wrong, correct `DATABASE_URL` in `docker-compose.yml` and run `docker compose up -d --force-recreate api migrate`.

### `password authentication failed for user "app"`

**Symptom:** `error: password authentication failed for user "app"` (SQLSTATE `28P01`).

**Cause:** `POSTGRES_PASSWORD` is only applied when the data directory is first created. If the `postgres_data` volume was created with a different password, changing the Compose file has no effect.

**Fix:** Either restore the original credentials, or recreate the volume (deletes data):

```bash
docker compose down -v
docker compose up --build
```

### `relation "tasks" does not exist`

**Symptom:** `GET /tasks` returns `500` and the `api` log shows `error: relation "tasks" does not exist` (SQLSTATE `42P01`).

**Cause:** Migrations have not run against this database, for example when the API was started alone or `migrate` was skipped.

**Fix:**

```bash
docker compose run --rm migrate
docker compose exec postgres psql -U app -d app -c '\dt'
```

You should see `tasks` and `pgmigrations`.

### Migration fails or keeps restarting

**Symptom:** `migrate` is stuck in a restart loop (`restart: on-failure`) with errors such as `Not run migration ... is preceding already run migration ...`.

**Cause:** Migrations are append-only. Editing, renaming or inserting a migration with an earlier timestamp than one already applied breaks the ordering check.

**Fix:** Never edit applied migrations; add a new file with a newer timestamp prefix. In a dev database you can start over:

```bash
docker compose down -v
docker compose up --build
```

To inspect state or roll back one step manually (needs Postgres published on the host, see below):

```bash
docker compose exec postgres psql -U app -d app -c 'SELECT * FROM pgmigrations;'
cd src/db
DATABASE_URL=postgres://app:app@localhost:5432/app npx node-pg-migrate down
```

### Cannot connect from the host to Postgres

**Symptom:** `psql -h localhost -U app app` fails with connection refused.

**Cause:** The `postgres` service does not publish a port; it is only reachable from inside the Compose network.

**Fix:** Use `exec`, or temporarily add a port mapping in `docker-compose.yml` (do not commit it):

```bash
docker compose exec postgres psql -U app -d app
```

```yaml
  postgres:
    ports:
      - "5432:5432"
```

## API 4xx and 5xx errors

The API is internal, so call it from inside the network, or temporarily publish port 3001 on the `api` service. Examples below use `docker compose exec` (the Alpine image ships `wget`):

```bash
docker compose exec api wget -qO- http://localhost:3001/health
# {"status":"ok"}
```

### 400 `title is required`

**Symptom:** `POST /tasks` returns `400 {"error":"title is required"}`.

**Cause:** The body has no `title`, the title is not a string, or it is empty/whitespace. A missing `Content-Type: application/json` header also leaves `req.body` without a title.

**Fix:**

```bash
curl -i -X POST http://localhost:3001/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Write docs"}'
```

### 400 `invalid id`

**Symptom:** `PATCH` or `DELETE /tasks/:id` returns `400 {"error":"invalid id"}`.

**Cause:** The id is not a plain positive integer, or is outside the Postgres `int4` range (`1` to `2147483647`). Values like `abc`, `-1`, `0` or `1.5` are rejected.

**Fix:** Use the numeric `id` returned by `GET /tasks`:

```bash
curl -s http://localhost:3001/tasks
curl -i -X PATCH http://localhost:3001/tasks/1 \
  -H 'Content-Type: application/json' -d '{"completed":true}'
```

### 404 `Not found`

**Symptom:** `PATCH` or `DELETE /tasks/:id` returns `404 {"error":"Not found"}`.

**Cause:** No task has that id. It may have been deleted, or the database was reset (`docker compose down -v`). Note that the web tier treats a `404` on delete as success.

**Fix:**

```bash
curl -s http://localhost:3001/tasks   # list valid ids
```

### 500 Internal Server Error

**Symptom:** Any route returns `500`, often with an HTML error page.

**Cause:** A route handler threw, usually a database error (Express 5 forwards rejected async handlers to its default error handler). Typical triggers are a lost database connection, a missing table, or a title longer than 500 characters (`varchar(500)` column, SQLSTATE `22001`).

**Fix:**

```bash
docker compose logs --tail=50 api     # find the stack trace and SQLSTATE
docker compose ps postgres            # is the database healthy?
docker compose restart api
```

If the log says `value too long for type character varying(500)`, shorten the title or add a migration to widen the column.

### 502 / 503 / `fetch failed` from the web tier

**Symptom:** The page shows the error boundary ("Something went wrong") or the web logs contain `TypeError: fetch failed` / `ECONNREFUSED`.

**Cause:** The web server cannot reach the API: the API crashed, has not started yet, or `API_URL` is wrong.

**Fix:**

```bash
docker compose ps api
docker compose exec web printenv API_URL      # expect http://api:3001
docker compose exec web wget -qO- http://api:3001/health
docker compose up -d api
```

## Frontend build problems

### `npm run build` fails with TypeScript errors

**Symptom:** `Type error: ...` during `next build`.

**Cause:** Next.js type-checks during the build, so type errors fail it even if `next dev` worked.

**Fix:**

```bash
cd src/web
npx tsc --noEmit
npm run build
```

### `Module not found` or missing dependencies

**Symptom:** `Module not found: Can't resolve 'next/...'` or similar.

**Cause:** `node_modules` is missing or stale (for example after switching branches).

**Fix:**

```bash
cd src/web
rm -rf node_modules .next
npm ci
npm run build
```

### Docker build fails at `COPY --from=builder /app/.next/standalone`

**Symptom:** `failed to compute cache key: "/app/.next/standalone": not found`.

**Cause:** The standalone output is produced only when `output: "standalone"` is set in `src/web/next.config.ts`. If it was removed, or `npm run build` failed or was skipped, the folder does not exist.

**Fix:** Make sure `next.config.ts` still contains `output: "standalone"`, then:

```bash
cd src/web && npm run build && ls .next/standalone
cd ../.. && docker compose build web
```

## docker-compose issues

### `port is already allocated` / `address already in use`

**Symptom:** `Bind for 0.0.0.0:3000 failed: port is already allocated`.

**Cause:** Something else on the host is using port 3000.

**Fix:**

```bash
lsof -i :3000                 # macOS / Linux
docker ps --filter publish=3000
```

Stop the other process, or change the host side of the mapping in `docker-compose.yml` (for example `"3100:3000"`) and open `http://localhost:3100`.

### Changes to code or environment are ignored

**Symptom:** The container still behaves as before after editing source or `docker-compose.yml`.

**Cause:** Images are cached and containers are reused. No source is bind-mounted, so code changes need a rebuild.

**Fix:**

```bash
docker compose up --build
docker compose build --no-cache api   # force a clean build of one service
docker compose up -d --force-recreate
```

### Stale data or schema from an earlier run

**Symptom:** Old tasks reappear, or credentials/database settings do not take effect.

**Cause:** Data lives in the named volume `postgres_data`, which survives `docker compose down`.

**Fix:**

```bash
docker compose down -v     # removes containers AND the postgres_data volume
docker compose up --build
```

### The API is not reachable from the host

**Symptom:** `curl http://localhost:3001/health` fails.

**Cause:** By design: `api` uses `expose`, not `ports`, so it is reachable only inside the Compose network.

**Fix:** Use `docker compose exec api wget -qO- http://localhost:3001/health`, or temporarily add `ports: ["3001:3001"]` to the `api` service.

## Resetting everything

When nothing else works, wipe the local environment and start fresh. **This deletes all local database data.**

```bash
docker compose down -v --remove-orphans
docker compose build --no-cache
docker compose up
```

Then check:

```bash
docker compose ps -a
curl -I http://localhost:3000
```

If the problem persists, collect `docker compose ps -a` and `docker compose logs --tail=200` and include them when opening an issue.
