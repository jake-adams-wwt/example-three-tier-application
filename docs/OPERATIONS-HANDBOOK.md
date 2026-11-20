# Operations Handbook

Operations guide for `example-three-tier-application`: a Next.js web tier,
an Express API tier and a PostgreSQL database tier. It runs locally with
Docker Compose and deploys to GCP (Cloud Run + Cloud SQL) with Terraform.

Everything here is derived from the files in this repository:
`docker-compose.yml`, the Dockerfiles under `src/`, `src/api/index.js`,
`src/infrastructure/*.tf` and `.github/workflows/deploy.yml`.
Where the repo does not configure something (for example log shipping),
this handbook says so instead of inventing it.

## Contents

1. Architecture
2. Services and ports
3. Environment variables
4. Local setup
5. Deployment
6. Health checks
7. Logging
8. Backup and restore
9. Incident runbooks (RB-01 to RB-10)
10. FAQ (25 questions)

---

## 1. Architecture

```
Browser --> Web (Next.js :3000) --> API (Express :3001) --> PostgreSQL :5432
                                           ^
                       migrate (one-shot) -+
```

| Tier      | Technology                        | Source          |
|-----------|-----------------------------------|-----------------|
| Web       | Next.js 16, React 19, Tailwind 4  | `src/web/`      |
| API       | Express 5 on Node.js 22           | `src/api/`      |
| Database  | PostgreSQL 17                     | Docker / Cloud SQL |
| Migrations| node-pg-migrate 8                 | `src/db/`       |
| Infra     | Terraform (GCP)                   | `src/infrastructure/` |

### Request flow

1. The browser requests `/` from the web tier on port 3000.
2. The web tier uses server actions in `src/web/app/actions.ts`.
   They call the API at `API_URL` (`getTasks`, `createTask`,
   `toggleTask`, `deleteTask`).
3. The API runs SQL through a `pg` connection pool (`src/api/db.js`)
   configured only by `DATABASE_URL`.
4. PostgreSQL stores data in the `tasks` and `users` tables.

The browser never talks to the API directly. The API has no
authentication, so it must stay private.

### Data model

Created by the migrations in `src/db/migrations/`:

| Migration                                  | Creates |
|--------------------------------------------|---------|
| `1718500000000_initial-schema.js`          | `users` (id serial, email varchar(255) unique, created_at) |
| `1718500001000_create-tasks.js`            | `tasks` (id serial, title varchar(500), completed boolean default false, created_at) |

node-pg-migrate also keeps a `pgmigrations` table recording which
migrations have been applied.

### API endpoints

| Method | Path         | Behaviour |
|--------|--------------|-----------|
| GET    | `/health`    | Returns `{"status":"ok"}`; does not query the database |
| GET    | `/tasks`     | All tasks ordered by `created_at` ascending |
| POST   | `/tasks`     | Body `{"title": "..."}`; 400 if empty; 201 on success |
| PATCH  | `/tasks/:id` | Sets `completed`, renames, or toggles on empty body; 400 bad id, 404 missing |
| DELETE | `/tasks/:id` | 204 on success, 400 bad id, 404 missing |

### Production topology (GCP)

- VPC `todo-<env>-vpc` with subnet `todo-<env>-subnet`
  (default `10.0.0.0/24`).
- Serverless VPC Access connector `todo-<env>-connector`
  (default `10.0.1.0/28`, 2 to 10 instances, e2-micro).
- Cloud SQL `todo-<env>-postgres`, PostgreSQL 17, private IP only.
- Secret Manager secret `todo-<env>-db-url` holding `DATABASE_URL`.
- Cloud Run services `todo-<env>-api` and `todo-<env>-web`.
- Cloud Run job `todo-<env>-migrate`.
- Service account `todo-<env>-run` with `roles/cloudsql.client` and
  secret accessor on the DB URL secret.

`<env>` is `dev`, `staging` or `prod`; the prefix is
`<app_name>-<environment>` and `app_name` defaults to `todo`.

---

## 2. Services and ports

From `docker-compose.yml` (one named volume: `postgres_data`).

| Service    | Image / build        | Container port | Host port | Depends on | Restart |
|------------|----------------------|----------------|-----------|------------|---------|
| `postgres` | `postgres:17-alpine` | 5432 (not published) | none | none | default (`no`) |
| `migrate`  | build `./src/db`     | none           | none      | `postgres` healthy | `on-failure` |
| `api`      | build `./src/api`    | 3001 (`expose`) | none     | `migrate` completed successfully | default (`no`) |
| `web`      | build `./src/web`    | 3000           | 3000 (`3000:3000`) | `api` started | default (`no`) |

Notes:

