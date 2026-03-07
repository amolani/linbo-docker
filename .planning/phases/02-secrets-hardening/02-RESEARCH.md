# Phase 2: Secrets Hardening - Research

**Researched:** 2026-03-07
**Domain:** API startup validation, deploy script authentication, git secret cleanup
**Confidence:** HIGH

## Summary

Phase 2 addresses three discrete secrets-related problems: (1) the API server starts without complaint when JWT_SECRET or INTERNAL_API_KEY have their default/placeholder values in production, (2) the deploy script `scripts/deploy.sh` authenticates to the API using a hardcoded `admin/Muster!` login, and (3) `config/rsyncd.secrets` containing `linbo:Muster!` is tracked in git with a `.gitignore` override rule `!config/rsyncd.secrets`.

All three problems are well-scoped with clear integration points. The codebase already has the infrastructure needed: `authenticateToken` in `auth.js` already accepts `INTERNAL_API_KEY` as a Bearer token, the deploy script's auth section is isolated to a single `if` block, and `.gitignore` explicitly includes `rsyncd.secrets` via an exception rule.

**Primary recommendation:** Implement all three fixes as separate, atomic changes. Start with the API startup validation (foundational), then deploy script auth migration (depends on understanding INTERNAL_API_KEY flow), then rsyncd.secrets cleanup (standalone git operation).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Block API start in NODE_ENV=production if JWT_SECRET or INTERNAL_API_KEY have default values
- Exit with clear error message naming the offending variable
- Only JWT_SECRET and INTERNAL_API_KEY -- NOT ADMIN_PASSWORD or DB_PASSWORD
- In NODE_ENV=development: log warning if defaults are used, but don't block
- CORS_ORIGIN validation is Phase 3 scope -- not included here
- Read INTERNAL_API_KEY from remote server's .env file (SSH into target, grep .env)
- Use X-Internal-Key header directly -- no login/JWT flow needed
- deploy.sh is a development tool, not for production deployments
- Include rsync container restart in --rebuild flow
- Multi-target support: comma-separated hosts (e.g., `deploy.sh host1,host2 --rebuild`)
- Targets execute in user-specified order (no automatic sorting/enforcement)
- Remove config/rsyncd.secrets from git tracking
- Add config/rsyncd.secrets to .gitignore
- Create config/rsyncd.secrets.example with simple placeholder (linbo:CHANGE_ME), no generation hints

### Claude's Discretion
- Fallback behavior when INTERNAL_API_KEY not found in remote .env
- Error handling for multi-target deploys (stop on first failure vs continue)
- Exact error messages for startup validation
- Default value detection patterns (exact string match vs regex)

### Deferred Ideas (OUT OF SCOPE)
- ADMIN_PASSWORD default validation -- could be added later but not required for PROD-02
- DB_PASSWORD default validation -- PostgreSQL only reachable internally
- CORS_ORIGIN=* warning -- belongs in Phase 3 (API Security)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROD-02 | API refuses start when JWT_SECRET or INTERNAL_API_KEY have default values (NODE_ENV=production) | Default value catalog identified, insertion point in index.js mapped, existing test infrastructure documented |
| PROD-04 | Deploy script uses INTERNAL_API_KEY instead of default admin password for rebuilds | Existing X-Internal-Key auth flow documented, deploy.sh auth section located, authenticateToken already handles INTERNAL_API_KEY as Bearer token |
| PROD-05 | rsyncd.secrets removed from git tracking, .example file provided | Current git tracking state verified, .gitignore exception rule found, rsyncd.secrets content documented |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express.js | ^4.18.2 | API framework | Already in use, startup validation happens in index.js |
| Jest | ^29.7.0 | Test framework | Already configured with globalSetup/teardown |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | ^16.3.1 | Env loading | Already in use, loads before validation |

No new libraries are needed for this phase. Everything uses existing infrastructure.

## Architecture Patterns

### PROD-02: Startup Validation Pattern

