# Phase 1: Build Hygiene - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Docker builds are reproducible and free of host contamination. Pin all base images, add .dockerignore files. No behavioral changes.

</domain>

<decisions>
## Implementation Decisions

### Image pinning strategy
- Pin to exact patch version (e.g., `node:20.11.1-alpine3.19`, `ubuntu:24.04.1`)
- Include `redis:7.x.x-alpine` in docker-compose.yml
- No SHA256 digests — too hard to maintain for a small team

### .dockerignore scope
- Standard exclusions: node_modules, .git, .env, *.md, tests, Dockerfile
- Keep it minimal — goal is preventing host contamination, not build optimization

### Claude's Discretion
- Exact version numbers to pin to (latest stable at time of implementation)
- .dockerignore file contents (standard patterns)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — standard infrastructure task. User flagged this as low priority but wants it done quickly.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — this phase only touches Dockerfiles and adds new .dockerignore files

### Established Patterns
- 7 Dockerfiles across containers/{api,web,init,tftp,rsync,ssh,dhcp}
- Multi-stage builds in api (builder+production) and web (builder+nginx)
- Alpine-based: api, init, dhcp, web (nginx stage)
- Ubuntu-based: tftp, rsync, ssh (need Ubuntu packages like tftpd-hpa)

### Integration Points
- docker-compose.yml references `redis:7-alpine` (also needs pinning)
- No other compose images need pinning (all others use `build:`)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-build-hygiene*
*Context gathered: 2026-03-06*