- Only `web` is reachable from the host: `http://localhost:3000`.
- `postgres` (5432) and `api` (3001) are only reachable on the
  Compose network. To reach them from the host, use `docker compose exec`
  or add a temporary `ports:` mapping (see FAQ).
- `postgres` has a health check: `pg_isready -U app -d app`
  every 5s, timeout 5s, 5 retries.
- `api` and `web` have no Compose health check, and `web` only waits for
  `api` to start, not to be healthy.
- `migrate` runs `npx node-pg-migrate up` and exits. It is not a daemon.
- Volume `postgres_data` is mounted at `/var/lib/postgresql/data`.

### Production equivalents

| Compose service | Cloud resource | Port | Exposure |
|-----------------|----------------|------|----------|
| `postgres` | Cloud SQL `todo-<env>-postgres` | 5432 | private IP only |
| `migrate`  | Cloud Run job `todo-<env>-migrate` | none | run on demand |
| `api`      | Cloud Run service `todo-<env>-api` | 3001 | ingress `INTERNAL_LOAD_BALANCER` |
| `web`      | Cloud Run service `todo-<env>-web` | 3000 | public (`allUsers` invoker) |

---

## 3. Environment variables

There is no `.env` or `.env.example` file in the repo; all values are set
in `docker-compose.yml` (local) or Terraform (GCP).

| Variable | Used by | Local value | GCP value | Purpose |
|----------|---------|-------------|-----------|---------|
| `POSTGRES_DB` | postgres | `app` | n/a (`google_sql_database.app`) | Database name |
| `POSTGRES_USER` | postgres | `app` | n/a (`google_sql_user.app`) | Database user |
| `POSTGRES_PASSWORD` | postgres | `app` | random 32 chars | Database password |
| `DATABASE_URL` | migrate, api | `postgres://app:app@postgres:5432/app` | Secret Manager `todo-<env>-db-url` | Connection string |
| `PORT` | api | `3001` | `3001` | API listen port (default 3001 in code) |
| `PORT` | web | `3000` | `3000` | Web listen port |
| `API_URL` | web | `http://api:3001` | API Cloud Run URI | Where server actions call the API |
| `NODE_ENV` | web | `production` (set in Dockerfile) | same | Next.js mode |

Behaviour to know:

- `API_URL` falls back to `http://localhost:3001` in `actions.ts`
  if unset. Inside a container that points at the container itself and fails.
- `DATABASE_URL` is read when `src/api/db.js` is loaded. Changing it
  requires restarting the API.
- The Compose credentials `app/app` are for local development only.
  Never reuse them.
- In GCP the password is generated by Terraform's `random_password` and
  stored in Terraform state and in Secret Manager.

### Terraform variables

| Variable | Default | Notes |
|----------|---------|-------|
| `project_id` | none (required) | GCP project |
| `region` | `us-central1` | |
| `app_name` | `todo` | Resource name prefix |
| `environment` | `dev` | Must be `dev`, `staging` or `prod` |
| `subnet_cidr` | `10.0.0.0/24` | |
| `connector_cidr` | `10.0.1.0/28` | Must be /28 and not overlap the subnet |
| `db_tier` | `db-f1-micro` | Use a larger tier for prod |
| `api_image` | none (required) | e.g. `gcr.io/PROJECT/api:TAG` |
| `web_image` | none (required) | |
| `db_image` | none (required) | Defined in `migration.tf` |
| `api_max_instances` | `10` | |
| `web_max_instances` | `10` | |

### CI secrets (GitHub Actions, `deploy.yml`)

| Secret | Purpose |
|--------|---------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload identity federation provider |
| `GCP_SERVICE_ACCOUNT` | Service account CI impersonates |
| `GCP_PROJECT_ID` | Project for images and Terraform |
| `TF_STATE_BUCKET` | GCS bucket for Terraform state |

---

## 4. Local setup

### Prerequisites

- Docker Engine with the Compose plugin (or Docker Desktop).
- Free host port 3000.
- Optional for running tests outside Docker: Node.js 22.

### Start

```bash
git clone https://github.com/d-kess/example-three-tier-application.git
cd example-three-tier-application
docker compose up --build
```

Startup order: postgres (healthy) then migrate (completes) then api
then web. Open http://localhost:3000.

Run in the background:

```bash
docker compose up --build -d
docker compose ps
```

### Verify

```bash
docker compose ps -a
docker compose logs migrate
docker compose exec api wget -qO- http://localhost:3001/health
docker compose exec web wget -qO- http://api:3001/tasks
curl -sI http://localhost:3000 | head -1
```

Expected: `migrate` shows `Exited (0)`, the health call prints
`{"status":"ok"}`, and the web page returns `HTTP/1.1 200 OK`.

