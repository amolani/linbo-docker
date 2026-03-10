# Phase 15: Update Regression Hardening - Research

**Researched:** 2026-03-10
**Domain:** Shell script hardening, Node.js test expansion, system diagnostics
**Confidence:** HIGH

## Summary

Phase 15 hardens the LINBO update pipeline so that a linbo7 package update either completes with verified integrity or fails loudly before clients boot a broken linbofs64. The work spans three domains: (1) expanding the existing `linbo-update.service.test.js` Jest test suite with partial-failure, concurrency, and version edge-case tests, (2) adding pre-injection path checks, size/module guards, and post-rebuild CPIO verification to `update-linbofs.sh`, and (3) extending `doctor.sh` and creating a module-diff script.

All seven UPD requirements target existing files with well-established patterns. No new libraries are needed. The shell script changes use the same BusyBox-compatible patterns established in Phase 13 (`{ grep || true; } | wc -l`, `awk` fallback for `numfmt`). The Jest tests follow the existing mock pattern in the test file (mock Redis, mock fetch, mock linbofs/grub services).

**Primary recommendation:** Split into two plans: (1) shell-side hardening in update-linbofs.sh + doctor.sh + module-diff script (UPD-02 through UPD-07), (2) test-side expansion in linbo-update.service.test.js (UPD-01).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPD-01 | Test suite expansion: partial failure, concurrent 409, version edge cases | Existing test file has mock infrastructure; add 3 new `describe` blocks |
| UPD-02 | Pre-injection path check in update-linbofs.sh | Add directory existence checks before Steps 8-10.7 where `mkdir -p` masks missing structure |
| UPD-03 | Size range check (warn >80MB, fail >200MB) + module count verification | Extend Step 12 in update-linbofs.sh; current only checks >10MB minimum |
| UPD-04 | Post-rebuild CPIO verification (both XZ segments, dev/console present) | Add after Step 12 using `xz -t` per segment + cpio listing check |
| UPD-05 | Module-diff script (Docker vs LMN linbofs64) | New shell script; needs access to both linbofs64 files |
| UPD-06 | Boot-test-runbook in docs/linbo-upgrade-flow.md | Existing file at `docs/linbo-upgrade-flow.md` needs a runbook section appended |
| UPD-07 | `make doctor` APT repo connectivity check | Add a new category to `scripts/doctor.sh` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Jest | 29.7.0 | Test framework | Already configured in `containers/api/jest.config.js` |
| Bash/BusyBox | N/A | Shell scripting | update-linbofs.sh runs in Alpine-based container |
| xz-utils | N/A | XZ compression/decompression | Already used in update-linbofs.sh |
| cpio | N/A | CPIO archive handling | Already used in update-linbofs.sh |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| curl | N/A | HTTP connectivity check | doctor.sh APT repo check |
| diff | N/A | Module list comparison | module-diff script |

### Alternatives Considered
None -- all requirements use existing tools already present in the codebase.

**Installation:**
No new packages required.

## Architecture Patterns

### Existing File Map (what gets modified)

```
scripts/server/
  update-linbofs.sh          # UPD-02, UPD-03, UPD-04 (shell guards)
scripts/
  doctor.sh                  # UPD-07 (APT repo check)
scripts/server/
  linbofs-module-diff.sh     # UPD-05 (NEW file)
containers/api/tests/services/
  linbo-update.service.test.js  # UPD-01 (test expansion)
docs/
  linbo-upgrade-flow.md      # UPD-06 (runbook appendix)
Makefile                     # UPD-05 (new target: module-diff)
```

### Pattern 1: update-linbofs.sh Guard Placement

**What:** Each injection step in update-linbofs.sh uses `mkdir -p` which silently creates directories even when the linbofs64 template structure has changed upstream. Pre-injection path checks verify the expected base directories already exist in the extracted template before any injection occurs.

**When to use:** Before Steps 7 (kernel modules), 8 (password hash), 9 (SSH keys), 10.5 (firmware), 10.6 (wpa_supplicant), 10.7 (GUI themes/binary).

