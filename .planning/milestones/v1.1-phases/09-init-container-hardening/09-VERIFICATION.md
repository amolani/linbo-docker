---
phase: 09-init-container-hardening
verified: 2026-03-08T17:15:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 9: Init Container Hardening Verification Report

**Phase Goal:** The init container reports exactly what failed, why, and what to do about it -- and can recover from partial failures without manual cleanup
**Verified:** 2026-03-08T17:15:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (Plan 01 + Plan 02 combined)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | error_block() prints structured error to stderr with title, details, cause, optional diagnostics, fix, and retry/reset commands | VERIFIED | Lines 29-52: function takes 5 args, outputs to stderr (>&2), conditionally includes Diagnostics section, includes retry/reset commands |
| 2  | classify_curl_error() maps curl exit codes to human-readable strings | VERIFIED | Lines 56-70: case statement maps codes 5,6,7,22,28,35,47,52,56 plus wildcard fallback |
| 3  | check_disk_space() fails with structured error when <500MB free | VERIFIED | Lines 95-112: uses df -P, compares _avail_mb < 500, calls error_block on failure |
| 4  | check_dns() fails with structured error when deb.linuxmuster.net cannot resolve, includes proxy detection | VERIFIED | Lines 115-128: nslookup test, calls run_network_diagnostics (which detects HTTP_PROXY/HTTPS_PROXY at lines 83-87) |
| 5  | check_write_permission() fails with structured error showing current vs expected ownership and chown command | VERIFIED | Lines 132-147: touch test, stat -c '%u:%g' for current owner, error_block with "Expected: 1001:1001" and chown fix command |
| 6  | checkpoint_set/checkpoint_exists/checkpoint_clear_all manage marker files in /srv/linbo/.checkpoints/ | VERIFIED | Lines 155-177: checkpoint_exists checks file existence, checkpoint_set does atomic temp+mv write with version/timestamp, checkpoint_clear_all removes CHECKPOINT_DIR and CACHE_DIR |
| 7  | verify_sha256_structured() shows expected vs actual hash in structured error block on mismatch | VERIFIED | Lines 206-230: compares sha256sum output, calls error_block with "Expected: / Actual:" on mismatch |
| 8  | download_with_retry() retries 3 times, then prints structured error with network diagnostics | VERIFIED | Lines 234-268: while loop with _max_retries=3, 5s sleep, calls classify_curl_error + run_network_diagnostics + error_block on exhaustion |
| 9  | print_success_summary() prints version, kernels, GUI, themes, duration in summary block | VERIFIED | Lines 313-363: collects kernel versions from kernels/{stable,longterm,legacy}/version, GUI from linbo_gui64_7.tar.lz, themes from gui-themes/*/, prints "=== LINBO Init Complete ===" block |
| 10 | After partial failure, re-running init skips completed checkpoints and shows skip messages | VERIFIED | Main flow lines 903-1161: 6 checkpoint guards (apt-index, linbo-deb, gui-deb, boot-files, kernels, themes) each print "Skipping: ..." when checkpoint exists with matching version |

**Score:** 10/10 truths verified

### ROADMAP Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | APT fetch failure shows structured error with package, error type, and fix | VERIFIED | fetch_packages_index() (lines 379-388) calls classify_curl_error, run_network_diagnostics, error_block with URL, cause, diagnostics, and fix suggestion |
| 2 | SHA256 verification failure shows expected vs actual hash | VERIFIED | verify_sha256_structured() (lines 217-226) outputs "Expected: / Actual:" in error_block; called from download_and_cache_deb (line 301) |
| 3 | Permission error (EACCES) shows path, ownership, and chown command | VERIFIED | check_write_permission() (lines 135-143) shows "Owner: / Expected: 1001:1001" and "Run: docker run --rm ... chown" in error_block |
| 4 | Re-running after partial failure resumes from last checkpoint | VERIFIED | 6 checkpoint guard blocks in main flow (lines 903-1161), resume banner at line 1004 "=== Resuming from partial install ===", FORCE_UPDATE clears all at line 896 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `containers/init/entrypoint.sh` | Error reporting, pre-flight, checkpoint, and download helper functions; checkpoint-aware main flow | VERIFIED | 1169 lines, 15 helper functions (sections 1-5) plus 11-step checkpoint-guarded main flow. Contains `error_block` (13 call sites), `checkpoint_exists` (6 guard points), `checkpoint_set` (7 set points) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Main flow (lines 867-1169) | Helper functions (lines 22-363) | Function calls in checkpoint-guarded blocks | WIRED | 7 checkpoint guard blocks found (awk scan). Pre-flight calls at lines 878/882/886. error_block called from 13 locations across helpers and main flow. download_with_retry -> classify_curl_error -> run_network_diagnostics chain verified at lines 256-258. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ERR-01 | 09-01, 09-02 | Init Container zeigt actionable Fehlermeldungen bei APT-Fehlern, SHA256-Mismatches und Permission-Problemen | SATISFIED | APT errors: fetch_packages_index lines 379-388 + download_with_retry lines 256-267. SHA256: verify_sha256_structured lines 217-226. Permissions: check_write_permission lines 135-143. All produce structured error blocks with title, cause, diagnostics, and fix. |

No orphaned requirements -- REQUIREMENTS.md maps only ERR-01 to Phase 9, which is covered by both plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No TODO/FIXME/PLACEHOLDER/empty implementations found |

### Commit Verification

| Commit | Message | Status |
|--------|---------|--------|
| `97d0710` | feat(09-01): add error reporting, pre-flight, checkpoint, and download helper functions | VERIFIED -- exists in git log |
| `f3474e1` | feat(09-02): rewire init main flow with checkpoint guards and structured errors | VERIFIED -- exists in git log |

No uncommitted changes to `containers/init/entrypoint.sh`.

### Human Verification Required

#### 1. APT Fetch Structured Error

**Test:** `docker compose run --rm -e DEB_BASE_URL=https://nonexistent.example.com init`
**Expected:** Structured error block on stderr with "=== ERROR: APT index fetch failed ===", cause from classify_curl_error, DNS diagnostics, and fix suggestion
**Why human:** Requires DNS failure simulation in a running container with network access

#### 2. SHA256 Mismatch Error

**Test:** Run init successfully, corrupt a cached .deb file in /srv/linbo/.cache/debs/, remove the boot-files checkpoint, re-run init
**Expected:** "=== ERROR: SHA256 verification failed ===" with expected vs actual hash display
**Why human:** Requires manual file corruption of cached .deb on the persistent volume

#### 3. Permission Error (EACCES)

**Test:** Change volume ownership to root:root, run init
**Expected:** "=== ERROR: Permission denied (EACCES) ===" with current ownership, expected 1001:1001, and chown fix command
**Why human:** Requires volume permission manipulation on the host

#### 4. Checkpoint Resume Flow

**Test:** Run init to completion, then run init again without FORCE_UPDATE
**Expected:** All 6 checkpoints print "Skipping: ..." messages, completion in <5 seconds
**Why human:** Requires two sequential container runs and timing observation

#### 5. FORCE_UPDATE Full Reset

**Test:** `docker compose run --rm -e FORCE_UPDATE=true init`
**Expected:** "Forcing full update -- all checkpoints cleared", no skip messages, success summary at end
**Why human:** Requires container run and output observation

### Gaps Summary

No gaps found. All 10 observable truths from Plan 01 and Plan 02 are verified in the codebase. The entrypoint.sh contains all 15 helper functions with substantive implementations (no stubs), and the main flow is fully rewired with 6 checkpoint guard blocks, 3 pre-flight checks, structured error reporting on all failure paths, FORCE_UPDATE support, version change detection, resume banner, and success summary.

The single requirement (ERR-01) is fully satisfied with evidence across APT errors, SHA256 mismatches, and permission problems.

---

_Verified: 2026-03-08T17:15:00Z_
_Verifier: Claude (gsd-verifier)_