**What:** A `validateSecrets()` function called at the top of `startServer()` in `containers/api/src/index.js`, before any connections or route mounting.

**Insertion point:** Line 161 of `index.js`, immediately after the `console.log('Starting LINBO Docker API Server...\n')` call, before PostgreSQL connection.

**Default values to detect** (cataloged from codebase):

| Variable | Default in docker-compose.yml | Default in auth.js/internal.js | Default in .env.example |
|----------|-------------------------------|-------------------------------|------------------------|
| JWT_SECRET | `your_jwt_secret_here_change_in_production` | `linbo-docker-secret-change-in-production` | `your_jwt_secret_here_change_me_in_production_use_openssl_rand` |
| INTERNAL_API_KEY | `linbo-internal-secret` | `linbo-internal-secret` | `linbo-internal-secret-change-in-production` |

**Detection approach (Claude's discretion):** Use an array of known default strings rather than regex. This is more reliable and explicit. Check both the process.env value AND whether the variable is unset (undefined/empty).

**Recommended pattern:**
```javascript
// Source: codebase analysis of index.js and auth.js patterns
function validateSecrets() {
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = nodeEnv === 'production';

  const JWT_SECRET_DEFAULTS = [
    'linbo-docker-secret-change-in-production',
    'your_jwt_secret_here_change_in_production',
    'your_jwt_secret_here_change_me_in_production_use_openssl_rand',
    'development_secret_change_in_production',
  ];

  const INTERNAL_KEY_DEFAULTS = [
    'linbo-internal-secret',
    'linbo-internal-secret-change-in-production',
  ];

  const errors = [];

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || JWT_SECRET_DEFAULTS.includes(jwtSecret)) {
    if (isProduction) {
      errors.push('JWT_SECRET');
    } else {
      console.warn('WARNING: JWT_SECRET is using a default value. Set a secure value before production use.');
    }
  }

  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey || INTERNAL_KEY_DEFAULTS.includes(internalKey)) {
    if (isProduction) {
      errors.push('INTERNAL_API_KEY');
    } else {
      console.warn('WARNING: INTERNAL_API_KEY is using a default value. Set a secure value before production use.');
    }
  }

  if (errors.length > 0) {
    console.error(`\nFATAL: Refusing to start in production with default secrets.`);
    console.error(`The following environment variables must be changed:\n`);
    errors.forEach(v => console.error(`  - ${v}`));
    console.error(`\nGenerate secure values with: openssl rand -base64 48\n`);
    process.exit(1);
  }
}
```

**Key behavior:**
- `NODE_ENV=production` + default values = exit with code 1
- `NODE_ENV=development` (or test, or unset) + default values = warning log, continue
- Must run BEFORE `server.listen()` to prevent any request handling

### PROD-04: Deploy Script Auth Migration

**What:** Replace the `admin/Muster!` login flow in `scripts/deploy.sh` with reading `INTERNAL_API_KEY` from the remote server's `.env` file.

**Current auth flow** (lines 57-60 of deploy.sh):
```bash
TOKEN=$(ssh $TARGET 'curl -sf -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"Muster!\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[\"token\"])"')
```

**New auth flow:**
1. SSH into target, grep INTERNAL_API_KEY from `.env` file
2. Use `X-Internal-Key: $KEY` header on API calls instead of `Authorization: Bearer $TOKEN`

**Critical finding:** The system routes (`/system/update-linbofs`, `/system/regenerate-grub-configs`) use `authenticateToken` middleware, which already accepts `INTERNAL_API_KEY` as a Bearer token (auth.js lines 79-83):
```javascript
const internalKey = process.env.INTERNAL_API_KEY;
if (internalKey && token === internalKey) {
  req.user = { id: 'internal', username: 'internal-service', role: 'admin' };
  return next();
}
```

This means the deploy script should use `Authorization: Bearer $KEY` header (not `X-Internal-Key`), because system routes use `authenticateToken`, while only `/internal/*` routes use the `authenticateInternal` middleware which checks `X-Internal-Key`.

**IMPORTANT CORRECTION to CONTEXT.md:** The CONTEXT says "Use X-Internal-Key header directly" but this header only works on `/api/v1/internal/*` routes. The system routes (`/system/update-linbofs`, `/system/regenerate-grub-configs`) use `authenticateToken` which accepts INTERNAL_API_KEY as a Bearer token. The deploy script should therefore use `Authorization: Bearer $KEY`.

**Multi-target support:**
```bash
# Parse comma-separated targets
IFS=',' read -ra TARGETS <<< "$TARGET_ARG"
for target in "${TARGETS[@]}"; do
  deploy_to "$target"
done
```

**Fallback when INTERNAL_API_KEY not found (Claude's discretion):**
Recommend: warn clearly and fall back to direct `docker exec` for the rebuild step (which already exists as the fallback in current code). Do NOT fall back to `admin/Muster!`.

**Multi-target error handling (Claude's discretion):**
Recommend: continue on failure (log error for failed target, proceed to next). A `--fail-fast` flag could be added but is unnecessary complexity for a dev tool. Print a summary at the end showing which targets succeeded/failed.

### PROD-05: rsyncd.secrets Git Cleanup

**Current state:**
- `config/rsyncd.secrets` IS tracked in git (confirmed: `git ls-files` returns it)
- `.gitignore` line 9: `*.secrets` (blocks all secrets files)
- `.gitignore` line 10: `!config/rsyncd.secrets` (exception -- re-includes it)
- File contents: `linbo:Muster!`

**Cleanup steps:**
1. Remove the `!config/rsyncd.secrets` exception from `.gitignore`
2. Run `git rm --cached config/rsyncd.secrets` (removes from tracking, keeps file on disk)
3. Create `config/rsyncd.secrets.example` with content: `linbo:CHANGE_ME`

**Docker-compose impact:** `docker-compose.yml` line 63 mounts `./config/rsyncd.secrets:/etc/rsyncd.secrets:ro`. After removing from git, the file must still exist on disk. This is fine -- `git rm --cached` only removes tracking, not the file itself.

### Anti-Patterns to Avoid
- **Testing production validation with NODE_ENV=production in test suites:** Tests must set NODE_ENV=test (already done in globalSetup.js). Never let production validation fire during testing.
- **Using X-Internal-Key header for system routes:** The system routes use `authenticateToken`, not `authenticateInternal`. Use `Authorization: Bearer $KEY` for system routes.
- **Hardcoding new default passwords to replace old ones:** The goal is to eliminate defaults, not rotate them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret generation | Custom random string generator | `openssl rand -base64 48` or `openssl rand -hex 32` | Cryptographically secure, already documented in .env.example |
| Env file parsing in bash | Custom awk/sed parser | `grep '^INTERNAL_API_KEY=' .env \| cut -d= -f2` | Simple key=value format, no special characters expected |

## Common Pitfalls

### Pitfall 1: JWT_SECRET default mismatch
**What goes wrong:** There are 4 different default values for JWT_SECRET across the codebase (docker-compose.yml, auth.js, root .env.example, api .env.example). If the validation only checks one, the others can slip through.
**Why it happens:** Each file was written at a different time and uses different placeholder text.
**How to avoid:** Validate against ALL known defaults using an array, not a single string comparison.
**Warning signs:** API starts in production without real JWT_SECRET set.

### Pitfall 2: Auth header confusion (X-Internal-Key vs Bearer)
**What goes wrong:** Using `X-Internal-Key` header on system routes (`/system/update-linbofs`) results in 401 Unauthorized.
**Why it happens:** Two different auth middlewares exist: `authenticateInternal` (checks X-Internal-Key, used by `/internal/*` routes) and `authenticateToken` (checks Bearer token, used by `/system/*` routes). However, `authenticateToken` also accepts INTERNAL_API_KEY as a Bearer token.
**How to avoid:** Use `Authorization: Bearer $INTERNAL_API_KEY` for system routes in deploy.sh. This leverages the existing INTERNAL_API_KEY acceptance in authenticateToken.
**Warning signs:** Deploy script's --rebuild gets 401 errors.

### Pitfall 3: rsyncd.secrets disappears on fresh clone
**What goes wrong:** After removing `rsyncd.secrets` from git tracking, a fresh clone won't have it. Docker-compose mount fails.
**Why it happens:** The file is no longer in the repository.
**How to avoid:** Document in `rsyncd.secrets.example` that users must copy it to `rsyncd.secrets`. The install script (`scripts/install.sh`) should handle this for fresh deployments (it already generates secrets). Existing deployments are unaffected because `git rm --cached` preserves the local file.
**Warning signs:** rsync container fails to start on fresh clone.

### Pitfall 4: Environment variable not set vs default value
**What goes wrong:** `process.env.INTERNAL_API_KEY` is undefined (not set) but the code in `internal.js` has `|| 'linbo-internal-secret'` fallback, so the API functions fine with the insecure default.
**Why it happens:** docker-compose.yml sets `INTERNAL_API_KEY=${INTERNAL_API_KEY:-linbo-internal-secret}`, so even if .env omits it, docker-compose provides the fallback.
**How to avoid:** The startup validation must check BOTH undefined/empty AND known default values.
**Warning signs:** INTERNAL_API_KEY works in production despite never being explicitly set.

### Pitfall 5: deploy.sh .env parsing edge cases
**What goes wrong:** INTERNAL_API_KEY value contains special characters (=, spaces, quotes) and the grep/cut parsing breaks.
**Why it happens:** `openssl rand -base64 48` can produce `+`, `/`, and `=` characters.
**How to avoid:** Use a more robust parsing approach: `grep '^INTERNAL_API_KEY=' .env | sed 's/^INTERNAL_API_KEY=//'` or even source the .env file in a subshell. Since the key is typically a hex string (install.sh uses `openssl rand -hex 32`), this is low risk but worth handling.
**Warning signs:** Deploy script fails to authenticate on servers where INTERNAL_API_KEY was generated with base64.

## Code Examples

### Startup validation placement in index.js
```javascript
// Source: containers/api/src/index.js line 160-161
async function startServer() {
  console.log('Starting LINBO Docker API Server...\n');

  // PROD-02: Validate secrets before any connections
  validateSecrets();

  // Connect to database (existing code continues below)
  if (prisma) {
    // ...
  }
}
```

### Deploy script key extraction
```bash
# Source: new pattern for deploy.sh
# Read INTERNAL_API_KEY from remote server's .env
INTERNAL_KEY=$(ssh "$target" "grep '^INTERNAL_API_KEY=' ${REMOTE_DIR}/.env | cut -d= -f2")

if [ -z "$INTERNAL_KEY" ]; then
  echo "WARNING: INTERNAL_API_KEY not found in remote .env"
  echo "Falling back to direct docker exec for rebuild..."
  ssh "$target" "docker exec linbo-api /usr/share/linuxmuster/linbo/update-linbofs.sh"
else
  # Use as Bearer token (authenticateToken accepts INTERNAL_API_KEY)
  ssh "$target" "curl -sf -X POST http://localhost:3000/api/v1/system/update-linbofs \
    -H 'Authorization: Bearer $INTERNAL_KEY' \
    -H 'Content-Type: application/json'"
fi
```

### .gitignore diff
```diff
 # Environment & Secrets
 .env
 .env.local
 .env.*.local
 *.secrets
-!config/rsyncd.secrets
 secrets/
```

### rsyncd.secrets.example content
```
# LINBO rsync authentication
# Format: username:password
# Copy this file to rsyncd.secrets and change the password
linbo:CHANGE_ME
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded admin/Muster! in deploy.sh | Use INTERNAL_API_KEY from remote .env | This phase | Eliminates plaintext password in script |
| JWT_SECRET silently defaults | Startup validation blocks production start | This phase | Forces proper secret configuration |
| rsyncd.secrets tracked in git | .example pattern with gitignored actual file | This phase | No real credentials in repository |

## Open Questions

1. **Should docker-compose.yml defaults also be updated?**
   - What we know: docker-compose.yml has `${JWT_SECRET:-your_jwt_secret_here_change_in_production}` and `${INTERNAL_API_KEY:-linbo-internal-secret}` fallbacks
   - What's unclear: Should these compose-level defaults be removed (causing compose errors when .env is missing) or kept as-is (the API startup validation catches the problem anyway)?
   - Recommendation: Keep compose defaults as-is. They serve a purpose for development/first-run. The API-level validation is the real gate for production. Changing compose defaults would break `docker compose up` without a .env file, which is valid for development.

2. **rsync container on fresh clone**
   - What we know: After removing rsyncd.secrets from git, fresh clones need manual setup
   - What's unclear: Should deploy/install.sh be updated to auto-create rsyncd.secrets from .example?
   - Recommendation: Yes, but install.sh already handles this (line 204 area generates INTERNAL_API_KEY with openssl). If rsyncd.secrets generation is missing from install.sh, add it. This is a small follow-up, not a blocker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `cd containers/api && npx jest --testPathPattern=secrets-validation --runInBand` |
| Full suite command | `cd containers/api && npx jest --runInBand` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROD-02 | API exits with code 1 when JWT_SECRET is default + NODE_ENV=production | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x` | No -- Wave 0 |
| PROD-02 | API exits with code 1 when INTERNAL_API_KEY is default + NODE_ENV=production | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x` | No -- Wave 0 |
| PROD-02 | API warns but continues when defaults used in NODE_ENV=development | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x` | No -- Wave 0 |
| PROD-04 | Deploy script reads INTERNAL_API_KEY from remote .env | manual-only | Manual: deploy to test server with --rebuild | N/A |
| PROD-04 | Deploy script uses Bearer auth, not admin/Muster! | manual-only | Manual: verify no `admin` or `Muster!` in deploy.sh | N/A |
| PROD-05 | rsyncd.secrets not tracked in git | manual-only | `git ls-files config/rsyncd.secrets` returns empty | N/A |
| PROD-05 | rsyncd.secrets.example exists with placeholder | manual-only | `test -f config/rsyncd.secrets.example` | N/A |

### Sampling Rate
- **Per task commit:** `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x`
- **Per wave merge:** `cd containers/api && npx jest --runInBand`
- **Phase gate:** Full suite green + manual verification of deploy.sh and git tracking

### Wave 0 Gaps
- [ ] `containers/api/tests/startup-validation.test.js` -- covers PROD-02 (validates validateSecrets function)
- [ ] No additional framework install needed -- Jest is already configured

## Sources

### Primary (HIGH confidence)
- `containers/api/src/index.js` -- startup sequence, server.listen placement
- `containers/api/src/middleware/auth.js` -- JWT_SECRET default value, INTERNAL_API_KEY Bearer token acceptance (line 79-83)
- `containers/api/src/routes/internal.js` -- INTERNAL_API_KEY default value, authenticateInternal middleware
- `containers/api/src/routes/system.js` -- authenticateToken usage on system routes
- `scripts/deploy.sh` -- current admin/Muster! auth flow
- `docker-compose.yml` -- env var defaults, rsync volume mount
- `.gitignore` -- current rsyncd.secrets exception rule
- `config/rsyncd.secrets` -- current contents and git tracking status

### Secondary (MEDIUM confidence)
- `scripts/install.sh` -- INTERNAL_API_KEY generation pattern (openssl rand -hex 32)
- `.env.example` -- documented defaults

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all changes are in existing files
- Architecture: HIGH - all integration points verified by reading source code
- Pitfalls: HIGH - all default values cataloged from actual codebase files, auth flow verified

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable domain, no external dependency changes expected)