**Example:**
```bash
# Pre-injection path validation (after Step 6 extraction, before Step 7)
# These directories MUST exist in the extracted template; their absence
# indicates the linbo7 package changed the internal linbofs64 structure.
REQUIRED_DIRS="bin etc"
for dir in $REQUIRED_DIRS; do
    if [ ! -d "$WORKDIR/$dir" ]; then
        echo "ERROR: Required directory '$dir' not found in extracted linbofs64."
        echo "The linbo7 package may have changed its internal directory structure."
        echo "Expected: $WORKDIR/$dir"
        exit 1
    fi
done
```

**Key insight:** The current script already checks for `bin/` and `etc/` after extraction (line 274). The improvement is to validate ALL target directories that the subsequent steps write into, not just the top-level sanity check.

### Pattern 2: Size and Module Guards

**What:** After repacking, verify the output file size is within expected bounds and that kernel modules were actually included.

**Current state:** Step 12 only checks minimum size (10MB). The enhancement adds:
- Warning threshold: >80MB (linbofs64 is typically ~55MB)
- Hard reject: >200MB
- Module count check: `.ko` count must be > 0 when `HAS_KERNEL_VARIANT=true`

**Example:**
```bash
# Size range check (Step 12 extension)
NEW_SIZE=$(stat -c%s "$LINBOFS.new")

# Hard upper bound
MAX_SIZE=209715200   # 200MB
if [ "$NEW_SIZE" -gt "$MAX_SIZE" ]; then
    echo "ERROR: linbofs64 exceeds maximum size: $(($NEW_SIZE / 1048576))MB > 200MB"
    echo "This indicates a build problem. Aborting!"
    rm -f "$LINBOFS.new"
    exit 1
fi

# Warning threshold
WARN_SIZE=83886080   # 80MB
if [ "$NEW_SIZE" -gt "$WARN_SIZE" ]; then
    echo "WARNING: linbofs64 is unusually large: $(($NEW_SIZE / 1048576))MB (threshold: 80MB)"
fi
```

### Pattern 3: Post-Rebuild CPIO Verification

**What:** After building the concatenated linbofs64, verify BOTH XZ segments decompress correctly and that `dev/console` is present in the combined output.

**Current state:** No post-build integrity verification exists. The `set -e` in the script catches XZ compression errors but NOT silent data corruption.

**Approach:** Use `xz -dc` to decompress and pipe through `cpio -t` to list all files. Check for `dev/console` in the listing. Also verify the file contains exactly 2 XZ streams.

**Example:**
```bash
# Post-rebuild CPIO verification (after Step 11, before Step 13)
echo "Verifying CPIO archive integrity..."

# Test 1: Both XZ segments must decompress
if ! xz -t "$LINBOFS.new" 2>/dev/null; then
    echo "ERROR: linbofs64 XZ verification failed — archive is corrupt"
    rm -f "$LINBOFS.new"
    exit 1
fi

# Test 2: CPIO listing must work and contain dev/console
CPIO_LIST=$(xz -dc "$LINBOFS.new" | cpio -t 2>/dev/null) || true
if ! echo "$CPIO_LIST" | grep -q '^dev/console$'; then
    echo "ERROR: dev/console not found in linbofs64 CPIO archive"
    echo "The device nodes segment may be missing or corrupt."
    rm -f "$LINBOFS.new"
    exit 1
fi
echo "  - CPIO verification: OK (dev/console present)"

# Test 3: Module count check (when kernel variant was injected)
if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    KO_COUNT=$({ echo "$CPIO_LIST" | grep '\.ko$' || true; } | wc -l)
    if [ "$KO_COUNT" -eq 0 ]; then
        echo "ERROR: No kernel modules (.ko files) found in linbofs64"
        echo "Kernel variant '$KTYPE' was injected but no modules survived repack."
        rm -f "$LINBOFS.new"
        exit 1
    fi
    echo "  - Module count: $KO_COUNT .ko files"
fi
```

### Pattern 4: Test Expansion (Jest)

