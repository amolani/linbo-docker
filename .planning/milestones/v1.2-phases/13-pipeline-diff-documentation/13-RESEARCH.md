# Phase 13: Pipeline Diff Documentation - Research

**Researched:** 2026-03-10
**Domain:** Shell scripting (bash), CPIO/XZ archive inspection, Makefile tooling, documentation
**Confidence:** HIGH

## Summary

Phase 13 delivers documentation and inspection tooling for the Docker update-linbofs.sh build pipeline. The core challenge is straightforward: create two shell scripts (`linbofs-audit.sh`, `linbofs-diff.sh`), two Makefile targets, a three-column divergence table in `docs/UNTERSCHIEDE-ZU-LINBO.md`, pin the LMN original script, and document the CPIO+XZ concatenation format.

All required tools (`xz`, `cpio`, `bash`, `ssh-keygen`, `kmod`) are already present in the API container (Alpine-based, Node 20). The LMN original script (412 lines, linuxmuster-cachingserver-linbo7 v4.3.31) is available in `docs/linuxmuster-cachingserver-linbo7-main.zip` and can be extracted and pinned. The Docker script (591 lines) has 16 structural differences from the LMN original, all documented in this research.

**Primary recommendation:** Implement as pure shell scripts delegated from Makefile targets via `docker exec linbo-api`, following the existing `make doctor` / `make test` pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None explicitly locked -- all decisions delegated to Claude's discretion.

### Claude's Discretion
User explicitly delegated all format and presentation decisions to Claude. The following areas are open:

- **Audit output format** -- How `make linbofs-audit` presents linbofs64 contents (sections, verbosity, formatting)
- **Diff presentation** -- How `make linbofs-diff` shows before/after comparison (plain diff, categorized, summary)
- **Divergence doc structure** -- Whether to restructure the existing `UNTERSCHIEDE-ZU-LINBO.md` narrative or add the 3-column table alongside it
- **LMN original selection** -- Which version of the LMN update-linbofs script to pin, how to source it
- **CPIO format documentation** -- How to document the concatenated CPIO+XZ format in update-linbofs.sh header comments

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIFF-01 | LMN-Original `update-linbofs` als Referenzdatei im Repo gepinnt (`scripts/server/update-linbofs-lmn-original.sh`) | LMN original available in `docs/linuxmuster-cachingserver-linbo7-main.zip` at path `serverfs/usr/sbin/update-linbofs`, version 4.3.31-0, dated 2026-02-10. 412 lines. Extract and pin with version header. |
| DIFF-02 | `make linbofs-audit` zeigt linbofs64-Inhalt (Kernel-Version, Modul-Anzahl, SSH-Key-Fingerprints, Firmware, Hook-modifizierte Dateien) | All inspection commands verified: `xzcat` + `cpio -t` for file listing, `grep \.ko$` for modules, `ssh-keygen -lf` for fingerprints, `grep lib/firmware/` for firmware. `xzcat` correctly handles concatenated XZ segments. |
| DIFF-03 | `make linbofs-diff` vergleicht Template-linbofs64.xz mit gebautem linbofs64 (was hat Docker geaendert?) | Template at `/var/lib/linuxmuster/linbo/current/linbofs64.xz`, built at `/srv/linbo/linbofs64`. Both can be extracted to temp dirs and compared with `diff` on file lists, then categorized (added/removed/modified). |
| DIFF-04 | Divergenz-Katalog in `docs/UNTERSCHIEDE-ZU-LINBO.md` (3-Spalten: LMN / Docker / Begruendung) | 16 structural differences identified (see Architecture Patterns). Existing 597-line narrative doc should be preserved, 3-column table added as new section. |
| DIFF-05 | CPIO-Concat-Format dokumentiert in update-linbofs.sh Header-Kommentaren | Linux initramfs buffer format documented at kernel.org. Docker uses two XZ segments: main content + device nodes. Format, rationale, and extraction commands documented below. |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| bash | 5.x (Alpine) | Script runtime for audit/diff tools | Already in API container, all existing scripts use bash |
| xz-utils | 5.x (Alpine `xz` package) | CPIO archive decompression | Already installed, handles concatenated XZ segments natively |
| cpio | Alpine package | Archive listing and extraction | Already installed, `cpio -t` for listing, `cpio -i` for extraction |
| ssh-keygen | OpenSSH (Alpine) | SSH key fingerprint extraction | Already installed via `openssh-client` |
| diff | BusyBox (Alpine) | File list comparison for linbofs-diff | Built into Alpine base |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| kmod/depmod | Alpine package | Module information | Already installed, for module count verification |
| file | BusyBox | File type detection | For kernel version extraction from linbo64 binary |
| stat | BusyBox | File size reporting | For audit output |
| md5sum | BusyBox | Hash verification | For audit output |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell scripts | Node.js scripts | Shell is natural for archive inspection; Node would add unnecessary complexity |
| `docker exec` from Makefile | Host-side scripts | Audit/diff need tools inside the container; host may not have `xz`/`cpio` |
| `unmkinitramfs` | Manual `xzcat`+`cpio` | `unmkinitramfs` not available in Alpine; manual approach is portable |