### Exercise the API

```bash
docker compose exec api wget -qO- --header 'Content-Type: application/json' \
  --post-data '{"title":"smoke test"}' http://localhost:3001/tasks
docker compose exec api wget -qO- http://localhost:3001/tasks
```

### Stop and reset

```bash
docker compose down          # keeps postgres_data
docker compose down -v       # deletes postgres_data (all data lost)
docker compose up --build    # rebuild after code changes
```

### Run API tests (outside Docker)

```bash
cd src/api
npm ci
npm test            # node --test
```

### Lint the web app

```bash
cd src/web
npm ci
npm run lint        # eslint
npm run build       # next build (standalone output)
```

### Run migrations by hand

```bash
cd src/db
npm ci
DATABASE_URL=postgres://app:app@localhost:5432/app npx node-pg-migrate up
DATABASE_URL=postgres://app:app@localhost:5432/app npx node-pg-migrate down
```

This needs port 5432 reachable from the host, which Compose does not
publish by default.

---

## 5. Deployment

### Pipeline overview

`.github/workflows/deploy.yml` ("Deploy") runs on every push to `main`
and on manual `workflow_dispatch` (input `environment`: dev, staging,
prod; default dev). Env vars: `REGION=us-central1`, `APP_NAME=todo`.

| Job | Needs | What it does |
|-----|-------|--------------|
| `build` | none | Authenticates to GCP, builds and pushes `api`, `web`, `db` images to `gcr.io/<project>/<name>:<sha>` and `:latest` |
| `infrastructure` | `build` | `terraform init` (GCS backend, prefix `terraform/<env>`), `plan`, `apply -auto-approve` |
| `migrate` | `build`, `infrastructure` | `gcloud run jobs execute todo-<env>-migrate --region us-central1 --wait` |

Images are tagged with the commit SHA, so every deploy is traceable and
rollback is a redeploy of an older SHA.

### Trigger a deploy

```bash
# Push to main (deploys dev), or run manually:
gh workflow run Deploy -f environment=staging
gh run list --workflow Deploy --limit 5
gh run watch
```

### Manual deploy

```bash
export PROJECT=my-gcp-project
export TAG=$(git rev-parse HEAD)
gcloud auth configure-docker gcr.io --quiet

docker build -t gcr.io/$PROJECT/api:$TAG ./src/api
docker build -t gcr.io/$PROJECT/web:$TAG ./src/web
docker build -t gcr.io/$PROJECT/db:$TAG  ./src/db
docker push gcr.io/$PROJECT/api:$TAG
docker push gcr.io/$PROJECT/web:$TAG
docker push gcr.io/$PROJECT/db:$TAG

cd src/infrastructure
terraform init \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="prefix=terraform/dev"
terraform plan -out=tfplan \
  -var="project_id=$PROJECT" -var="environment=dev" \
  -var="api_image=gcr.io/$PROJECT/api:$TAG" \
  -var="web_image=gcr.io/$PROJECT/web:$TAG" \
  -var="db_image=gcr.io/$PROJECT/db:$TAG"
terraform apply tfplan

gcloud run jobs execute todo-dev-migrate --region us-central1 --wait
terraform output web_url
```

### Ordering caveat

In CI, Terraform applies the new API and web revisions before the
migration job runs. Migrations must therefore be backward compatible
with the previous API revision, and the API must tolerate the old schema
until the job finishes. Migrations are append-only: never edit an
existing file in `src/db/migrations/`, add a new one.

### Rollback

```bash
# 1. Find a previous good SHA
gh run list --workflow Deploy --limit 10
# 2. Re-apply Terraform with those image tags (see manual deploy)
# 3. Or shift traffic on Cloud Run directly
gcloud run revisions list --service todo-prod-web --region us-central1
gcloud run services update-traffic todo-prod-web \
  --region us-central1 --to-revisions REVISION_NAME=100
```

Direct traffic shifts are drift from Terraform: reconcile with the next
apply. A migration is rolled back separately with
`npx node-pg-migrate down` (one step) against the target database.

### Production safeguards in Terraform

- `deletion_protection` is on for the Cloud SQL instance when
  `environment = prod`.
- Prod uses `REGIONAL` availability and enables backups at 03:00;
  other environments are `ZONAL` with backups disabled.
- Prod keeps `min_instance_count = 1` for API and web; others scale to 0
  (expect cold starts in dev and staging).

---

## 6. Health checks