**What:** The existing `linbo-update.service.test.js` has comprehensive mocks for Redis, WebSocket, linbofs.service, and grub.service. Three new test groups are needed.

**Existing mock infrastructure already supports all three scenarios:**

1. **Partial failure (provision OK, rebuild fails):**
   - Set up fetch mocks for a successful version check + download
   - Mock `linbofsService.updateLinbofs` to return `{ success: false, errors: 'rebuild failed' }`
   - Assert: error status set, lock released, cleanup called

2. **Concurrent update (409):**
   - Pre-set the Redis lock key to simulate an ongoing update
   - Call `startUpdate()` and assert 409 error with `UPDATE_IN_PROGRESS`

3. **Version comparison edge cases:**
   - Test `isNewer()` with Debian epoch versions: `1:2.0` vs `3.0`
   - Test `parseInstalledVersion()` with unusual formats
   - Test `findBestCandidate()` with multiple candidates including epoch versions

### Pattern 5: Doctor.sh Category Addition

**What:** Add a new diagnostic category to `scripts/doctor.sh` for APT repository connectivity.

**Existing pattern:** Each category in doctor.sh follows this structure:
```bash
echo -e "\n${BLUE}Category Name${NC}"
# ... checks using the check() helper
check "description" $result "fix suggestion"
```

**New APT check:**
```bash
# Category 7: APT Repository Connectivity
echo -e "\n${BLUE}APT Repository${NC}"

if curl -sf --connect-timeout 5 -o /dev/null "https://deb.linuxmuster.net/dists/lmn73/Release"; then
    check "deb.linuxmuster.net reachable" 0 ""
else
    check "deb.linuxmuster.net reachable" 1 "Check DNS and internet connectivity. URL: https://deb.linuxmuster.net"
fi
```

### Anti-Patterns to Avoid
- **Using `grep -P` in update-linbofs.sh:** BusyBox grep does not support Perl regex. Use `grep -E` or `sed`.
- **Using `numfmt` without fallback:** BusyBox lacks numfmt. Use `awk` math as established in Phase 13.
- **Using pipefail in update-linbofs.sh:** `set -o pipefail` is NOT set in the script; pipeline exit codes need explicit handling with `|| true` patterns.
- **Modifying update-linbofs.sh for content injection:** Per CLAUDE.md rules, content changes go through hooks. But UPD-02/03/04 are build-process guards (not content), so direct modification is correct.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XZ stream validation | Custom byte-level parser | `xz -t` (test mode) | Handles concatenated streams natively |
| CPIO content listing | Custom archive reader | `cpio -t` piped from `xz -dc` | Standard tool, handles both segments |
| Version comparison | Custom semver parser | `dpkg --compare-versions` | Already used in service; handles Debian epochs, tilde versions |
| APT repo check | Custom HTTP client | `curl -sf --connect-timeout` | Reliable, handles redirects, available in Docker |

**Key insight:** All verification can be done with standard Linux tools already present in the container. No custom parsing needed.

## Common Pitfalls

### Pitfall 1: BusyBox vs GNU Tool Differences
**What goes wrong:** Shell commands that work on the dev machine (GNU) fail in the Docker container (BusyBox/Alpine).
**Why it happens:** update-linbofs.sh runs inside the API container which uses Alpine Linux.
**How to avoid:** Test all shell changes with `docker exec linbo-api bash script.sh`. Use patterns from Phase 13: `{ grep || true; } | wc -l`, `awk` instead of `numfmt`.
**Warning signs:** `grep: invalid option`, `numfmt: not found`.

### Pitfall 2: xz -t on Concatenated Streams
**What goes wrong:** `xz -t` validates ALL concatenated XZ streams in a file, not just the first one. This is actually the desired behavior for our use case.
**Why it matters:** Our linbofs64 has two XZ segments. `xz -t` will fail if EITHER is corrupt, which is exactly what we want.
**How to verify:** Test with a known-good linbofs64: `xz -t /srv/linbo/linbofs64` should return 0.