**Installation:** No new packages needed. All tools already present in the API container.

## Architecture Patterns

### Recommended Project Structure
```
scripts/server/
  update-linbofs.sh              # Docker's build script (existing, 591 lines)
  update-linbofs-lmn-original.sh # LMN original pinned reference (DIFF-01, new)
  linbofs-audit.sh               # Audit script (DIFF-02, new)
  linbofs-diff.sh                # Diff script (DIFF-03, new)
docs/
  UNTERSCHIEDE-ZU-LINBO.md       # Divergence documentation (DIFF-04, update)
```

### Pattern 1: Makefile Delegation to Docker Exec
**What:** Makefile targets delegate to shell scripts running inside the API container via `docker exec`.
**When to use:** For all `make linbofs-*` targets.
**Example:**
```makefile
# Source: existing pattern from Makefile (make test)
linbofs-audit:
	docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-audit.sh

linbofs-diff:
	docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-diff.sh
```

### Pattern 2: Section-Based Shell Script Output
**What:** Use section headers with `===` dividers matching existing `update-linbofs.sh` and `doctor.sh` style.
**When to use:** For `linbofs-audit.sh` output formatting.
**Example:**
```bash
# Source: doctor.sh pattern
echo "=== Kernel ==="
echo "  Version: $KVER"
echo "  Module count: $MOD_COUNT"
echo ""
echo "=== SSH Keys ==="
echo "  Dropbear: $DB_FP"
```

### Pattern 3: Temp Directory Extraction for Comparison
**What:** Extract both template and built linbofs64 to temporary directories, compare file lists.
**When to use:** For `linbofs-diff.sh`.
**Example:**
```bash
TMPDIR_TEMPLATE=$(mktemp -d)
TMPDIR_BUILT=$(mktemp -d)
trap "rm -rf $TMPDIR_TEMPLATE $TMPDIR_BUILT" EXIT

# Template
xzcat "$TEMPLATE" | (cd "$TMPDIR_TEMPLATE" && cpio -i -d -H newc --no-absolute-filenames 2>/dev/null)
# Built (handles concatenated XZ)
xzcat "$BUILT" | (cd "$TMPDIR_BUILT" && cpio -i -d -H newc --no-absolute-filenames 2>/dev/null)

# Compare file lists
diff <(cd "$TMPDIR_TEMPLATE" && find . -type f | sort) \
     <(cd "$TMPDIR_BUILT" && find . -type f | sort)
```

### Pattern 4: CPIO+XZ Concatenation Format Documentation
**What:** Inline documentation in update-linbofs.sh header explaining the two-segment format.
**When to use:** For DIFF-05 (header comments).
**Format:**
```bash
# LINBOFS64 ARCHIVE FORMAT
# ========================
# The output linbofs64 file consists of TWO concatenated XZ-compressed CPIO
# segments. This is a standard Linux initramfs technique -- the kernel's
# initramfs loader (init/initramfs.c) processes concatenated compressed
# cpio archives sequentially.
#
# Segment 1: Main filesystem (all files from WORKDIR)
#   Created by: find . | cpio -H newc --owner 0:0 | xz
#   Contains: SSH keys, password hash, kernel modules, firmware, themes, hooks
#
# Segment 2: Device nodes (dev/console c5,1 + dev/null c1,3)
#   Created by: xz < DEVNODES_CPIO (pre-built binary cpio fragment)
#   Reason: The build runs as non-root (uid 1001). cpio(1) cannot create
#   character device nodes without CAP_MKNOD. A pre-built cpio fragment
#   containing these nodes is appended as a separate compressed segment.
#
# To inspect the full archive:
#   xzcat linbofs64 | cpio -t          # lists ALL files (both segments)
#   xzcat linbofs64 | cpio -i -d       # extracts ALL files (both segments)
#
# Note: xzcat/xz -dc decompresses ALL concatenated XZ streams, not just the
# first. The cpio TRAILER!!! marker separates the two archives, and cpio
# processes them sequentially, merging the results.
```

