# example-three-tier-application

A reference implementation of a three-tier web application: a Next.js frontend, an Express REST API, and a PostgreSQL database. It runs locally with Docker Compose and deploys to Google Cloud Platform (Cloud Run + Cloud SQL) via Terraform.

This repository is a reference example for a three-tier application.

Run `bash tests/smoke.sh` from the repository root to run the smoke check.

**Troubleshooting:** run it before submitting a PR. If it prints a `smoke:` failure message, fix the problem it names in `README.md` and re-run until it prints `smoke: ok`.

## Architecture

```
Browser → Web (Next.js :3000) → API (Express :3001) → PostgreSQL
```

| Layer | Technology | Location |
|-------|-----------|----------|
| Frontend | Next.js 16, React 19, Tailwind CSS | `src/web/` |
| API | Express 5, Node.js 22 | `src/api/` |
| Database | PostgreSQL 17 | managed by Docker / Cloud SQL |
| Migrations | node-pg-migrate | `src/db/` |
| Infrastructure | Terraform (GCP) | `src/infrastructure/` |

The app is a simple task manager (to-do list) that demonstrates how the three tiers communicate.

## Running locally with Docker Compose

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose plugin)

### Start the stack

```bash
docker compose up --build
```

This starts four services in order:

1. **postgres** — PostgreSQL 17 database, waits until healthy
2. **migrate** — runs `node-pg-migrate up` to apply schema migrations, then exits
3. **api** — Express API on port 3001 (internal only)
4. **web** — Next.js frontend on port 3000 (exposed to host)

Once running, open [http://localhost:3000](http://localhost:3000).

### Stop and clean up

```bash
# Stop containers (keeps the postgres_data volume)
docker compose down

# Stop and delete all data
docker compose down -v
```

### Rebuild after code changes

```bash
docker compose up --build
```

### API endpoints

The API is not exposed directly, but you can reach it through the web container or by temporarily mapping its port:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/tasks` | List all tasks |
| POST | `/tasks` | Create a task (`{ "title": "...", "completed"?: false }`) → `201` |
| PUT | `/tasks/:id` | Replace a task; both `title` and `completed` are required |
| PATCH | `/tasks/:id` | Partially update a task (`{ "completed": true }` and/or `{ "title": "..." }`). An empty or missing body toggles `completed`. |

#### Validation

Every endpoint validates its input before it touches the database (`src/api/validation.js`):

| Input | Rule |
|-------|------|
| `:id` | Integer from 1 to 2147483647 |
| `title` | Non-blank string, at most 500 characters after trimming |
| `completed` | Strict boolean; strings and numbers are rejected |
| Request body | Must be a JSON object when present |

#### Errors

Every error uses the same body:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [{ "field": "title", "message": "title is required" }]
  }
}
```

| Status | `code` | When |
|--------|--------|------|
| 400 | `validation_error` | Input fails the rules above (`details` lists each field) |
| 400 | `bad_request` | Malformed JSON body |
| 404 | `not_found` | Unknown task id or unknown route |
| 413 | `payload_too_large` | Request body too large |
| 500 | `internal_error` | Unexpected failure |

The web app reads this format in `src/web/app/actions.ts`, so change both together.

## Project structure

```
src/
├── api/            # Express REST API
│   ├── index.js    # Server entry point
│   ├── app.js      # Express app: middleware, routes, error handling
│   ├── routes/     # Route handlers (tasks.js)
│   ├── validation.js # Input validation middleware
│   ├── errors.js   # ApiError and the JSON error handler
│   ├── db.js       # PostgreSQL connection pool
│   ├── tests/      # Jest + supertest tests (npm test)
│   └── Dockerfile
├── db/             # Database migrations
│   ├── migrations/ # node-pg-migrate migration files
│   └── Dockerfile
├── web/            # Next.js frontend
│   ├── app/        # App Router pages and components
│   └── Dockerfile
└── infrastructure/ # Terraform for GCP deployment
    ├── main.tf
    ├── variables.tf
    └── outputs.tf
```

## Deploying to GCP

The `src/infrastructure/` directory contains Terraform that provisions:

- VPC network and subnet
- Cloud SQL PostgreSQL 17 instance (private IP)
- Cloud Run services for the API and web frontend
- Secret Manager secret for the database URL
- Service accounts and IAM bindings

### Required variables

| Variable | Description |
|----------|-------------|
| `project_id` | GCP project ID |
| `api_image` | Container image URI for the API (e.g. `gcr.io/PROJECT/api:TAG`) |
| `web_image` | Container image URI for the web frontend |
| `region` | GCP region (default: `us-central1`) |
| `environment` | `dev`, `staging`, or `prod` (default: `dev`) |

```bash
cd src/infrastructure
terraform init
terraform apply -var="project_id=my-project" \
                -var="api_image=gcr.io/my-project/api:latest" \
                -var="web_image=gcr.io/my-project/web:latest"
```

After apply, `terraform output web_url` gives the public URL.

## Database migrations

Migrations live in `src/db/migrations/` and use [node-pg-migrate](https://salsita.github.io/node-pg-migrate/).

```bash
# Apply all pending migrations (run inside the db container or with DATABASE_URL set)
cd src/db
DATABASE_URL=postgres://app:app@localhost:5432/app npx node-pg-migrate up

# Roll back the last migration
DATABASE_URL=postgres://app:app@localhost:5432/app npx node-pg-migrate down
```

When running via Docker Compose the `migrate` service handles this automatically on startup.

## Forge live messaging QA

Mid-run acknowledged: HX11-LIVE.

Same PR continuation verified: HX11-FOLLOWUP.

Review comment applied: HX16-REVIEW.

Inspector regression checked: HX10-141.