### Pitfall 3: cpio -t Exit Code with Concatenated Archives
**What goes wrong:** `cpio -t` may print warnings to stderr when processing concatenated cpio archives, but still succeeds and lists all files.
**Why it happens:** Each cpio segment has its own TRAILER!!! marker.
**How to avoid:** Redirect stderr: `xz -dc file | cpio -t 2>/dev/null`. Check for `dev/console` in stdout, not exit code.

### Pitfall 4: Module Count When No Kernel Variant
**What goes wrong:** Rejecting a build because it has zero `.ko` files when no kernel variant was provisioned.
**Why it happens:** If `HAS_KERNEL_VARIANT=false`, the script intentionally skips module injection.
**How to avoid:** Only check module count when `HAS_KERNEL_VARIANT=true`. The script already has this flag.

### Pitfall 5: Test State Leaking Between Jest Tests
**What goes wrong:** Redis mock state from one test leaks into another, causing false positives/negatives.
**Why it happens:** Module-level state (lockRunId, heartbeatTimer, cancelRequested) persists across tests.
**How to avoid:** The existing `beforeEach` calls `resetRedis()` and `releaseLock()`. New tests must follow this pattern and also clear any mocked fetch state.

### Pitfall 6: Partial Failure Leaves Lock Behind
**What goes wrong:** If `startUpdate()` throws after acquiring the lock but before the `finally` block runs in tests, the mock Redis retains the lock.
**Why it happens:** Jest mock timers or async issues.
**How to avoid:** Always call `releaseLock()` in `afterEach` and verify lock state as part of assertions.

## Code Examples

### Test: Partial Failure (provision OK, rebuild fails)
```javascript
// Source: Existing test patterns in linbo-update.service.test.js
test('handles partial failure: provision OK but rebuild fails', async () => {
  // Setup: version file shows old version
  await fs.writeFile(path.join(tmpDir, 'linbo-version.txt'), 'LINBO 1.0.0-0: Old\n');

  // Mock fetch: version check succeeds, download succeeds
  const packagesBody = [
    'Package: linuxmuster-linbo7',
    'Version: 99.0.0-0',
    'Architecture: amd64',
    'Filename: pool/main/l/test.deb',
    'Size: 100',
    'SHA256: abc',
  ].join('\n');

  // ... setup fetch mocks for version check + download ...

  // Mock linbofs rebuild to fail
  linbofsService.updateLinbofs.mockResolvedValueOnce({
    success: false,
    output: 'error output',
    errors: 'rebuild failed: missing modules',
  });

  await expect(svc.startUpdate()).rejects.toThrow('linbofs rebuild failed');

  // Lock must be released
  expect(redisStore.has('linbo:update:lock')).toBe(false);
});
```

### Test: Concurrent Update Returns 409
```javascript
// Source: Existing lock test pattern
test('concurrent update attempt returns 409', async () => {
  // Pre-set lock to simulate running update
  redisStore.set('linbo:update:lock', 'other-run-id');

  // Setup version check to show update available
  await fs.writeFile(path.join(tmpDir, 'linbo-version.txt'), 'LINBO 1.0.0-0: Old\n');
  // ... mock fetch ...

  try {
    await svc.startUpdate();
    fail('Should have thrown');
  } catch (err) {
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('already in progress');
  }
});
```