| Component | Check | Where defined |
|-----------|-------|---------------|
| postgres | `pg_isready -U app -d app`, every 5s, 5 retries | `docker-compose.yml` |
| migrate | exit code 0 (`service_completed_successfully`) | `docker-compose.yml` |
| api | `GET /health` returns `{"status":"ok"}` | `src/api/index.js` |
| api (GCP) | startup probe `/health` (5s delay, 5s period, 10 failures); liveness `/health` every 30s, 3 failures | `main.tf` |
| web (GCP) | startup probe `GET /` on 3000 (10s delay, 5s period, 10 failures) | `main.tf` |
| web (local) | none configured | n/a |

Important: `/health` only proves the Node process is serving. It does not
touch the database. Use `/tasks` as a deep check, since it queries
PostgreSQL.

### Quick commands (local)

```bash
docker compose ps
docker compose exec postgres pg_isready -U app -d app
docker compose exec api wget -qO- http://localhost:3001/health
docker compose exec api wget -qO- http://localhost:3001/tasks   # deep check
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000
```

### Quick commands (GCP)

```bash
WEB=$(cd src/infrastructure && terraform output -raw web_url)
curl -s -o /dev/null -w '%{http_code}\n' "$WEB"
gcloud run services describe todo-prod-api --region us-central1 \
  --format='value(status.conditions[0].type,status.conditions[0].status)'
gcloud sql instances describe todo-prod-postgres \
  --format='value(state)'
gcloud run jobs executions list --job todo-prod-migrate --region us-central1 --limit 3
```

The API ingress is internal, so `curl` against the API URL from outside
the VPC is expected to fail. Test through the web tier.

### Suggested alerts

These are recommendations, not configured by this repo:

- Web uptime check on `/` (alert after 2 failures).
- Cloud Run 5xx ratio above 5% for 5 minutes on web and API.
- Cloud SQL CPU above 80%, disk above 80%, connections above 80 of 100.
- Migration job execution failure.

---

## 7. Logging

### What the app logs

- API: one line at startup, `API listening on port <PORT>`. There is no
  request logging, so every other API log is an error stack trace.
- Express 5 forwards rejected async handlers to the default error
  handler, which logs the stack and returns HTTP 500.
- Web: Next.js standalone server output plus server-action errors.
  `src/web/app/error.tsx` shows the error message in the UI.
- migrate: node-pg-migrate prints each migration applied.
- postgres: standard PostgreSQL server log on stderr.

### Local

Compose uses the default `json-file` driver; no log options are set in
`docker-compose.yml`, so logs are unrotated by default.

```bash
docker compose logs -f                 # everything
docker compose logs -f api web         # tiers only
docker compose logs --since 10m api
docker compose logs --tail 200 postgres
docker compose logs migrate            # works after it exited
```

To cap disk use, add to a service in a local override file:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

### GCP

Cloud Run sends stdout and stderr to Cloud Logging automatically.

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="todo-prod-api" AND severity>=ERROR' \
  --limit 50 --freshness 1h

gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="todo-prod-migrate"' \
  --limit 50 --freshness 1d

gcloud logging read \
  'resource.type="cloudsql_database" AND severity>=ERROR' --limit 50
```

Requests to Cloud Run are logged by the platform (`run.googleapis.com/requests`),
which fills the gap left by the API's lack of request logs.

### Log hygiene

- `DATABASE_URL` contains the password. Never print it; do not paste
  `docker compose config` output into tickets without redacting.
- The `pg` pool errors are logged with host and port but not the password.

---

## 8. Backup and restore

### Local (Compose)

Data lives in the `postgres_data` volume. `docker compose down -v`
destroys it.

Logical backup:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U app -d app -Fc \
  > backups/app-$(date +%Y%m%d-%H%M%S).dump
ls -lh backups/
```

Restore into a running stack:

```bash
docker compose stop api web
docker compose exec -T postgres psql -U app -d postgres \
  -c 'DROP DATABASE IF EXISTS app WITH (FORCE);' \
  -c 'CREATE DATABASE app OWNER app;'
docker compose exec -T postgres pg_restore -U app -d app --no-owner \
  < backups/app-YYYYMMDD-HHMMSS.dump
docker compose start api web
```

Volume-level backup (stop postgres first for consistency):

```bash
docker compose stop postgres
docker run --rm -v "$(basename "$PWD")_postgres_data:/data" -v "$PWD/backups:/out" \
  alpine tar czf /out/pgdata.tgz -C /data .
docker compose start postgres
```

The volume name is prefixed by the Compose project name (the directory
name by default); check with `docker volume ls`.

### GCP (Cloud SQL)

- Automated backups are enabled only when `environment = prod`
  (daily window starting 03:00). Dev and staging have none, so take
  on-demand backups or exports before risky changes.

