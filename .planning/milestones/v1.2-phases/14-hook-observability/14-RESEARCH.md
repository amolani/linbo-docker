# Phase 14: Hook Observability - Research

**Researched:** 2026-03-10
**Domain:** Shell scripting (BusyBox-compatible), Node.js Express API, build manifest/observability tooling
**Confidence:** HIGH

## Summary

Phase 14 adds observability to the existing hook system in `update-linbofs.sh`. The codebase already has a working `exec_hooks()` function (lines 106-121) that runs hooks but only prints a WARNING on failure with no persistent record. This phase wraps that function with JSON manifest recording, extends `.linbofs-patch-status` with hook warnings, adds an API endpoint to query hook state, provides a validation script, and creates a scaffold generator.

All six deliverables are contained within established patterns: shell scripts follow Phase 13's BusyBox-compatible conventions (`linbofs-audit.sh`, `linbofs-diff.sh`), the API route follows the existing `system/` sub-router pattern, and the Makefile target follows Phase 13's `linbofs-audit`/`linbofs-diff` targets. No new libraries or frameworks are needed.

**Primary recommendation:** Modify `exec_hooks()` in `update-linbofs.sh` to record per-hook results into a JSON manifest, extend `linbofs.service.js` with hook-scanning functions, add a new `system/hooks.js` sub-router, and create two new scripts in `scripts/server/`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all decisions delegated to Claude's discretion.

### Claude's Discretion
User explicitly delegated all design decisions to Claude. The following areas are open:

- **Build manifest format** -- JSON structure for `.linbofs-build-manifest.json` (hook names, exit codes, file counts, timestamps)
- **Build log retention** -- How `linbofs.service.js` manages `.linbofs-build.log` rotation (last 3 builds)
- **API response format** -- `GET /system/hooks` response schema (installed hooks, exit codes, executable status)
- **Validation rules** -- What `validate-hook.sh` checks (shebang, executable bit, path validation) and how it reports
- **Scaffold template** -- What `make new-hook NAME=... TYPE=...` generates (boilerplate, exported variable docs, error handling)
- **Patch-status extension** -- How hook warning summary integrates into `.linbofs-patch-status`

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HOOK-01 | Build-Manifest JSON (`.linbofs-build-manifest.json`) with hook names, exit codes, file counts, timestamps | Modify `exec_hooks()` in update-linbofs.sh; use `date`, `find`, `wc` for metadata; write JSON with printf/echo |
| HOOK-02 | Build-Log Retention (`.linbofs-build.log`, last 3 builds, via linbofs.service.js) | Add log rotation to `linbofs.service.js` `updateLinbofs()` function; capture stdout to timestamped log file |
| HOOK-03 | `GET /system/hooks` API endpoint (installed hooks, last exit code, executable status) | New `system/hooks.js` sub-router; reads manifest JSON + scans hook directories; follows existing route patterns |
| HOOK-04 | `validate-hook.sh` script (shebang, executable bit, path validation) | New script in `scripts/server/`; follows `linbofs-audit.sh` pattern; BusyBox-compatible checks |
| HOOK-05 | Hook scaffold generator (`make new-hook NAME=... TYPE=...`) | New Makefile target; generates hook skeleton with exported variable docs and error handling |
| HOOK-06 | `.linbofs-patch-status` extended with hook warning summary | Extend Step 14.5 in update-linbofs.sh; `getPatchStatus()` already reads this file |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| bash + BusyBox utils | Alpine 3.21 | Shell scripting in container | Already established; Phase 13 patterns proven |
| Node.js 20 + Express | 20.20.0 | API route for hook status | Existing API framework |
| Jest | (existing) | Unit tests for new service functions | Existing test framework |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `jq` | JSON formatting in shell (NOT required -- use printf) | NOT available in container; avoid dependency |
| `find + wc` | File counting in hooks | Already used throughout update-linbofs.sh |
| `stat` | File metadata (size, mtime, permissions) | Already used in linbofs-audit.sh |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell-generated JSON | Node.js manifest writer | Shell is simpler; runs in same process as hooks; no IPC needed |
| jq for JSON formatting | printf/echo with escaping | jq not installed in container; printf is sufficient for simple JSON |
| New npm package for log rotation | fs.readdir + sort + unlink | Log rotation is 10 lines of code; no dependency needed |