### 16 Structural Differences (Docker vs LMN)

These are the divergences that must appear in the 3-column table:

| # | Area | LMN Original | Docker | Justification |
|---|------|-------------|--------|---------------|
| 1 | Dependency management | `source helperfunctions.sh` (requires full LMN stack) | Self-contained config block | Docker has no linuxmuster-base7 package |
| 2 | Lock mechanism | File-based (`/tmp/.update-linbofs.lock`, touch+rm) | flock-based (fd 8, `CONFIG_DIR/.rebuild.lock`) | Race-condition safe for shared Docker volumes |
| 3 | Firmware provisioning | Downloads from kernel.org + parses LINBO client logs | Config-file-based with path traversal protection, zst decompression, symlink checks | No client log access in Docker; security hardened |
| 4 | Locale injection | `copy_locale()` -- full locale support with chroot locale-gen | Not injected | Docker clients don't need locale in linbofs |
| 5 | CPIO format | Single XZ segment: `find . \| cpio \| xz` | Two XZ segments: main content + device nodes | Non-root build (uid 1001) cannot mknod |
| 6 | cpio ownership | Runs as root, no --owner flag needed | `--owner 0:0` flag | Ensures root ownership despite non-root build |
| 7 | GUI themes | Package themes, no injection mechanism | Theme injection from `$LINBO_DIR/gui-themes/` | Docker supports custom branding |
| 8 | Custom linbo_gui | No custom binary support | Optional binary override from `$CONFIG_DIR/linbo_gui` | Docker supports custom GUI builds |
| 9 | Build status marker | No marker | `.linbofs-patch-status` written after successful build | TFTP container waits for this marker |
| 10 | Docker volume sync | Not applicable | Copies to Docker volume mountpoint if different from LINBO_DIR | Ensures TFTP serves updated files |
| 11 | efipxe devicenames | Copies `efipxe` to `usr/share/linbo` | Not copied | Docker uses GRUB HTTP boot, efipxe not needed |
| 12 | Custom inittab | Supports `$LINBOSYSDIR/inittab` appending | Not supported | Docker linbofs uses standard inittab |
| 13 | ISO creation | Calls `make-linbo-iso.sh` after build | No ISO creation | Docker serves via TFTP/HTTP, no ISO needed |
| 14 | Backup before rebuild | No backup | Creates `linbofs64.bak` before rebuild | Rollback capability for Docker deployments |
| 15 | Size verification | No size check | Minimum 10MB check on new file | Prevents deploying corrupt/empty linbofs64 |
| 16 | Hook execution | Unsorted find, no exported vars, errors may halt build | Sorted execution, exported vars, errors warn but don't halt | Improved reliability and hook developer experience |

### Anti-Patterns to Avoid
- **Extracting linbofs64 to host filesystem:** Always use `docker exec` -- the host may not have `xz`/`cpio`, and Alpine BusyBox tools behave differently from GNU tools.
- **Using `xz --single-stream`:** Not needed. `xzcat` and `xz -dc` decompress ALL concatenated XZ streams by default. The `--single-stream` flag would only decompress the first segment, missing device nodes.
- **Running audit/diff as separate containers:** Overkill. The API container already has all needed tools. Use `docker exec` like `make test` does.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Archive inspection | Custom Node.js CPIO parser | `xzcat` + `cpio -t` pipe | cpio/xz are reliable, well-tested C tools |
| File comparison | Custom diff algorithm | `diff` on sorted file lists | Standard Unix `diff` handles this perfectly |
| SSH fingerprints | Custom key parsing | `ssh-keygen -lf` | Handles all key formats correctly |
| Kernel version extraction | Binary parsing | `cpio -t \| grep lib/modules/[0-9]` path extraction | Kernel version is embedded in module path |