```bash
# On-demand backup
gcloud sql backups create --instance todo-prod-postgres
gcloud sql backups list --instance todo-prod-postgres

# Restore a backup over the instance (destructive)
gcloud sql backups restore BACKUP_ID \
  --restore-instance todo-prod-postgres

# Logical export to a bucket
gcloud sql export sql todo-prod-postgres gs://MY_BUCKET/app-$(date +%F).sql \
  --database app
# Logical import
gcloud sql import sql todo-prod-postgres gs://MY_BUCKET/app-2024-01-01.sql \
  --database app
```

The instance's service account needs access to the bucket.

### Backup policy recommendations

- Before every prod migration: `gcloud sql backups create`.
- Test a restore into a scratch instance at least quarterly.
- Keep `terraform.tfvars` out of Git; Terraform state (GCS bucket) holds
  the generated DB password, so restrict and version that bucket.

---

## 9. Incident runbooks

Each runbook has: symptoms, diagnosis, fix, verification. Commands use
Compose locally; GCP equivalents are given where they differ.

General first steps for any incident:

```bash
docker compose ps -a
docker compose logs --since 15m --tail 200
```

### RB-01 Web returns errors or the page does not load

Symptoms: browser cannot reach http://localhost:3000, or shows
"Something went wrong".

1. Check the container state:
   ```bash
   docker compose ps -a web
   ```
2. If not running, read why:
   ```bash
   docker compose logs --tail 100 web
   docker compose up -d web
   ```
3. If running but erroring, test the API from the web container:
   ```bash
   docker compose exec web wget -qO- http://api:3001/tasks
   ```
   Failure points to RB-02 (API down) or RB-05 (wrong API_URL).
4. Confirm the host port is not taken by another process:
   ```bash
   ss -ltnp | grep ':3000'
   ```
5. Rebuild if the image is stale:
   ```bash
   docker compose up -d --build web
   ```
6. GCP: check the latest revision and its logs:
   ```bash
   gcloud run services describe todo-prod-web --region us-central1
   gcloud logging read 'resource.labels.service_name="todo-prod-web" AND severity>=ERROR' --limit 30
   ```

Verify: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000` prints 200.

### RB-02 API is down or crash looping

Symptoms: web shows "Failed to fetch tasks"; `api` is `Exited` or restarting.

1. Inspect state and exit code:
   ```bash
   docker compose ps -a api
   docker inspect "$(docker compose ps -aq api)" --format '{{.State.ExitCode}} {{.State.Error}}'
   ```
2. Read the logs:
   ```bash
   docker compose logs --tail 200 api
   ```
3. Common causes:
   - `Cannot find module`: bad image build. Run `docker compose build --no-cache api`.
   - `EADDRINUSE`: another process uses `PORT` in the container. Check env.
   - Repeated `ECONNREFUSED` on queries: see RB-03.
4. The `api` service has no restart policy, so restart it manually:
   ```bash
   docker compose up -d api
   ```
   Consider `restart: unless-stopped` in a local override for resilience.
5. Test directly:
   ```bash
   docker compose exec api wget -qO- http://localhost:3001/health
   ```
6. GCP: the startup probe allows 10 failures at 5s. If a revision never
   becomes ready, Cloud Run keeps the previous one serving. Read the
   revision logs, then redeploy a known-good image tag.

Verify: `/health` returns ok and `/tasks` returns a JSON array.

### RB-03 Database unreachable or unhealthy

Symptoms: `/tasks` returns 500, logs show `ECONNREFUSED`,
`ENOTFOUND postgres`, or `the database system is starting up`.

1. Check Postgres:
   ```bash
   docker compose ps postgres
   docker compose exec postgres pg_isready -U app -d app
   docker compose logs --tail 100 postgres
   ```
2. If stopped, start it and wait for healthy:
   ```bash
   docker compose up -d postgres
   docker compose ps postgres        # wait for "healthy"
   ```
3. Test a real query:
   ```bash
   docker compose exec postgres psql -U app -d app -c 'select count(*) from tasks;'
   ```
4. If the container crash loops with a permissions or corruption error,
   stop and follow RB-09 (volume problems) before deleting anything.
5. Restart the dependents so pools reconnect:
   ```bash
   docker compose restart api
   ```
6. GCP:
   ```bash
   gcloud sql instances describe todo-prod-postgres --format='value(state)'
   gcloud sql operations list --instance todo-prod-postgres --limit 5
   ```
   Confirm the VPC connector `todo-prod-connector` is READY and the API
   revision uses it.

Verify: `pg_isready` reports accepting connections and `/tasks` returns 200.

### RB-04 Migration fails or `migrate` keeps restarting

Symptoms: `api` never starts (it waits for `migrate` to complete);
`migrate` shows `Restarting`.

1. Read the migration output:
   ```bash
   docker compose logs migrate
   ```
2. Typical causes and fixes:
   - `connection refused`: Postgres not ready, see RB-03.
   - `relation "x" already exists`: schema was changed outside
     migrations. Compare with the `pgmigrations` table (step 3).
   - Missing `DATABASE_URL`: check the `migrate` environment block.
   - SQL error in a new migration: fix it in a NEW migration file
     (never edit applied ones), then rebuild.
3. Check applied state:
   ```bash
   docker compose exec postgres psql -U app -d app \
     -c 'select id, name, run_on from pgmigrations order by id;'
   docker compose exec postgres psql -U app -d app -c '\dt'
   ```
4. Stop the restart loop while debugging:
   ```bash
   docker compose stop migrate
   ```
5. Re-run after the fix:
   ```bash
   docker compose up -d --build migrate
   docker compose logs -f migrate
   ```
6. Roll back the last migration if needed:
   ```bash
   docker compose run --rm migrate npx node-pg-migrate down
   ```
7. GCP: the Cloud Run job retries up to 3 times (`max_retries = 3`).
   ```bash
   gcloud run jobs executions list --job todo-prod-migrate --region us-central1
   gcloud run jobs execute todo-prod-migrate --region us-central1 --wait
   ```

Verify: `docker compose ps -a migrate` shows `Exited (0)` and `api` starts.

### RB-05 Web cannot reach the API (wrong or missing API_URL)

Symptoms: web loads but the task list errors with "Failed to fetch tasks"
while the API itself is healthy.

1. Confirm the API works internally:
   ```bash
   docker compose exec api wget -qO- http://localhost:3001/health
   ```
2. Check what the web container thinks the URL is:
   ```bash
   docker compose exec web printenv API_URL PORT
   ```
   It must be `http://api:3001`. If empty, the code falls back to
   `http://localhost:3001`, which fails inside the container.