## Architecture Patterns

### Recommended Project Structure
```
scripts/server/
  update-linbofs.sh          # MODIFIED: exec_hooks() writes manifest + extends patch-status
  validate-hook.sh           # NEW: Hook validation diagnostic script
  linbofs-audit.sh           # EXISTING (pattern reference)
  linbofs-diff.sh            # EXISTING (pattern reference)

containers/api/src/
  routes/system/
    hooks.js                 # NEW: GET /system/hooks route
    index.js                 # MODIFIED: mount hooks.js
  services/
    linbofs.service.js       # MODIFIED: add getHooks(), build log rotation
    hook.service.js           # NEW: hook scanning + manifest reading logic

Makefile                      # MODIFIED: add new-hook target
```

### Pattern 1: exec_hooks() with Manifest Recording
**What:** Enhance `exec_hooks()` to track per-hook execution results and write them to a JSON manifest file.
**When to use:** Every linbofs rebuild (pre-hooks and post-hooks).
**How it works:**

The current `exec_hooks()` (lines 106-121) runs hooks and prints warnings. The enhanced version:
1. Before each hook: count files in WORKDIR (`find . -type f | wc -l`)
2. Run hook, capture exit code
3. After hook: re-count files, compute delta
4. Accumulate results in shell variables
5. After all hooks complete: write `.linbofs-build-manifest.json`

```bash
# Pattern: BusyBox-compatible JSON generation without jq
# Source: Established codebase pattern (update-linbofs.sh uses printf throughout)
write_manifest() {
    local manifest_file="$LINBO_DIR/.linbofs-build-manifest.json"
    printf '{\n'
    printf '  "buildTimestamp": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "hooks": [\n'
    # ... hook entries from accumulated data ...
    printf '  ]\n'
    printf '}\n'
} > "$manifest_file"
```

### Pattern 2: System Sub-Router (Express.js)
**What:** New `hooks.js` file in `containers/api/src/routes/system/` following the established pattern.
**When to use:** For the `GET /system/hooks` endpoint.
**Example:**
```javascript
// Source: Follows exact pattern of system/linbofs.js, system/linbo-update.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const hookService = require('../../services/hook.service');

router.get('/hooks', authenticateToken, async (req, res, next) => {
  try {
    const hooks = await hookService.getHooks();
    res.json({ data: hooks });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

### Pattern 3: Makefile Target with Variables
**What:** `make new-hook NAME=... TYPE=...` generates a hook scaffold file.
**When to use:** When admin wants to create a new hook.
**Example:**
```makefile
# Source: Follows linbofs-audit pattern (Phase 13)
new-hook:
ifndef NAME
	$(error NAME is required. Usage: make new-hook NAME=my-hook TYPE=pre)
endif
	@docker exec linbo-api bash /usr/share/linuxmuster/linbo/new-hook.sh "$(NAME)" "$(or $(TYPE),pre)"
```

### Anti-Patterns to Avoid
- **Do NOT use jq in shell scripts:** Not installed in the Alpine container. Use printf for JSON generation.
- **Do NOT modify init.sh or linbo.sh:** CLAUDE.md rule -- only hooks, never vanilla files.
- **Do NOT fail the build on hook failures:** Existing behavior is WARNING + continue; manifest records failures but does not abort.
- **Do NOT use grep -P:** BusyBox grep lacks -P flag. Use sed or awk instead (Phase 13 lesson).
- **Do NOT use `grep -c`:** Exits non-zero on 0 matches, breaks `set -e`. Use `{ grep ... || true; } | wc -l` pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON generation in shell | Custom escaping logic | printf with known-safe field values | Hook names are filesystem names (alphanumeric + underscore + hyphen); no special escaping needed beyond what printf provides |
| Log file rotation | Complex rotation daemon | `ls -t` + `tail -n +N` + `rm` in Node.js | Only 3 files to retain; trivial sort-and-delete |
| File permission checking | Custom stat parsing | `test -x` for executable, `head -1` for shebang | Standard POSIX tools, no parsing needed |

**Key insight:** Every deliverable in this phase is small and self-contained. The main complexity is getting the integration points right (exec_hooks modification, patch-status extension, route mounting), not the individual implementations.

## Common Pitfalls

### Pitfall 1: JSON Generation with Special Characters in Shell
**What goes wrong:** Hook names could theoretically contain characters that break JSON (quotes, backslashes).
**Why it happens:** Using echo/printf with unescaped variables.
**How to avoid:** Hook names come from filenames in the hooks directory. The existing `basename` extraction produces safe strings. Additionally, `validate-hook.sh` should reject hooks with unsafe names. Use sed to escape any remaining edge cases: `echo "$name" | sed 's/\\/\\\\/g; s/"/\\"/g'`.
**Warning signs:** Test with a hook named `test"hook` or `hook\with\backslash`.

