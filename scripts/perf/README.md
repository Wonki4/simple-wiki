# Permission search benchmark

This benchmark uses a disposable PostgreSQL database and an app on port 3001.
Never point it at the default development or production database. Both seed
scripts enforce `127.0.0.1:55433/wiki_permission_perf`; the load client enforces
`http://localhost:3001`.

## Dataset and measurement

- 10,000,000 users, 100,000 groups, 10,000,000 memberships.
- 100,000 permissions in one restricted space; 64 of those users are space admins.
- 1,024 disposable access tokens rotate across requests. Normal token rate limits
  remain enabled. HTTP status failures and incorrect response contents count as errors.
- Exact user, rare substring, common prefix, short prefix, common substring,
  absent result, short absent result, and group prefix are mixed equally.
- Closed-loop concurrent clients, no think time. Latency includes HTTP, bearer
  authentication, membership lookup, permission checks, search, and serialization.
  It excludes browser debounce/rendering and Keycloak sign-in.
- Report p50/p95/p99, throughput, errors, and per-scenario statistics. Short local
  runs are regression/load evidence, not production capacity or an SLA.
- Fixture tables are unlogged to reduce WAL/disk use while loading. This does not
  benchmark writes, durability, replication, or cold-storage recovery.

## Reproduction

Use the installed `postgres:16` image in a separate container with 4 CPUs, 4 GiB
memory, `shared_buffers=512MB`, `work_mem=8MB`, `maintenance_work_mem=512MB`,
`max_wal_size=1GB`, and port `127.0.0.1:55433:5432`. Use a dedicated named volume.
The fixture password may be arbitrary; it is only for this disposable local DB.

Supply these overrides through a private temporary environment file, loaded after
the normal `.env` using Node's `--env-file`:

```dotenv
DATABASE_URL=postgresql://wiki:wiki_perf_local@127.0.0.1:55433/wiki_permission_perf?schema=public&connection_limit=12&pool_timeout=10&connect_timeout=30
AUTH_URL=http://localhost:3001
AUTH_TRUST_HOST=true
STORAGE_DRIVER=local
ATTACHMENTS_DIR=/private/tmp/wiki-perf-attachments
```

For an optimized-only run, apply migrations, then seed. For a before/after run,
apply the preceding revision's migrations, seed and measure that revision, then
apply the search migration and switch to the optimized build. Loading before
building the search indexes is substantially faster. Stop Next servers before
rebuilding their shared `.next` directory.

```sh
node --env-file=.env --env-file=/private/tmp/wiki-perf.env node_modules/prisma/build/index.js migrate deploy
node --env-file=.env --env-file=/private/tmp/wiki-perf.env --import tsx scripts/perf/seed-permission-search.ts
node --env-file=.env --env-file=/private/tmp/wiki-perf.env --import tsx scripts/perf/prepare-permission-actors.ts
node --env-file=.env --env-file=/private/tmp/wiki-perf.env node_modules/next/dist/bin/next start --hostname localhost --port 3001
```

Run the load client in another terminal after the production build and all
indexes are ready:

```sh
PERF_TOKEN_FILE=/private/tmp/wiki-perf-tokens.json PERF_SECONDS=30 PERF_CONCURRENCY=1,10,30 PERF_OUTPUT=/private/tmp/wiki-perf-results.json node scripts/perf/load-permission-search.mjs
```

`PERF_MIN_REQUESTS=8` ensures a slow baseline exercises all eight scenarios.
The seed process stops if host free disk drops below 6 GiB. Watch database size,
container CPU/memory, and free disk while building indexes too. After recording
results, stop the isolated app, remove only its dedicated container/volume, and
delete the disposable token file. Keep the regular demo app running.

## Index rollout

The migration builds four SP-GiST indexes on `lower(...) COLLATE "C"` for literal
prefix/equality lookup and four trigram GIN indexes for substring lookup. Prisma
does not model the expression indexes; their SQL is maintained in the migration.
These are ordinary index builds: schedule a maintenance window for a large live
directory, or prebuild the same indexes with `CREATE INDEX CONCURRENTLY` through
an explicitly coordinated deployment migration. Do not run the ordinary build
unannounced on a busy, ten-million-row production user directory.

The autocomplete returns a bounded set of exact/prefix matches before substring
matches, sorted within those candidates. If a type has an exact match, its
substring fallback is skipped. It does not alphabetically sort every
matching account in the directory. One/two-character queries use prefixes; a
substring query needs at least three consecutive letters/digits to yield a
usable trigram. Member counts are capped at 1,001 inspected memberships per
selected group and displayed as “1,000명 이상” above 1,000.