3. Test name resolution and connectivity:
   ```bash
   docker compose exec web wget -qO- http://api:3001/tasks
   docker network ls
   ```
4. Fix `API_URL` in `docker-compose.yml`, then recreate:
   ```bash
   docker compose up -d --force-recreate web
   ```
5. GCP: the API uses ingress `INTERNAL_LOAD_BALANCER` while web calls
   its `.run.app` URI through the connector with egress
   `PRIVATE_RANGES_ONLY`. A 403 or 404 from the API in web logs means
   the request is not arriving as internal traffic. Review the API
   ingress setting and web egress setting in `main.tf`, and check that
   the Cloud Run URL in `API_URL` matches `terraform output api_url`.

Verify: the task list renders and adding a task works.

### RB-06 Port 3000 already in use

Symptoms: `docker compose up` fails with `port is already allocated` or
`address already in use` for `0.0.0.0:3000`.

1. Find the owner:
   ```bash
   ss -ltnp | grep ':3000'
   docker ps --format '{{.Names}} {{.Ports}}' | grep 3000
   ```
2. If it is a stale container from this project:
   ```bash
   docker compose down
   docker compose up -d
   ```
3. If it is another application you want to keep, change only the host
   side of the mapping in a local override file
   `docker-compose.override.yml` (do not commit it):
   ```yaml
   services:
     web:
       ports: !override
         - "3100:3000"
   ```
   Then `docker compose up -d` and use http://localhost:3100.
   The container port and `PORT` stay at 3000.
4. If the partial start left other services running, check them:
   ```bash
   docker compose ps -a
   ```

Verify: `curl -sI http://localhost:3000` (or 3100) returns `200`.

### RB-07 Connection exhaustion or slow queries

Symptoms: API requests hang or return 500 with `too many clients already`
or timeouts; latency climbs. Cloud SQL is configured with
`max_connections = 100`. Each API instance uses a default `pg` pool
(up to 10 connections), so 10+ instances can exhaust it.

1. See current connections:
   ```bash
   docker compose exec postgres psql -U app -d app -c \
     "select state, count(*) from pg_stat_activity group by state;"
   docker compose exec postgres psql -U app -d app -c 'show max_connections;'
   ```
2. Find long-running queries:
   ```bash
   docker compose exec postgres psql -U app -d app -c \
     "select pid, now()-query_start as age, state, left(query,80)
      from pg_stat_activity where state <> 'idle' order by age desc;"
   ```
3. Cancel or terminate a stuck backend (use the pid from step 2):
   ```bash
   docker compose exec postgres psql -U app -d app -c 'select pg_cancel_backend(PID);'
   docker compose exec postgres psql -U app -d app -c 'select pg_terminate_backend(PID);'
   ```
4. Restart the API to reset its pool:
   ```bash
   docker compose restart api
   ```
