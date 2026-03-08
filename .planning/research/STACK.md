# Technology Stack

**Project:** LINBO Docker v1.1 -- Fresh Install & Production Readiness
**Researched:** 2026-03-08
**Mode:** Subsequent milestone (stack additions only)

## Executive Decision

**No new npm dependencies needed.** The existing stack already contains every library required for v1.1 features. The work is about using Zod (already installed), improving shell scripts (bash, no deps), and writing Markdown documentation (no tooling). Adding dependencies for a "fresh install" milestone would be ironic -- the goal is to make the existing system easier to install, not to add more things to install.

## Existing Stack (DO NOT CHANGE)

These are validated and working. Listed here so the roadmap knows what to build on.

| Technology | Version | Purpose |
|------------|---------|---------|
| Express.js | ^4.18.2 | REST API framework |
| Zod | ^3.22.4 | Request validation (already used in validate.js middleware) |
| dotenv | ^16.3.1 | Environment variable loading |
| ioredis | ^5.3.2 | Redis client, settings storage, pub/sub |
| ws | ^8.16.0 | WebSocket server |
| bcryptjs | ^2.4.3 | Password hashing |
| jsonwebtoken | ^9.0.2 | JWT auth |
| Docker Compose | v2 | Container orchestration |
| Node.js 20 | 20.20.0-alpine | API runtime |
| Redis | 7.4.7-alpine | Cache, settings, sync |
| Nginx | 1.29.5-alpine | Reverse proxy, SPA serving |

## Recommended Stack Additions for v1.1

### Category 1: Environment Validation (NO new packages)

**Use Zod ^3.22.4 (already installed) for .env validation at startup.**

The project already has Zod in `containers/api/package.json` and uses it extensively in `src/middleware/validate.js` for request validation. Extending it to validate `process.env` at startup is trivial -- no new dependency needed.

| What | How | Why |
|------|-----|-----|
| Env validation schema | New file: `src/lib/env-schema.js` using `z.object()` | Fail-fast on missing/invalid env vars |
| Startup validation | Call `envSchema.parse(process.env)` before `startServer()` | Replace ad-hoc `validateSecrets()` in index.js |
| Typed env access | Export parsed env object, import instead of raw `process.env` | Single source of truth, no typos |

**Pattern (uses existing Zod):**
```javascript
const { z } = require('zod');
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(16),
  INTERNAL_API_KEY: z.string().min(16),
  LINBO_SERVER_IP: z.string().ip(),
  REDIS_HOST: z.string().default('linbo-cache'),
  // ...
});
module.exports = envSchema.parse(process.env);
```

**Why not `znv`, `envalid`, or `t3-env`:** Adding a wrapper library around Zod for a CommonJS Node.js project would be gratuitous. The raw `z.object().parse(process.env)` pattern is 10 lines of code. These wrapper libraries add value for TypeScript ESM projects with IDE type inference -- not applicable here.

### Category 2: Install Script Improvements (shell only)

**Improve `scripts/install.sh` using standard Unix tools. No new system packages beyond what Docker provides.**

| What | Tool | Why |
|------|------|-----|
| Secret generation | `openssl rand` (already used) | Cryptographically secure, available on all Linux |
| IP detection | `ip route` + `hostname -I` (already used) | Standard Linux networking tools |
| Prerequisite checks | `command -v`, `docker compose version` (already used) | POSIX compatible |
| Network validation | `curl` + exit codes (already used) | Verify APT repo reachable, DNS works |
| Port conflict check | `ss -tlnp` (already used in status.sh) | Detect 69/873/2222/3000/8080 conflicts pre-start |

**Key fixes needed (no new deps):**
1. `.env` generation: move from hardcoded template to reading `.env.example` + variable substitution
2. GITHUB_TOKEN handling: prompt or skip `@edulution-io/ui-kit` gracefully
3. Rsync secrets: generate `config/rsyncd.secrets` from template (already fixed in v1.0 PROD-05)
4. Pre-flight checks: verify Docker daemon running, disk space, required ports free
5. Post-install verification: hit `/health` endpoint and parse JSON response

### Category 3: Admin Documentation (Markdown only)

**Write plain Markdown files in `docs/admin/`. No documentation tooling (no MkDocs, no Docusaurus, no VitePress).**

| Decision | Rationale |
|----------|-----------|
| Plain Markdown in `docs/admin/` | Renders on GitHub/GitLab without build step. Admins using LINBO Docker are sysadmins, not developers -- they read docs in repos, not hosted sites. |
| No MkDocs/Material | MkDocs-Material entered maintenance mode (9.7.0 is final). Its successor Zensical is too new (0.x). Adding a Python toolchain for documentation in a Node.js/Docker project is wrong. |
| No Docusaurus/VitePress | Requires npm build, hosting, CI/CD. Overkill for ~10 pages of admin docs. |
| No separate docs container | Zero operational overhead. Docs live in the repo. |

**Documentation structure:**
```
docs/admin/
  INSTALL.md          # Step-by-step fresh install guide
  CONFIGURATION.md    # All .env variables explained
  ARCHITECTURE.md     # System overview for admins
  TROUBLESHOOTING.md  # Common problems and solutions
  UPGRADE.md          # Version upgrade procedures
  NETWORK.md          # PXE/DHCP/TFTP network setup
```

### Category 4: Docker Compose Improvements (configuration only)

**No new images or containers. Improve existing docker-compose.yml patterns.**

| What | How | Why |
|------|-----|-----|
| Init container error reporting | Add stderr output to init container logs | Currently silent on APT failures |
| Health check tuning | Adjust `start_period` and `retries` based on real timing data | Init container takes 30-90s; current 60s start_period is tight |
| Environment variable documentation | Inline comments in docker-compose.yml for every variable | Self-documenting compose file |
| Profile for standalone mode | `profiles: ["standalone"]` for PostgreSQL container | Currently in separate deploy/docker-compose.yml; unify |