**Key insight:** This phase is pure tooling and documentation -- no new libraries, no complex logic. Shell utilities + clear documentation.

## Common Pitfalls

### Pitfall 1: xzcat Might Not Handle Concatenated Streams on Some Systems
**What goes wrong:** On some minimal systems, `xz` might only decompress the first XZ stream.
**Why it happens:** Older xz-utils versions or non-standard builds.
**How to avoid:** The API container uses Alpine's xz package (5.x), which correctly handles concatenated streams. Verified empirically: `xzcat` on this system decompresses all segments.
**Warning signs:** Module count or file count is lower than expected; `dev/console` missing from listing.

### Pitfall 2: cpio -t vs cpio -i for Device Nodes
**What goes wrong:** `cpio -t` (list mode) shows device nodes, but `cpio -i` (extract mode) as non-root silently skips them.
**Why it happens:** Creating character device nodes requires CAP_MKNOD.
**How to avoid:** For `linbofs-audit`, use `cpio -t` to LIST contents (works for all entries). For `linbofs-diff`, accept that dev nodes won't appear in extracted directory comparison -- list them separately from `cpio -t` output.
**Warning signs:** `dev/console` appears in `cpio -t` but not in extracted directory.

### Pitfall 3: Template linbofs64.xz May Not Exist
**What goes wrong:** `make linbofs-diff` fails because the template file doesn't exist.
**Why it happens:** Template is provisioned by the init container during first boot. If init hasn't run or kernel provisioning is disabled, the template is missing.
**How to avoid:** Check for template existence before attempting diff. Print clear error message with instructions.
**Warning signs:** `/var/lib/linuxmuster/linbo/current/linbofs64.xz` not found.

### Pitfall 4: Built linbofs64 Not Yet Available
**What goes wrong:** `make linbofs-audit` runs before the first `update-linbofs.sh` build.
**Why it happens:** Fresh deployment, containers just started.
**How to avoid:** Check for `/srv/linbo/linbofs64` existence. Check `.linbofs-patch-status` marker.
**Warning signs:** File not found or patch status marker missing.

### Pitfall 5: LMN Original Script Uses LMN-Specific Variables
**What goes wrong:** The pinned LMN original script references variables from `helperfunctions.sh` (e.g., `$LINBODIR`, `$LINBOSYSDIR`, `$LINBOCACHEDIR`) that are undefined in Docker.
**Why it happens:** LMN scripts depend on the linuxmuster-base7 package environment.
**How to avoid:** The pinned script is for REFERENCE ONLY, not execution. Add a clear header comment stating this. The variable definitions from `constants.py` are: `LINBODIR=/srv/linbo`, `LINBOSYSDIR=/etc/linuxmuster/linbo`, `LINBOVARDIR=/var/lib/linuxmuster/linbo`, `LINBOCACHEDIR=/var/cache/linuxmuster/linbo`, `HOOKSDIR=/var/lib/linuxmuster/hooks`.

## Code Examples

### Linbofs Audit: Kernel Version Extraction
```bash
# Source: verified on Alpine xz + cpio
KVER=$(xzcat "$LINBOFS" | cpio -t 2>/dev/null \
    | grep -oP '^lib/modules/\K[0-9][^/]+' | head -1)
echo "Kernel version: ${KVER:-not found (no modules injected)}"
```

### Linbofs Audit: Module Count
```bash
# Source: verified against update-linbofs.sh module injection
MOD_COUNT=$(xzcat "$LINBOFS" | cpio -t 2>/dev/null | grep -c '\.ko$' || echo 0)
# Also count compressed modules
MOD_COUNT_XZ=$(xzcat "$LINBOFS" | cpio -t 2>/dev/null | grep -c '\.ko\.xz$' || echo 0)
echo "Modules: $MOD_COUNT .ko + $MOD_COUNT_XZ .ko.xz = $((MOD_COUNT + MOD_COUNT_XZ)) total"
```