5. GCP: cap instances to keep total connections under the limit.
   Set `api_max_instances` (default 10) lower in Terraform and apply,
   or raise `db_tier` and the `max_connections` flag in `main.tf`.
   ```bash
   gcloud sql instances describe todo-prod-postgres \
     --format='value(settings.tier,settings.databaseFlags)'
   ```
6. Long term: add `max` to the `Pool` options in `src/api/db.js`,
   and an index if `ORDER BY created_at` scans become slow on a large
   `tasks` table.

Verify: connection count is well below the limit and `/tasks` responds
in under a second.

### RB-08 Bad deploy: roll back and fix a failed pipeline

Symptoms: after a deploy, errors spike; or the Deploy workflow failed
at one of `build`, `infrastructure` or `migrate`.

1. Identify which job failed:
   ```bash
   gh run list --workflow Deploy --limit 5
   gh run view RUN_ID --log-failed
   ```
2. If `build` failed: fix the Dockerfile or code and push. Nothing was
   deployed.
3. If `infrastructure` failed on a state lock:
   ```bash
   cd src/infrastructure
   terraform init -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="prefix=terraform/prod"
   terraform force-unlock LOCK_ID     # only if no apply is running
   ```
4. If `migrate` failed after Terraform applied: the new code is live
   against the old schema. Fix forward (RB-04) or roll back services.
5. Roll back services to the last good revision:
   ```bash
   gcloud run revisions list --service todo-prod-api --region us-central1
   gcloud run services update-traffic todo-prod-api \
     --region us-central1 --to-revisions GOOD_REVISION=100
   gcloud run services update-traffic todo-prod-web \
     --region us-central1 --to-revisions GOOD_WEB_REVISION=100
   ```
6. Make it permanent by re-running Terraform with the previous SHA tags:
   ```bash
   gh workflow run Deploy -f environment=prod   # from a ref at the good commit
   ```
   Or revert the commit on `main` so the push redeploys.
7. If the schema must also revert, restore from backup (section 8) or
   run `node-pg-migrate down` through a one-off job execution.

Verify: web returns 200, `/tasks` works through the UI, and the revision
list shows the good revision at 100% traffic.

### RB-09 Postgres volume problems: disk full, corruption, permissions

Symptoms: Postgres exits at start, logs show `No space left on device`,
`could not write`, `invalid checkpoint record` or `Permission denied`
on `/var/lib/postgresql/data`.

1. Capture evidence first:
   ```bash
   docker compose logs --tail 200 postgres > postgres-incident.log
   docker system df
   df -h /var/lib/docker
   ```
2. Disk full: free space without touching the data volume.
   ```bash
   docker image prune -f
   docker builder prune -f
   docker container prune -f
   ```
   Do not run `docker volume prune` while stopped; it can delete
   `postgres_data` if no container is attached.
3. Take a file-level copy of the volume before any repair
   (volume backup command in section 8), when space allows.
4. Permissions: confirm the volume is a Docker named volume and not a
   bind mount with the wrong owner:
   ```bash
   docker volume inspect "$(basename "$PWD")_postgres_data"
   ```
5. Corruption with no usable copy: restore the most recent dump into a
   fresh volume.
   ```bash
   docker compose down
   docker volume rm "$(basename "$PWD")_postgres_data"
   docker compose up -d postgres
   # then restore using the pg_restore steps in section 8
   docker compose up -d
   ```
   This destroys the existing data. Only do it after step 3 or when the
   data is disposable (local dev).
6. GCP: Cloud SQL has `disk_autoresize = true`; check the instance is not
   at a configured limit and see storage use:
   ```bash
   gcloud sql instances describe todo-prod-postgres \
     --format='value(settings.dataDiskSizeGb,state)'
   ```

Verify: `pg_isready` succeeds and `select count(*) from tasks;` returns
the expected row count.

### RB-10 Credential rotation or suspected DB password leak

Symptoms: the connection string appeared in a log or ticket, or the
password must be rotated per policy.

Local (dev only): the `app/app` credentials are not secret. Change them
in `docker-compose.yml` for `POSTGRES_PASSWORD` and both `DATABASE_URL`
values, then `docker compose down -v && docker compose up --build`.
This wipes the data, since Postgres only reads the password on first init.

GCP:

1. Confirm what is exposed and since when:
   ```bash
   gcloud secrets versions list todo-prod-db-url
   ```
2. Rotate the Terraform-managed password. This regenerates the
   `random_password`, updates the SQL user and writes a new secret version:
   ```bash
   cd src/infrastructure
   terraform apply -replace=random_password.db \
     -var="project_id=$PROJECT" -var="environment=prod" \
     -var="api_image=..." -var="web_image=..." -var="db_image=..."
   ```