## Alternatives Considered (and Rejected)

| Category | Rejected | Why Not |
|----------|----------|---------|
| Env validation | `envalid` (npm) | Adds a dependency for what Zod already does. Project already has Zod. |
| Env validation | `dotenv-safe` (npm) | Only checks presence, not types/formats. Zod validates content. |
| Env validation | `@t3-oss/env-core` (npm) | TypeScript-first, designed for Next.js. Overkill for CommonJS Express. |
| Documentation | MkDocs Material | Entered maintenance mode (2026). Python toolchain in a Node.js project. Unnecessary build step. |
| Documentation | Docusaurus 3.x | React-based, requires npm build + hosting. Massive overkill for 10 docs pages. |
| Documentation | VitePress | Vue-based SSG. Requires separate build/deploy. Same overkill argument. |
| Configuration | HashiCorp Vault | Enterprise secrets management. Target audience is school sysadmins running single-server Docker. |
| Configuration | Docker Swarm secrets | Requires Swarm mode. Project uses standalone Docker Compose. |
| Configuration | Mozilla SOPS | Encrypted secrets in git. Adds operational complexity for a system where `.env` is never committed. |
| Setup wizard | Web-based setup UI | First-run browser wizard (like WordPress). Adds significant code for a one-time flow. Shell script is appropriate for the sysadmin audience. |
| Install | Ansible playbook | Configuration management tool. Over-engineered for "clone, configure, up". The audience runs this on 1-3 servers. |

## What to Keep, What to Change

### Keep As-Is
- **All npm dependencies** -- no additions, no removals, no version bumps
- **Container base images** -- already pinned in v1.0 (node:20.20.0-alpine3.21, nginx:1.29.5-alpine, redis:7.4.7-alpine, alpine:3.19.9)
- **Makefile** -- existing targets are sufficient, maybe add `make install` alias
- **Deploy script** -- already uses INTERNAL_API_KEY (fixed in v1.0 PROD-04)
- **Settings service** -- Redis-based runtime config with env fallback is the right pattern

### Change (Improve)
- **Startup validation** -- replace ad-hoc `validateSecrets()` with comprehensive Zod env schema
- **Install script** -- add pre-flight checks, better error messages, GITHUB_TOKEN handling
- **Docker Compose** -- unify sync/standalone compose files, better health check timing
- **.env.example** -- consolidate the 3 existing .env files into one authoritative template with full documentation
- **Error messages** -- startup failures should print actionable messages ("Run `openssl rand -base64 48` and set JWT_SECRET in .env")

### Do Not Add
- No new npm packages
- No documentation build toolchain
- No configuration management tools (Ansible, Puppet)
- No secrets management infrastructure (Vault, SOPS)
- No web-based setup wizard
- No CI/CD pipeline (out of scope for this milestone)

## Integration Points

The v1.1 stack additions integrate with existing code at these points:

| New Component | Integrates With | How |
|---------------|----------------|-----|
| `src/lib/env-schema.js` | `src/index.js` (startup) | Import replaces `validateSecrets()`, parsed env replaces `process.env.*` |
| `src/lib/env-schema.js` | `src/middleware/validate.js` | Same Zod patterns, consistent error formatting |
| `src/lib/env-schema.js` | `src/services/settings.service.js` | Env defaults come from validated schema, not raw `process.env` |
| Install script | `.env.example` | Script reads template, substitutes generated values |
| Install script | `docker-compose.yml` | Runs `docker compose up -d` after env setup |
| Admin docs | `docs/admin/` | New directory, no integration needed |

## Version Compatibility

| Component | Current | Target | Notes |
|-----------|---------|--------|-------|
| Zod | ^3.22.4 | ^3.22.4 (no change) | `z.string().ip()` added in 3.22.0, already available |
| Node.js | 20.20.0 | 20.20.0 (no change) | LTS until April 2026 |
| Docker Compose | v2 | v2 (no change) | `service_completed_successfully` condition already used |
| Docker Engine | 24+ | 24+ (no change) | Required for Compose v2 healthchecks |

## Installation Requirements for Fresh Setup

Based on the existing `scripts/install.sh`, a fresh VM needs:

| Prerequisite | Installed By | Version |
|-------------|-------------|---------|
| Docker Engine | install.sh (get.docker.com) | 24+ |
| Docker Compose | install.sh (apt plugin) | v2.20+ |
| git | install.sh (apt) | any |
| curl | install.sh (apt) | any |
| openssl | install.sh (apt) | any |

No additional system packages needed for v1.1.

## Sources

- [Zod env validation pattern](https://dev.to/roshan_ican/validating-environment-variables-in-nodejs-with-zod-2epn) -- confirms Zod-based env validation is standard practice
- [Docker Compose healthcheck best practices](https://docs.docker.com/compose/how-tos/startup-order/) -- official Docker docs on startup order
- [Docker secrets in Compose](https://docs.docker.com/compose/how-tos/use-secrets/) -- evaluated and rejected for this use case
- [Docker env var best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/) -- official Docker guidance
- [MkDocs Material maintenance mode](https://squidfunk.github.io/mkdocs-material/) -- 9.7.0 is final version, entering maintenance
- Existing codebase: `containers/api/src/middleware/validate.js` confirms Zod patterns
- Existing codebase: `containers/api/src/index.js:190-254` shows current `validateSecrets()` implementation
- Existing codebase: `scripts/install.sh` shows current install flow

---
*Stack research: 2026-03-08*
*Confidence: HIGH -- recommendations build on existing validated stack with zero new dependencies*