### Pitfall 2: File Count Delta Includes WORKDIR Temp Files
**What goes wrong:** `find . -type f | wc -l` before/after a hook counts ALL files, including any temp files the hook creates and deletes.
**Why it happens:** Hooks run in WORKDIR (extracted linbofs root). Some hooks may create and clean up temp files.
**How to avoid:** The file count delta is informational, not exact. Document it as "approximate file modifications". The before/after snapshot is the best available approach without hook-level filesystem monitoring.
**Warning signs:** Negative file count deltas (hook deleted more files than it added).

### Pitfall 3: Race Condition on Manifest File
**What goes wrong:** API reads `.linbofs-build-manifest.json` while `update-linbofs.sh` is mid-write.
**Why it happens:** Shell writes are not atomic.
**How to avoid:** Write to a temp file first, then `mv` (atomic on same filesystem). This is the same pattern used for `linbofs64.new` -> `linbofs64`.
**Warning signs:** Truncated or malformed JSON from the API endpoint.

### Pitfall 4: Build Log Grows Unbounded
**What goes wrong:** Without rotation, `.linbofs-build.log` grows on every rebuild.
**Why it happens:** `linbofs.service.js` captures full stdout (can be 100+ lines per build).
**How to avoid:** Rotate BEFORE starting a new build: keep last 3 logs as `.linbofs-build.{1,2,3}.log`, delete oldest.
**Warning signs:** Disk usage growth in `/srv/linbo/`.

### Pitfall 5: validate-hook.sh False Positive on Absolute Paths
**What goes wrong:** Validation rejects hooks that legitimately use absolute paths (e.g., reading from `/root/linbo-docker/plymouth/`).
**Why it happens:** Rule says "use of absolute paths that should be relative" -- but some absolute paths are correct (source paths outside WORKDIR).
**How to avoid:** Only flag absolute paths that reference WORKDIR-internal paths (e.g., `/var/cache/linbo/linbofs-build.XXXXX/usr/...`). Legitimate external source paths like `/root/...` or `/etc/...` are fine. The validation should warn on patterns like `$WORKDIR/...` used as absolute path instead of relative.
**Warning signs:** The existing `01_edulution-plymouth` hook uses absolute source paths -- it must pass validation.

## Code Examples

### Example 1: Enhanced exec_hooks() with Manifest Recording
```bash
# BusyBox-compatible hook executor with manifest recording
# Variables: HOOK_RESULTS accumulates JSON array entries

HOOK_RESULTS=""
HOOK_WARNINGS=0

exec_hooks() {
    case "$1" in
        pre|post) ;;
        *) return ;;
    esac
    local hookdir="$HOOKSDIR/update-linbofs.$1.d"
    [ -d "$hookdir" ] || return 0
    local hook_files
    hook_files=$(find "$hookdir" -type f -executable 2>/dev/null | sort)
    [ -z "$hook_files" ] && return 0
    local file exit_code files_before files_after files_delta
    for file in $hook_files; do
        local hook_name
        hook_name=$(basename "$file")
        files_before=$(find . -type f 2>/dev/null | wc -l)
        echo "Executing $1 hook: $hook_name"
        "$file" && exit_code=0 || exit_code=$?
        files_after=$(find . -type f 2>/dev/null | wc -l)
        files_delta=$((files_after - files_before))
        if [ "$exit_code" -ne 0 ]; then
            echo "  WARNING: hook $hook_name exited with $exit_code"
            HOOK_WARNINGS=$((HOOK_WARNINGS + 1))
        fi
        # Accumulate manifest entry (comma-separated)
        [ -n "$HOOK_RESULTS" ] && HOOK_RESULTS="${HOOK_RESULTS},"
        HOOK_RESULTS="${HOOK_RESULTS}
    {\"name\":\"${hook_name}\",\"type\":\"$1\",\"exitCode\":${exit_code},\"filesDelta\":${files_delta}}"
    done
}
```

