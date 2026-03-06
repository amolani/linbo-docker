---
phase: 01-build-hygiene
plan: 01
subsystem: infra
tags: [docker, dockerfile, dockerignore, pinning, reproducible-builds]

# Dependency graph
requires: []
provides:
  - Pinned Docker base images across all 7 Dockerfiles and redis in docker-compose.yml
  - .dockerignore files in all 7 container directories preventing host artifact contamination
affects: [all container builds, CI/CD pipelines]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Version pin comment pattern: '# Pinned YYYY-MM-DD' above every FROM line"
    - "Minimal .dockerignore per container: .git, .env, *.md, Dockerfile, .dockerignore as baseline"

key-files:
  created:
    - containers/api/.dockerignore
    - containers/web/.dockerignore
    - containers/init/.dockerignore
    - containers/tftp/.dockerignore
    - containers/rsync/.dockerignore
    - containers/ssh/.dockerignore
    - containers/dhcp/.dockerignore
  modified:
    - containers/api/Dockerfile
    - containers/web/Dockerfile
    - containers/init/Dockerfile
    - containers/tftp/Dockerfile
    - containers/rsync/Dockerfile
    - containers/ssh/Dockerfile
    - containers/dhcp/Dockerfile
    - docker-compose.yml

key-decisions:
  - "No SHA256 digests, version tags only (per user decision)"
  - "Ubuntu 24.04 kept as-is since Docker Hub has no sub-patch tags"
  - "Minimal .dockerignore focused on host contamination prevention, not build optimization"

patterns-established:
  - "Pin comment pattern: every FROM line preceded by '# Pinned YYYY-MM-DD — update periodically'"
  - ".dockerignore baseline: .git, .env, *.md, Dockerfile, .dockerignore in every container dir"
  - "Node containers additionally exclude node_modules, tests, coverage"

requirements-completed: [PROD-01, PROD-03]

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 1 Plan 1: Pin Docker Images & Add .dockerignore Summary

**All 7 Dockerfiles pinned to exact version tags (node:20.20.0-alpine3.21, nginx:1.29.5-alpine, alpine:3.19.9) with .dockerignore files preventing host artifact contamination**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T15:54:31Z
- **Completed:** 2026-03-06T15:56:08Z
- **Tasks:** 2
- **Files modified:** 15 (8 modified + 7 created)

## Accomplishments
- Pinned all Docker FROM lines to exact version tags, eliminating floating tags (:alpine, :20-alpine)
- Pinned redis image in docker-compose.yml from 7-alpine to 7.4.7-alpine
- Created .dockerignore in all 7 container directories, preventing node_modules, .git, .env from leaking into build contexts

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin all Docker base images to exact version tags** - `5ff21ce` (chore)
2. **Task 2: Add .dockerignore files to all container directories** - `4144057` (chore)

## Files Created/Modified
- `containers/api/Dockerfile` - FROM node:20-alpine pinned to node:20.20.0-alpine3.21 (both stages)
- `containers/web/Dockerfile` - FROM node:20-alpine pinned to node:20.20.0-alpine3.21, nginx:alpine to nginx:1.29.5-alpine
- `containers/init/Dockerfile` - FROM alpine:3.19 pinned to alpine:3.19.9
- `containers/dhcp/Dockerfile` - FROM alpine:3.19 pinned to alpine:3.19.9
- `containers/tftp/Dockerfile` - ubuntu:24.04 kept (most specific available), pin comment added
- `containers/rsync/Dockerfile` - ubuntu:24.04 kept, pin comment added
- `containers/ssh/Dockerfile` - ubuntu:24.04 kept, pin comment added
- `docker-compose.yml` - redis:7-alpine pinned to redis:7.4.7-alpine
- `containers/api/.dockerignore` - Excludes node_modules, tests, coverage, .env
- `containers/web/.dockerignore` - Excludes node_modules at root and frontend/ level
- `containers/init/.dockerignore` - Standard exclusions (.git, .env, *.md)
- `containers/tftp/.dockerignore` - Standard exclusions
- `containers/rsync/.dockerignore` - Standard exclusions
- `containers/ssh/.dockerignore` - Standard exclusions
- `containers/dhcp/.dockerignore` - Standard exclusions

## Decisions Made
- No SHA256 digests used (version tags only, per user decision during planning)
- Ubuntu 24.04 kept as-is since Docker Hub does not provide sub-patch version tags for Ubuntu
- .dockerignore files kept minimal, focused on preventing host contamination rather than build optimization

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Docker images are reproducibly pinned
- Build contexts are clean with .dockerignore files in place
- Ready for remaining build hygiene plans or next phase

## Self-Check: PASSED

All 8 created/modified artifacts verified on disk. Both task commits (5ff21ce, 4144057) confirmed in git log.

---
*Phase: 01-build-hygiene*
*Completed: 2026-03-06*