### Linbofs Audit: SSH Key Fingerprints
```bash
# Source: verified with ssh-keygen
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
xzcat "$LINBOFS" | (cd "$TMPDIR" && cpio -i -d -H newc --no-absolute-filenames 2>/dev/null)
echo "=== SSH Key Fingerprints ==="
for key in "$TMPDIR"/etc/ssh/ssh_host_*_key; do
    [ -f "$key" ] || continue
    echo "  $(ssh-keygen -lf "$key" 2>/dev/null || echo "  (unreadable: $(basename "$key"))")"
done
for key in "$TMPDIR"/etc/dropbear/dropbear_*_host_key; do
    [ -f "$key" ] || continue
    echo "  Dropbear: $(basename "$key")"
done
```

### Linbofs Audit: Firmware Files
```bash
# Source: verified against update-linbofs.sh firmware injection
FW_FILES=$(xzcat "$LINBOFS" | cpio -t 2>/dev/null | grep '^lib/firmware/' | grep -v '/$')
FW_COUNT=$(echo "$FW_FILES" | grep -c . || echo 0)
echo "Firmware files: $FW_COUNT"
if [ "$FW_COUNT" -gt 0 ]; then
    echo "$FW_FILES" | sed 's/^/  /'
fi
```

### Linbofs Diff: Before/After Comparison
```bash
# Source: standard Unix diff approach
# Generate sorted file lists from both archives
xzcat "$TEMPLATE" | cpio -t 2>/dev/null | sort > "$TMPDIR/template.list"
xzcat "$BUILT"    | cpio -t 2>/dev/null | sort > "$TMPDIR/built.list"

# Files only in built (ADDED by Docker)
comm -13 "$TMPDIR/template.list" "$TMPDIR/built.list" > "$TMPDIR/added.list"
# Files only in template (REMOVED by Docker)
comm -23 "$TMPDIR/template.list" "$TMPDIR/built.list" > "$TMPDIR/removed.list"
# Files in both (potentially MODIFIED)
comm -12 "$TMPDIR/template.list" "$TMPDIR/built.list" > "$TMPDIR/common.list"
```

### LMN Original Script Header Comment
```bash
#!/bin/bash
#
# LMN ORIGINAL - DO NOT EXECUTE IN DOCKER
# ========================================
# This is the original update-linbofs script from linuxmuster-cachingserver-linbo7
# package version 4.3.31-0 (2026-02-10), pinned as reference for diff comparison.
#
# Source: https://github.com/linuxmuster/linuxmuster-cachingserver-linbo7
# Path:   serverfs/usr/sbin/update-linbofs
#
# This script requires the full linuxmuster.net stack (helperfunctions.sh,
# constants.py, setup.ini) and WILL NOT RUN in a Docker environment.
#
# Purpose: Compare with scripts/server/update-linbofs.sh to understand what
# Docker's build pipeline does differently.
#
# LMN variable mappings (from constants.py):
#   LINBODIR      = /srv/linbo
#   LINBOSYSDIR   = /etc/linuxmuster/linbo
#   LINBOVARDIR   = /var/lib/linuxmuster/linbo
#   LINBOCACHEDIR = /var/cache/linuxmuster/linbo
#   LINBOSHAREDIR = /usr/share/linuxmuster/linbo
#   HOOKSDIR      = /var/lib/linuxmuster/hooks
#   LINBOLOGDIR   = /var/log/linuxmuster/linbo
#
# === ORIGINAL SCRIPT FOLLOWS ===
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual diff of scripts | Pinned reference + `make linbofs-diff` | Phase 13 (new) | Automated comparison |
| Unknown linbofs64 contents | `make linbofs-audit` inspection | Phase 13 (new) | Transparency for admins |
| Narrative-only divergence doc | 3-column table + narrative | Phase 13 (update) | Easier reference for maintainers |
| Undocumented CPIO format | Header comments in update-linbofs.sh | Phase 13 (new) | No one accidentally breaks two-segment structure |

## Open Questions

1. **Hook-modified files detection**
   - What we know: Pre-hooks run in the extracted linbofs root and can modify any file. The audit should show which files were modified by hooks.
   - What's unclear: Without re-running the build, we can only compare template vs built file lists. We cannot distinguish "changed by update-linbofs.sh" from "changed by hook".
   - Recommendation: Show ALL differences between template and built linbofs. The diff output naturally shows hook modifications alongside script modifications. Document that the diff includes both standard injections and hook modifications.

2. **Dropbear key fingerprint extraction**
   - What we know: `ssh-keygen -lf` works on OpenSSH keys. Dropbear keys use a different format.
   - What's unclear: Whether Alpine's `dropbearkey` can output fingerprints for existing keys.
   - Recommendation: Use `dropbearkey -y -f <key>` to extract the public key, then `ssh-keygen -lf -` on the public key portion. If that fails, just show the file exists with its size.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `docker exec linbo-api npm test -- --testPathPattern=linbofs` |
| Full suite command | `docker exec linbo-api npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIFF-01 | LMN original script exists at pinned path | smoke | `test -f scripts/server/update-linbofs-lmn-original.sh` | No -- Wave 0 (file creation) |
| DIFF-02 | `make linbofs-audit` runs and produces expected output sections | smoke | `make linbofs-audit 2>&1 \| grep -q "Kernel"` | No -- Wave 0 (script creation) |
| DIFF-03 | `make linbofs-diff` shows added/removed/modified files | smoke | `make linbofs-diff 2>&1 \| grep -q "ADDED\|REMOVED\|files"` | No -- Wave 0 (script creation) |
| DIFF-04 | Divergence table has 3 columns (LMN/Docker/Justification) | manual-only | Visual inspection of `docs/UNTERSCHIEDE-ZU-LINBO.md` | N/A |
| DIFF-05 | CPIO format documented in update-linbofs.sh header | manual-only | `grep -q "LINBOFS64 ARCHIVE FORMAT" scripts/server/update-linbofs.sh` | N/A (header comment) |