### Example 2: Write Manifest JSON
```bash
# Called after both pre and post hooks complete, before final summary
write_build_manifest() {
    local manifest_file="$LINBO_DIR/.linbofs-build-manifest.json"
    local tmp_manifest="${manifest_file}.tmp"
    {
        printf '{\n'
        printf '  "buildTimestamp": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '  "kernelVariant": "%s",\n' "$KTYPE"
        printf '  "kernelVersion": "%s",\n' "${KVERS:-unknown}"
        printf '  "hookWarnings": %d,\n' "$HOOK_WARNINGS"
        printf '  "hooks": [%s\n  ]\n' "$HOOK_RESULTS"
        printf '}\n'
    } > "$tmp_manifest"
    mv "$tmp_manifest" "$manifest_file"
    chmod 644 "$manifest_file"
}
```

### Example 3: Extended .linbofs-patch-status
```bash
# Current format (Step 14.5):
#   # Build Status -- 2026-03-06T11:19:27Z
#   build|OK

# Extended format:
#   # Build Status -- 2026-03-10T14:30:00Z
#   build|OK
#   hooks|2 run, 0 warnings
# or:
#   hooks|3 run, 1 warnings: 02_custom-patch(exit=1)
```

### Example 4: Hook Service (Node.js)
```javascript
// containers/api/src/services/hook.service.js
const fs = require('fs').promises;
const path = require('path');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const HOOKS_DIR = process.env.HOOKSDIR || '/etc/linuxmuster/linbo/hooks';

async function getHooks() {
  const hooks = [];
  for (const phase of ['pre', 'post']) {
    const dir = path.join(HOOKS_DIR, `update-linbofs.${phase}.d`);
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        hooks.push({
          name: file,
          type: phase,
          path: filePath,
          executable: !!(stat.mode & 0o111),
          size: stat.size,
        });
      }
    } catch { /* directory doesn't exist */ }
  }

  // Merge with manifest data (last exit codes)
  const manifest = await readManifest();
  for (const hook of hooks) {
    const entry = manifest?.hooks?.find(h => h.name === hook.name && h.type === hook.type);
    if (entry) {
      hook.lastExitCode = entry.exitCode;
      hook.lastFilesDelta = entry.filesDelta;
    }
  }

  return {
    hooks,
    lastBuild: manifest?.buildTimestamp || null,
    hookWarnings: manifest?.hookWarnings || 0,
  };
}

async function readManifest() {
  try {
    const content = await fs.readFile(path.join(LINBO_DIR, '.linbofs-build-manifest.json'), 'utf8');
    return JSON.parse(content);
  } catch { return null; }
}

module.exports = { getHooks, readManifest };
```

### Example 5: Build Log Rotation in linbofs.service.js
```javascript
// Add to linbofs.service.js updateLinbofs() or as a separate function
async function rotateBuildLogs() {
  const logBase = path.join(LINBO_DIR, '.linbofs-build');
  const logs = [];
  try {
    const files = await fs.readdir(LINBO_DIR);
    for (const f of files) {
      if (f.startsWith('.linbofs-build') && f.endsWith('.log')) {
        const stat = await fs.stat(path.join(LINBO_DIR, f));
        logs.push({ name: f, mtime: stat.mtimeMs });
      }
    }
  } catch { return; }
  // Sort newest first, delete beyond 3
  logs.sort((a, b) => b.mtime - a.mtime);
  for (const log of logs.slice(3)) {
    await fs.unlink(path.join(LINBO_DIR, log.name)).catch(() => {});
  }
}
```