### Shell: Pre-Injection Path Validation
```bash
# After Step 6 extraction, before Step 7 module injection
# Validate critical paths exist in extracted linbofs template
echo "Validating linbofs64 internal structure..."
VALIDATION_FAIL=0
for required_dir in bin etc; do
    if [ ! -d "$required_dir" ]; then
        echo "ERROR: Required directory '$required_dir' missing from extracted linbofs64"
        echo "  Expected at: $WORKDIR/$required_dir"
        echo "  The linbo7 package may have changed the internal linbofs64 structure."
        VALIDATION_FAIL=1
    fi
done
if [ "$VALIDATION_FAIL" -ne 0 ]; then
    exit 1
fi
echo "  - Structure validation: OK"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Size check >10MB only | Size check >10MB + warn >80MB + fail >200MB | Phase 15 | Catches bloated builds early |
| No CPIO verification | Verify both XZ segments + dev/console | Phase 15 | Catches corrupt concatenation |
| mkdir -p hides missing dirs | Pre-injection path validation | Phase 15 | Detects upstream linbofs64 structure changes |
| No module count check | Reject zero .ko when variant injected | Phase 15 | Catches empty module extraction |

**Deprecated/outdated:**
- None. All Phase 15 changes extend existing code, nothing is being replaced.

## Open Questions

1. **Module diff comparison source (UPD-05)**
   - What we know: LMN-generated linbofs64 is available on 10.0.0.11 at `/srv/linbo/linbofs64`
   - What's unclear: Should the module-diff script be run inside the Docker container (comparing against a copied LMN linbofs64) or on the host (with access to both)?
   - Recommendation: Run inside Docker container. Accept a path argument for the LMN linbofs64 (default: `/srv/linbo/linbofs64.lmn-reference`). The admin copies the LMN file manually or via `make` target. This keeps the script self-contained.

2. **Size thresholds calibration (UPD-03)**
   - What we know: Current production linbofs64 is ~55MB (per Session 33 memory). The 80MB warn / 200MB fail thresholds come from REQUIREMENTS.md.
   - What's unclear: Whether 80MB is tight enough for all firmware configurations.
   - Recommendation: Use the specified thresholds (80MB warn, 200MB fail) from requirements. These are configurable via the warning output -- admin sees the warning and can investigate.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `docker exec linbo-api npx jest tests/services/linbo-update.service.test.js --runInBand` |
| Full suite command | `docker exec linbo-api npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UPD-01 | Partial failure, concurrent 409, version edge cases | unit | `docker exec linbo-api npx jest tests/services/linbo-update.service.test.js --runInBand -x` | Exists (extending) |
| UPD-02 | Pre-injection path check | manual | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh` (with tampered template) | N/A (shell script) |
| UPD-03 | Size range + module count | manual | Build linbofs64 and verify output messages | N/A (shell script) |
| UPD-04 | Post-rebuild CPIO verification | manual | Build linbofs64 and verify verification step output | N/A (shell script) |
| UPD-05 | Module-diff script | manual | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-module-diff.sh` | Wave 0 (NEW) |
| UPD-06 | Boot-test runbook | manual-only | Read `docs/linbo-upgrade-flow.md` for completeness | N/A (documentation) |
| UPD-07 | APT repo connectivity check | manual | `make doctor` and check for APT category | N/A (shell script) |

### Sampling Rate
- **Per task commit:** `docker exec linbo-api npx jest tests/services/linbo-update.service.test.js --runInBand`
- **Per wave merge:** `docker exec linbo-api npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/server/linbofs-module-diff.sh` -- new script for UPD-05
- No other gaps -- existing test infrastructure covers UPD-01; shell scripts are verified manually

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection:
  - `containers/api/src/services/linbo-update.service.js` -- full update flow, lock management, version parsing
  - `containers/api/tests/services/linbo-update.service.test.js` -- existing test suite, mock patterns
  - `scripts/server/update-linbofs.sh` -- build pipeline, current guards, hook system
  - `scripts/doctor.sh` -- diagnostic categories, check() helper pattern
  - `containers/api/src/services/linbofs.service.js` -- updateLinbofs wrapper, build log rotation
  - `scripts/server/linbofs-audit.sh` -- CPIO listing patterns, BusyBox-compatible commands
  - `docs/linbo-upgrade-flow.md` -- existing upgrade documentation

### Secondary (MEDIUM confidence)
- `scripts/server/update-linbofs-lmn-original.sh` -- upstream LMN patterns for comparison
- Project memory (MEMORY.md) -- historical build sizes, module count, known issues

### Tertiary (LOW confidence)
- None. All findings derive from direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already in use, no new dependencies
- Architecture: HIGH -- extending existing files with established patterns
- Pitfalls: HIGH -- based on documented Phase 13 lessons and direct code analysis

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, no fast-moving dependencies)