### Sampling Rate
- **Per task commit:** `test -f` checks on created files + `grep` for expected content
- **Per wave merge:** `make linbofs-audit` and `make linbofs-diff` on a running Docker environment (if containers are up)
- **Phase gate:** All 5 DIFF requirements verifiable

### Wave 0 Gaps
- [ ] `scripts/server/linbofs-audit.sh` -- new audit script (DIFF-02)
- [ ] `scripts/server/linbofs-diff.sh` -- new diff script (DIFF-03)
- [ ] `scripts/server/update-linbofs-lmn-original.sh` -- extracted from zip (DIFF-01)
- [ ] Makefile targets `linbofs-audit` and `linbofs-diff` -- Makefile update

*(No test framework gaps -- DIFF requirements are verified via smoke tests and manual inspection, not Jest unit tests. The existing Jest infrastructure is not relevant for this documentation/tooling phase.)*

## Sources

### Primary (HIGH confidence)
- `/root/linbo-docker/scripts/server/update-linbofs.sh` -- Docker build script, 591 lines, fully analyzed
- `/root/linbo-docker/docs/linuxmuster-cachingserver-linbo7-main.zip` -- LMN original source, version 4.3.31-0, `serverfs/usr/sbin/update-linbofs` (412 lines), fully analyzed
- `/root/linbo-docker/docs/UNTERSCHIEDE-ZU-LINBO.md` -- existing 597-line divergence doc
- `/root/linbo-docker/Makefile` -- existing Makefile patterns (111 lines)
- `/root/linbo-docker/scripts/doctor.sh` -- reference for diagnostic script patterns (216 lines)
- `/root/linbo-docker/containers/api/Dockerfile` -- confirms tools available: xz, cpio, bash, openssh-client, kmod
- [Linux initramfs buffer format](https://docs.kernel.org/driver-api/early-userspace/buffer-format.html) -- official kernel documentation on concatenated CPIO+compression support

### Secondary (MEDIUM confidence)
- `xzcat` concatenated stream test -- verified empirically on this system (both segments decompressed)
- LMN `constants.py` from zip -- path variable mappings for documentation header

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already installed, verified in Dockerfile and empirically
- Architecture: HIGH -- patterns follow existing project conventions (doctor.sh, Makefile delegation)
- Pitfalls: HIGH -- all pitfalls derived from direct code analysis of both scripts
- Divergence catalog: HIGH -- based on line-by-line comparison of both scripts

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable -- shell tools and CPIO format don't change)