### Example 6: validate-hook.sh Checks
```bash
#!/bin/bash
# Validates hook scripts for common issues
# Usage: validate-hook.sh [hook-file]  or  validate-hook.sh --all

ERRORS=0
check_hook() {
    local file="$1"
    local name
    name=$(basename "$file")

    # Check 1: Shebang
    local firstline
    firstline=$(head -1 "$file")
    case "$firstline" in
        '#!'*) ;;
        *) echo "  FAIL: $name — missing shebang (first line: '$firstline')"; ERRORS=$((ERRORS+1)) ;;
    esac

    # Check 2: Executable bit
    if [ ! -x "$file" ]; then
        echo "  FAIL: $name — not executable (run: chmod +x $file)"
        ERRORS=$((ERRORS+1))
    fi

    # Check 3: Absolute paths that should be relative (WORKDIR-internal)
    # Flag patterns like /var/cache/linbo/linbofs-build or hardcoded WORKDIR paths
    if grep -qE '(^|[^#])/var/cache/linbo/linbofs' "$file" 2>/dev/null; then
        echo "  WARN: $name — uses hardcoded WORKDIR path (use relative paths or \$WORKDIR)"
        ERRORS=$((ERRORS+1))
    fi

    # Check 4: Valid filename (alphanumeric, underscore, hyphen)
    case "$name" in
        *[!a-zA-Z0-9_-]*) echo "  FAIL: $name — contains invalid characters"; ERRORS=$((ERRORS+1)) ;;
    esac
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hooks print WARNING, no record | Record to JSON manifest | This phase | Enables API visibility, monitoring |
| Build output lost after execution | Build log retained (last 3) | This phase | Post-mortem debugging of failed hooks |
| No hook validation | validate-hook.sh pre-flight checks | This phase | Prevents broken hooks from being installed |
| Manual hook file creation | `make new-hook` scaffold generator | This phase | Consistent boilerplate, documented variables |

**No deprecated items** -- this phase introduces new observability features on top of a stable hook system.

## Integration Points (Critical)

### 1. update-linbofs.sh Modifications
**Files changed:** `scripts/server/update-linbofs.sh`
**What changes:**
- `exec_hooks()` function (lines 106-121): Add file counting, exit code capture, result accumulation
- New `write_build_manifest()` function: Writes `.linbofs-build-manifest.json`
- Step 14.5 (line 566-570): Extend `.linbofs-patch-status` with hook warning summary
- Call `write_build_manifest()` after Step 15.5 (post-hooks) and before Summary

**Critical constraint:** Per CLAUDE.md, `update-linbofs.sh` should only be modified for build-process bugs/improvements, not for content changes. Manifest recording IS a build-process improvement (observability), so this modification is allowed.

### 2. linbofs.service.js Modifications
**Files changed:** `containers/api/src/services/linbofs.service.js`
**What changes:**
- `updateLinbofs()`: Add build log capture + rotation before/after script execution
- `getPatchStatus()`: Parse extended patch-status format (hook warning line)

### 3. System Routes
**Files changed:**
- `containers/api/src/routes/system/hooks.js` (NEW)
- `containers/api/src/routes/system/index.js` (add `require('./hooks')`)

### 4. Docker Volume Sync
**Note:** Step 14.6 in `update-linbofs.sh` already syncs `.linbofs-patch-status` to Docker volume. The manifest file (`.linbofs-build-manifest.json`) needs to be added to this sync step.

### 5. Script Deployment
Scripts in `scripts/server/` are bind-mounted to `/usr/share/linuxmuster/linbo/` in the API container via `docker-compose.yml`. New scripts (`validate-hook.sh`, `new-hook.sh`) are automatically available.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (existing, in containers/api) |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `docker exec linbo-api npx jest --testPathPattern=hook --runInBand` |
| Full suite command | `docker exec linbo-api npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOOK-01 | Manifest JSON written with hook data | unit | `docker exec linbo-api npx jest tests/services/hook.service.test.js -x` | No -- Wave 0 |
| HOOK-02 | Build log rotation keeps last 3 | unit | `docker exec linbo-api npx jest tests/services/linbofs.service.test.js -x` | Yes (extend) |
| HOOK-03 | GET /system/hooks returns hook list | unit | `docker exec linbo-api npx jest tests/routes/system.hooks.test.js -x` | No -- Wave 0 |
| HOOK-04 | validate-hook.sh detects issues | smoke | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/validate-hook.sh --all` | No (script itself is test) |
| HOOK-05 | make new-hook creates valid scaffold | smoke | `make new-hook NAME=test-hook TYPE=pre && docker exec linbo-api bash /usr/share/linuxmuster/linbo/validate-hook.sh /etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/test-hook` | No (manual verification) |
| HOOK-06 | patch-status includes hook summary | unit | `docker exec linbo-api npx jest tests/services/hook.service.test.js -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `docker exec linbo-api npx jest --testPathPattern=hook --runInBand`
- **Per wave merge:** `docker exec linbo-api npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `containers/api/tests/services/hook.service.test.js` -- covers HOOK-01, HOOK-03, HOOK-06 (manifest reading, hook scanning, patch-status parsing)
- [ ] `containers/api/tests/routes/system.hooks.test.js` -- covers HOOK-03 (route-level test)
- [ ] No framework install needed -- Jest already configured

## Open Questions

1. **Build log naming convention**
   - What we know: Logs should be retained (last 3 builds). Could use timestamps or rotation numbers.
   - What's unclear: Whether timestamp-based names (`.linbofs-build.2026-03-10T14-30-00Z.log`) or numbered rotation (`.linbofs-build.1.log`) is preferred.
   - Recommendation: Use timestamps -- they are self-documenting and avoid renaming complexity. `rotateBuildLogs()` simply sorts by mtime and deletes oldest.

2. **Manifest written by shell vs Node.js**
   - What we know: Shell writes manifest during update-linbofs.sh execution (synchronous, same process as hooks). Node.js reads it via API.
   - What's unclear: Whether Node.js should also write/augment the manifest (e.g., adding build log path).
   - Recommendation: Shell writes the authoritative manifest (it has hook execution data). Node.js only reads. Build log path is derivable from timestamp, no need to store it.

## Sources

### Primary (HIGH confidence)
- `scripts/server/update-linbofs.sh` -- current exec_hooks() implementation (lines 106-121), Step 14.5 patch-status writing (lines 566-570)
- `containers/api/src/services/linbofs.service.js` -- getPatchStatus() implementation (line 336-345), updateLinbofs() pattern
- `containers/api/src/routes/system/index.js` -- sub-router mounting pattern
- `containers/api/src/routes/system/linbofs.js` -- route pattern (authenticateToken, service call, res.json)
- `scripts/server/linbofs-audit.sh` -- Phase 13 BusyBox-compatible shell script pattern
- `docs/hooks.md` -- hook system documentation (directories, variables, execution rules)
- `Makefile` -- Phase 13 targets pattern (linbofs-audit, linbofs-diff via docker exec)
- `docker-compose.yml` -- scripts/server mounted at /usr/share/linuxmuster/linbo
- `/etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/01_edulution-plymouth` -- existing hook example
- Live `.linbofs-patch-status` content: `# Build Status -- 2026-03-06T11:19:27Z\nbuild|OK`

### Secondary (MEDIUM confidence)
- `containers/api/jest.config.js` -- test framework configuration
- `containers/api/tests/services/linbofs.service.test.js` -- existing test patterns (mocking child_process, temp dirs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already in the codebase, no new dependencies
- Architecture: HIGH -- follows established patterns from Phase 13 and existing system routes
- Pitfalls: HIGH -- identified from direct code inspection of exec_hooks(), container environment, and existing hook
- Integration points: HIGH -- all files inspected, bind-mount path confirmed, patch-status format verified from live container

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable -- internal tooling, no external dependencies)