3. The services reference `version = "latest"` but read the secret at
   instance start. Force new revisions so they pick it up:
   ```bash
   gcloud run services update todo-prod-api --region us-central1 \
     --update-labels rotated=$(date +%s)
   gcloud run jobs update todo-prod-migrate --region us-central1 \
     --update-labels rotated=$(date +%s)
   ```
4. Disable the old secret version:
   ```bash
   gcloud secrets versions disable OLD_VERSION --secret todo-prod-db-url
   ```
5. Remember the password is also in Terraform state (GCS bucket). Check
   who has access to the bucket and its object versions.
6. Review who accessed the secret:
   ```bash
   gcloud logging read 'protoPayload.serviceName="secretmanager.googleapis.com"' --limit 50
   ```

Verify: the API serves `/tasks` on the new revision and the old secret
version is disabled.

---

## 10. FAQ

**Q1. How do I start the whole stack?**
Run `docker compose up --build` from the repo root, then open
http://localhost:3000.

**Q2. Which ports does the app use?**
Web 3000 (published to the host), API 3001 (Compose network only) and
PostgreSQL 5432 (Compose network only).

**Q3. Why can't I reach the API from my host?**
The API uses `expose`, not `ports`. Use
`docker compose exec api wget -qO- http://localhost:3001/health`, or add a
temporary `ports: ["3001:3001"]` mapping in an override file.

**Q4. How do I connect to the database with psql?**
`docker compose exec postgres psql -U app -d app`. For a host client,
temporarily publish 5432 in an override file and use
`postgres://app:app@localhost:5432/app`.

**Q5. Is there a `.env` file?**
No. Values are in `docker-compose.yml` and Terraform. See section 3.

**Q6. How do I reset the database to empty?**
`docker compose down -v && docker compose up --build`. This deletes all
data in `postgres_data`.

**Q7. Why does `api` wait before starting?**
It depends on `migrate` with `service_completed_successfully`, which in
turn waits for a healthy `postgres`.

**Q8. Why does `migrate` show as Exited?**
That is normal. It applies pending migrations and exits with code 0.

**Q9. How do I add a new migration?**
```bash
cd src/db
npx node-pg-migrate create add-priority-to-tasks
```
Edit the generated file in `migrations/`, then rebuild so the image
contains it: `docker compose up --build`.

**Q10. Can I edit an existing migration?**
No. Migrations are append-only. Add a new migration instead.

**Q11. How do I roll back a migration?**
`docker compose run --rm migrate npx node-pg-migrate down` reverts the
latest one. Take a backup first for production.

**Q12. Does `/health` check the database?**
No. It returns `{"status":"ok"}` without a query. Use `/tasks` for a
deep check.

**Q13. Where are the logs?**
Locally `docker compose logs`; on GCP, Cloud Logging. See section 7.

**Q14. Why does the API log so little?**
There is no request logging middleware. Only the startup line and error
traces are written. Cloud Run adds request logs on GCP.

**Q15. How do I run the API tests?**
`cd src/api && npm ci && npm test`.

**Q16. How do I lint the frontend?**
`cd src/web && npm ci && npm run lint`.

**Q17. How is the web app built?**
Multi-stage Dockerfile; Next.js `output: "standalone"` produces
`server.js`, which the final image runs with `node server.js`.

**Q18. How does a deploy get triggered?**
A push to `main` runs the Deploy workflow for `dev`. Use
`gh workflow run Deploy -f environment=prod` for other environments.

**Q19. What order do deploy steps run in?**
Build and push images, Terraform apply, then the migration Cloud Run job.

**Q20. How do I get the production URL?**
`cd src/infrastructure && terraform output -raw web_url`.

**Q21. Why is the first request slow in dev?**
Non-prod Cloud Run services have `min_instance_count = 0`, so they scale
to zero and cold start.

**Q22. Are backups automatic?**
Only on Cloud SQL for `prod` (03:00 window). Local and non-prod
environments need manual backups; see section 8.

**Q23. Is the API authenticated?**
No. It relies on network isolation: no host port locally and an internal
ingress on Cloud Run. Do not expose it publicly without adding auth.

**Q24. What versions are required?**
Node.js 22 (`node:22-alpine` images), PostgreSQL 17, Terraform at least
1.5 (CI pins `~> 1.5`) and the Google provider `~> 5.0`.

**Q25. How do I rotate the production database password?**
Follow RB-10: replace `random_password.db` with Terraform, force new
Cloud Run revisions and disable the old secret version.

---

End of handbook. Keep it in sync with `docker-compose.yml` and
`src/infrastructure/` when services, ports or variables change.
