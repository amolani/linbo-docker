# Architecture Patterns

**Domain:** linbofs64 build pipeline — end-to-end from init container to boot artifact
**Researched:** 2026-03-10

---

## Scope

This document covers the **v1.2 milestone**: full transparency and hardening of the linbofs64 build pipeline. It supersedes the v1.1 ARCHITECTURE.md for this topic but does not replace anything already shipped.

The pipeline has three distinct phases:

1. **Bootstrap** — Init container provisions raw boot files from the APT repo into shared volumes
2. **Build** — `update-linbofs.sh` constructs the final `linbofs64` initramfs artifact (keys + modules + firmware + hooks)
3. **Update** — `linbo-update.service.js` orchestrates a live package upgrade that traverses both phases in sequence

---

## Recommended Architecture

The pipeline is already architecturally sound. No new containers or paradigm shifts are needed for v1.2. The work is: documentation, diff analysis, test coverage, and targeted hardening at the integration seams.

### High-Level Pipeline

```
APT REPO (deb.linuxmuster.net)
       |
       | HTTPS: linuxmuster-linbo7.deb + linuxmuster-linbo-gui7.deb
       v
+------------------+
|   init container |  (one-shot at startup)
|  entrypoint.sh   |
+------------------+
       |
       | Provisions to /srv/linbo/ (linbo_srv_data volume):
       |   /srv/linbo/kernels/{stable,longterm,legacy}/
       |     - linbo64          (kernel binary)
       |     - modules.tar.xz  (720 selected kernel modules)
       |     - version          (kernel version string)
       |   /srv/linbo/kernels/linbofs64.xz  (vanilla template)
       |   /srv/linbo/kernels/manifest.json (SHA256 + sizes)
       |   /srv/linbo/boot/grub/            (GRUB files)
       |   /srv/linbo/linbo_gui64_7.tar.lz  (GUI archive)
       |   /srv/linbo/.needs-rebuild        (signal to API)
       |
       | Provisions to /var/lib/linuxmuster/linbo/ (linbo_kernel_data volume):
       |   sets/{hash}/{stable,longterm,legacy}/
       |   sets/{hash}/linbofs64.xz
       |   current -> sets/{hash}  (atomic symlink)
       v
+------------------+        +-------------------+
|   API container  |  <-->  |  ssh/rsync/tftp   |
|  index.js        |        |  containers       |
|  (startup hook)  |        +-------------------+
+------------------+
       |
       | Detects .needs-rebuild, calls linbofsService.updateLinbofs()
       |   OR: POST /system/update-linbofs  (manual trigger)
       |   OR: POST /system/linbo-update   (full package update flow)
       |   OR: POST /system/kernel-switch  (variant change trigger)
       v
+------------------+
|  update-linbofs  |  scripts/server/update-linbofs.sh
|  .sh             |  (runs inside API container as uid 1001)
+------------------+
       |
       | Reads:
       |   $KERNEL_VAR_DIR/current/linbofs64.xz  (template)
       |   $KERNEL_VAR_DIR/current/{variant}/modules.tar.xz
       |   /etc/linuxmuster/linbo/rsyncd.secrets (rsync password)
       |   /etc/linuxmuster/linbo/dropbear_*_host_key
       |   /etc/linuxmuster/linbo/ssh_host_*_key*
       |   /etc/linuxmuster/linbo/*.pub
       |   /etc/linuxmuster/linbo/firmware  (optional)
       |   /etc/linuxmuster/linbo/wpa_supplicant.conf  (optional)
       |   /srv/linbo/gui-themes/           (optional)
       |
       | Steps:
       |   1. Read kernel variant from custom_kernel file
       |   2. Validate kernel variant directory
       |   3. Hash rsync password (argon2)
       |   4. Create WORKDIR = mktemp /var/cache/linbo/linbofs-build.XXXXXX
       |   5. Backup linbofs64 -> linbofs64.bak
       |   6. Extract template (xzcat | cpio -i) into WORKDIR
       |   7. Inject kernel modules (tar xf modules.tar.xz + depmod)
       |   8. Inject password hash (etc/linbo_pwhash + etc/linbo_salt)
       |   9. Inject SSH keys (etc/dropbear/, etc/ssh/, .ssh/authorized_keys)
       |   10. Copy start.conf
       |   10.5. Inject firmware (from /etc/linuxmuster/linbo/firmware list)
       |   10.6. Inject wpa_supplicant.conf
       |   10.7. Inject GUI themes + custom linbo_gui binary
       |   10.9. Execute pre-hooks (HOOKSDIR/update-linbofs.pre.d/)
       |   11. Repack: find . | cpio | xz -> linbofs64.new
       |         + append device nodes cpio segment (dev/console, dev/null)
       |   12. Verify size (>= 10MB)
       |   13. mv linbofs64.new -> linbofs64 (atomic)
       |   14. Generate linbofs64.md5
       |   14.5. Write .linbofs-patch-status marker
       |   14.6. Sync to Docker volume if LINBO_DIR != Docker volume path
       |   15. Copy kernel binary from variant: linbo64 -> /srv/linbo/linbo64
       |   15.5. Execute post-hooks (HOOKSDIR/update-linbofs.post.d/)
       v
+------------------+
|  TFTP container  |
|  (reads volume)  |
+------------------+
       |
       | Serves to PXE clients:
       |   /srv/linbo/linbo64       (kernel)
       |   /srv/linbo/linbofs64     (initramfs -- built artifact)
       |   /srv/linbo/boot/grub/    (GRUB configs + modules)
```

---

### Component Boundaries

| Component | Responsibility | Reads From | Writes To |
|-----------|---------------|-----------|----------|
| `containers/init/entrypoint.sh` | One-shot APT provisioning, kernel set management | APT repo (HTTPS), `.deb` files | `linbo_srv_data` vol, `linbo_kernel_data` vol |
| `scripts/server/update-linbofs.sh` | linbofs64 initramfs construction | `linbo_kernel_data` vol (template+modules), `linbo_config_data` vol (keys, secrets), `linbo_srv_data` vol (firmware list, themes) | `linbo_srv_data/linbofs64`, `.linbofs-patch-status`, `linbo64` |
| `containers/api/src/services/linbofs.service.js` | Shell out to update-linbofs.sh; key management | Filesystem (CONFIG_DIR, LINBO_DIR) | CONFIG_DIR (keys), triggers update-linbofs.sh |
| `containers/api/src/services/linbo-update.service.js` | Full package update orchestration (APT download + extract + provision + rebuild) | APT Packages index, `linbo_srv_data`, `linbo_kernel_data` | `linbo_srv_data`, `linbo_kernel_data`, Redis status key |
| `containers/api/src/services/kernel.service.js` | Kernel variant switch (writes custom_kernel, triggers rebuild) | `linbo_kernel_data/current/`, `custom_kernel` file | `custom_kernel` file, triggers update-linbofs.sh |
| `containers/api/src/index.js` | API startup: auto-rebuild detection | `.needs-rebuild` marker | `.needs-rebuild.running` (rename), triggers linbofs.service |
| `containers/api/src/routes/system/linbo-update.js` | HTTP API for version check + update | linbo-update.service | HTTP responses, WebSocket broadcasts |
| `containers/api/src/routes/system/linbofs.js` | HTTP API for linbofs status + manual rebuild | linbofs.service | HTTP responses, WebSocket broadcasts |
| `containers/api/src/routes/system/kernel.js` | HTTP API for kernel variant management | kernel.service | HTTP responses, WebSocket broadcasts |
| Hook scripts (pre.d/) | Custom linbofs content modifications | WORKDIR (extracted linbofs root) | WORKDIR files (in-place modifications) |
| Hook scripts (post.d/) | Post-build notifications, extra checksums | Final `linbofs64` | External systems, notification endpoints |

---

### Volume Map

| Docker Volume | Mount Path | Used By | Contains |
|--------------|------------|---------|---------|
| `linbo_srv_data` | `/srv/linbo` | init, api, tftp, rsync | Boot files, linbofs64, kernels staging, GUI |
| `linbo_kernel_data` | `/var/lib/linuxmuster/linbo` | init, api | Kernel sets (atomic symlink), current symlink |
| `linbo_config_data` | `/etc/linuxmuster/linbo` | init (writes keys), api, update-linbofs.sh | SSH/Dropbear keys, rsyncd.secrets, hooks dir, firmware list |

---

## Data Flow — Detailed

### Phase 1: Init Container Bootstrap

```
entrypoint.sh main flow:
  Pre-flight: check_write_permission, check_disk_space, check_dns
  Step 3: fetch_packages_index() → PACKAGES_CACHE (APT stanza)
  Step 4: parse_package_info(linuxmuster-linbo7) → LINBO_VERSION, LINBO_FILENAME, LINBO_SHA256
  Step 6: download_and_cache_deb() → CACHE_DIR/debs/linuxmuster-linbo7_X.X.XX.deb
           checkpoint_set("linbo-deb", version) [idempotent skip on rerun]
  Step 7: download_and_cache_deb() → CACHE_DIR/debs/linuxmuster-linbo-gui7_X.X.XX.deb
  Step 8: provision_boot_files():
            dpkg-deb -x linbo7.deb → TEMP_DIR/linbo7/
              → merge_grub_files(src/boot/grub, /srv/linbo/boot/grub)
              → cp icons/, start.conf (if not exist)
              → cp kernels/{stable,longterm,legacy}/ → /srv/linbo/kernels/
              → cp linbofs64.xz → /srv/linbo/kernels/linbofs64.xz
              → build_manifest_json() → /srv/linbo/kernels/manifest.json
            dpkg-deb -x gui7.deb → TEMP_DIR/gui7/
              → cp linbo_gui64_7.tar.lz → /srv/linbo/
              → create /srv/linbo/gui/ symlinks
          Sets .needs-rebuild marker → /srv/linbo/.needs-rebuild
  Step 9: provision_kernels():
            reads /srv/linbo/kernels/manifest.json
            MANIFEST_HASH = sha256(manifest)[0:8]
            cp kernels/{stable,longterm,legacy}/ → SETS_DIR/.tmp-{hash}/
            cp linbofs64.xz → SETS_DIR/.tmp-{hash}/linbofs64.xz
            verify against manifest SHA256
            atomic rename: .tmp-{hash} → sets/{hash}
            atomic symlink swap: current.new → current
  Step 10: provision_themes():
             cp /opt/linbo-themes/*/ → /srv/linbo/gui-themes/
```

**Key invariant:** Init uses checkpoint files (`/srv/linbo/.checkpoints/`) to make all steps idempotent. A partial run can be resumed. `FORCE_UPDATE=true` clears all checkpoints.

**Key invariant:** Boot files provisioning ends by writing `.needs-rebuild`. This is the handoff signal to the API.

### Phase 2: update-linbofs.sh Build

```
Triggered by:
  a) API startup detecting .needs-rebuild → linbofsService.updateLinbofs()
  b) POST /system/update-linbofs → linbofsService.updateLinbofs()
  c) POST /system/linbo-update (package update) → linbo-update.service → linbofsService.updateLinbofs()
  d) POST /system/kernel-switch → kernelService.switchKernel() → linbofsService.updateLinbofs()

KERNEL_VAR_DIR default: /var/lib/linuxmuster/linbo/current
  (symlink → sets/{hash}, populated by init container)

Template source: $KERNEL_VAR_DIR/linbofs64.xz
  (vanilla linbofs from package, no Docker modifications)

Modules source: $KERNEL_VAR_DIR/{ktype}/modules.tar.xz
  (720 kernel modules selected by linuxmuster for LINBO)

Build output:
  /srv/linbo/linbofs64        → final initramfs (served by TFTP)
  /srv/linbo/linbofs64.md5    → MD5 checksum (verified by linbo client)
  /srv/linbo/linbofs64.bak    → backup of previous build
  /srv/linbo/linbo64          → kernel binary (copied from variant)
  /srv/linbo/.linbofs-patch-status → build marker (API reads for health)
```

**Key invariant:** Template is always read from `linbofs64.xz` (vanilla). Docker NEVER modifies vanilla files in-place — all modifications are injections into the extracted WORKDIR before repack. This ensures upstream `update-linbofs.sh` compatibility.

**Key invariant:** The flock at `$CONFIG_DIR/.rebuild.lock` prevents concurrent builds. Only one update-linbofs.sh process runs at a time.

### Phase 3: LINBO Package Update Flow

```
POST /system/linbo-update
  → linbo-update.service.startUpdate()

  Redis lock: linbo:update:lock (TTL 120s + heartbeat)
  Redis status: linbo:update:status (hash, expires 1h)
  WebSocket: linbo.update.status events (throttled 2s)

  Flow:
    checkVersion() → APT Packages index → compare with linbo-version.txt
    preflightCheck(packageSize) → df check (3x package size)
    workDir = mktemp /tmp/linbo-update-{timestamp}/
    downloadAndVerify(debUrl, sha256, size)
      → streaming download → hash transform → verify SHA256+size
    extractDeb(debPath)
      → dpkg-deb -x → workDir/extracted/
    provisionBootFiles(extractDir, version)
      → GUI files to .update-staging/ (atomic rename to /srv/linbo/)
      → mergeGrubFiles() (protect x86_64-efi/, i386-pc/)
      → GUI symlinks (gui/linbo_gui64_7.tar.lz)
      → provisionKernels(extractDir, version)
          → copy variants to /srv/linbo/kernels/{stable,longterm,legacy}/
          → copy linbofs64.xz template
          → buildManifest() → /srv/linbo/kernels/manifest.json
          → provisionKernelSets() → atomic symlink swap on /var/lib/linuxmuster/linbo/current
    rebuildLinbofs(version)
      → linbofsService.updateLinbofs()  ← Phase 2 runs here
    regenerateGrubConfigs(version)
      → grubService.regenerateAllGrubConfigs()  (non-fatal)
    finalize(extractDir, version)
      → cp linbo-version.txt (LAST — UI shows old version until done)
      → .boot-files-installed marker
      → cleanup workDir
      → ws.broadcast('linbo.update.status', {status:'done'})
      → ws.broadcast('system.kernel_variants_changed', {})
```

**Key invariant:** Version file is written LAST in finalize(). The UI always shows the current running version until the entire update (including linbofs rebuild) is complete.

**Key invariant:** provisionKernelSets() uses the same atomic rename + symlink-swap pattern as init container, so both code paths result in an identical kernel set structure.

---

## Docker vs LMN Divergences

This table documents every intentional divergence between Docker's update-linbofs.sh and the vanilla LMN version, with rationale:

| Aspect | LMN Original | Docker | Rationale |
|--------|-------------|--------|-----------|
| **Script source** | `/usr/share/linuxmuster/linbo/update-linbofs.sh` (from linbo7 package) | `scripts/server/update-linbofs.sh` (repo) | Docker needs customization; LMN can overwrite its own file on package update |
| **Kernel source** | `dpkg -l linuxmuster-linbo7` installed kernel in `/var/lib/linuxmuster/linbo/` | `KERNEL_VAR_DIR/current/` (atomic symlink, managed by init container) | Decoupled: kernel variants managed independently, not by dpkg |
| **Template source** | `linbofs64.xz` from package installation in `/var/lib/linuxmuster/linbo/` | `$KERNEL_VAR_DIR/linbofs64.xz` (staged by init container) | Same file, different path — init container stages it to the set directory |
| **Password hashing** | argon2 (same) | argon2 (same) | No divergence |
| **SSH key injection** | Reads from `/etc/linuxmuster/linbo/` | Reads from `$CONFIG_DIR` (same default path) | No divergence |
| **init.sh** | Unmodified | Unmodified | CRITICAL: never patch init.sh directly |
| **linbo.sh** | Unmodified | Unmodified | No divergence |
| **Device nodes** | mknod (requires root) | pre-built cpio fragment (base64-encoded, concatenated) | API runs as uid 1001; cpio -i silently skips device nodes without root |
| **Hook directory** | `/var/lib/linuxmuster/hooks/` | `/etc/linuxmuster/linbo/hooks/` | Docker puts hooks with other LINBO config; more portable |
| **Hook variable export** | None (hooks must source helperfunctions.sh) | LINBO_DIR, CONFIG_DIR, CACHE_DIR, KTYPE, KVERS, WORKDIR exported | Better DX: hooks can use vars without sourcing anything |
| **Hook sort order** | find without sort (non-deterministic) | sort (alphabetic, numeric prefix effective) | Deterministic execution order |
| **Hook error handling** | Hook exit may stop build | WARNING + continue | Build resilience; hook failure is non-fatal |
| **Flock mechanism** | Uses package-provided locking | `$CONFIG_DIR/.rebuild.lock` (flock fd 8) | Same mechanism, different path (config vol always writable) |
| **Post-sync to Docker volume** | N/A | Step 14.6: cp to `/var/lib/docker/volumes/linbo_srv_data/_data/` if LINBO_DIR differs | Multi-path support: script can run from both inside and outside the container |
| **DEVNODES_CPIO** | Created inline with mknod | Pre-built base64 blob, decoded to temp file, concatenated as separate XZ segment | Non-root build safety; initramfs supports concatenated cpio archives |

---

## Hook System Architecture

```
/etc/linuxmuster/linbo/hooks/
├── update-linbofs.pre.d/
│   └── 01_edulution-plymouth   (active: replaces Plymouth theme)
└── update-linbofs.post.d/
    (empty by default)

Execution sequence for update-linbofs.sh:
  1. Extract template → WORKDIR
  2. Inject keys, modules, firmware, themes (Steps 7-10.7)
  3. exec_hooks pre  ← hooks run here, CWD = WORKDIR
  4. cpio | xz → linbofs64.new
  5. Verify + replace linbofs64
  6. Copy linbo64 kernel
  7. exec_hooks post ← hooks run here, CWD = WORKDIR (still accessible)

Exported variables available to all hooks:
  $LINBO_DIR    = /srv/linbo
  $CONFIG_DIR   = /etc/linuxmuster/linbo
  $CACHE_DIR    = /var/cache/linbo
  $KTYPE        = stable | longterm | legacy
  $KVERS        = e.g. 6.12.57 (empty if no kernel variant available)
  $WORKDIR      = /var/cache/linbo/linbofs-build.XXXXXX
```

**Design constraint:** Hooks MUST NOT call `update-linbofs.sh` recursively. The flock prevents this from causing double-build but the error is confusing. Hooks should only modify files within WORKDIR (pre) or trigger external notifications (post).

**Design constraint:** Pre-hooks run AFTER standard injections (SSH keys, modules, firmware). A hook that injects an SSH key the standard injector already handles will silently overwrite. Hooks are for content not covered by standard steps.

---

## Patterns to Follow

### Pattern 1: Atomic Template Extraction — Never Modify Vanilla Files

**What:** Always use `linbofs64.xz` as the base template for each build. Never repack from the previous `linbofs64`.
**Why:** The vanilla template is clean (no prior injections). Repacking from the current `linbofs64` would accumulate injections across builds, double-injecting keys/modules on every rebuild.
**Implemented:** Step 6 of update-linbofs.sh: `if [ -f "$LINBOFS_TEMPLATE" ]; then xzcat "$LINBOFS_TEMPLATE" | cpio -i ... else WARNING + use current linbofs64`.

```bash
# Correct pattern (Step 6):
if [ -f "$LINBOFS_TEMPLATE" ]; then
    xzcat "$LINBOFS_TEMPLATE" | cpio -i -d -H newc --no-absolute-filenames
else
    echo "WARNING: template not found, using current linbofs64"
    xzcat "$LINBOFS" | cpio -i -d -H newc --no-absolute-filenames
fi
```

### Pattern 2: Atomic Kernel Set Provisioning (Symlink Swap)

**What:** Kernel sets are written to a temp directory, then atomically renamed to the final set directory. The `current` symlink is swapped atomically.
**Why:** Prevents a reader (API, update-linbofs.sh) from seeing a partially-written kernel set during provisioning.
**Implemented:** Both `provision_kernels()` in entrypoint.sh and `provisionKernelSets()` in linbo-update.service.js use the same pattern.

```
sets/.tmp-{hash}/          ← write here first
  → sets/{hash}/           ← atomic rename
     current.new -> sets/{hash}  ← atomic symlink
     current.new mv→ current     ← atomic swap
```

### Pattern 3: Build Marker State Machine

**What:** The build lifecycle uses a chain of marker files to communicate state between the init container, the API startup hook, and the TFTP container.
**Why:** File-based IPC is robust across container restarts and requires no shared message queue.

```
State machine:
  .needs-rebuild        (init container writes after provisioning)
        |
        | API startup detects, renames atomically
        v
  .needs-rebuild.running (API wrote this; if present on restart = interrupted)
        |
        | update-linbofs.sh completes successfully
        v
  .linbofs-patch-status  (update-linbofs.sh writes on success)
  .needs-rebuild.running is deleted

Recovery: API startup detects .needs-rebuild.running → renames back to .needs-rebuild
          (will be picked up on next restart — requires one deliberate restart)
```

**Note:** TFTP container busy-waits for `.linbofs-patch-status` before serving `linbofs64`. This is the synchronization point between the build pipeline and PXE clients.

### Pattern 4: Non-Root Build Safety (uid 1001)

**What:** update-linbofs.sh runs as uid 1001 (linbo user) inside the API container. It cannot use `mknod` or `chown` on arbitrary files.
**Why:** Docker best practice — API container does not run as root.
**Implemented:**
- Device nodes: pre-built base64 CPIO blob; appended as separate XZ segment (Linux initramfs supports concatenated archives)
- File ownership: `cpio --owner 0:0` ensures initramfs files are owned by root at boot time despite build uid
- Volume permissions: `chown -R 1001:1001` set on volumes by init container

### Pattern 5: Idempotent Update Orchestration (Redis Lock + Heartbeat)

**What:** The linbo-update.service uses a Redis lock with TTL + heartbeat to prevent concurrent updates. Lock is released on completion or error.
**Why:** `update-linbofs.sh` itself uses flock, but the download/provision steps before it are also non-reentrant (shared workDir, staging directory).

```javascript
// Lock: NX SET with 120s TTL + 30s heartbeat renewal
// On completion: DEL if runId matches (prevents stale lock cleanup race)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Patching init.sh Directly

**What:** Modifying `init.sh` (the LINBO client init script) in `update-linbofs.sh` or via a patch embedded in the script.
**Why bad:** init.sh changes are invisible to upstream (no diff audit trail), break on package updates, and violate the "Vanilla LINBO Works" principle proven in Session 30.
**Instead:** Use a pre-hook if init.sh modification is truly necessary (e.g., the DHCP serverid bug). Document the patch in the hook file. The hook is visible, versioned, and opt-in.

```bash
# Anti-pattern (was removed in Session 30):
# sed -i 's/LINBOSERVER=.*/LINBOSERVER=$server/' etc/init.sh

# Correct pattern if modification becomes necessary:
# /etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/02_init-serverid-fix
```

### Anti-Pattern 2: Repack from Current linbofs64 as Baseline

**What:** Using the existing `linbofs64` (already injected) as the template for the next build instead of the vanilla `linbofs64.xz`.
**Why bad:** Each rebuild accumulates injections. SSH keys get doubled. Module directories contain stale modules from previous kernel versions. The artifact diverges from vanilla over time, making diffs against upstream impossible.
**Prevents:** The fallback in Step 6 (use current linbofs64 if template missing) is a last-resort emergency, not the intended flow. The template should always be present in `$KERNEL_VAR_DIR`.

### Anti-Pattern 3: Skipping SHA256 Verification on Package Download

**What:** Downloading `.deb` without verifying SHA256 against the APT Packages index.
**Why bad:** A corrupted or MITM-modified package silently produces a broken or backdoored `linbofs64`. The artifact is served to all PXE clients.
**Implemented correctly:** Both `entrypoint.sh` (via `verify_sha256_structured`) and `linbo-update.service.js` (via streaming SHA256 transform) verify before use.

### Anti-Pattern 4: Blocking API Startup on linbofs Rebuild

**What:** Synchronously awaiting the linbofs rebuild during API startup before accepting HTTP traffic.
**Why bad:** The rebuild takes 30-120s. A blocked startup means health checks fail, Docker Compose considers the container unhealthy, and dependent containers time out.
**Implemented correctly:** API startup fires the rebuild asynchronously (`.then()` handler in index.js). HTTP server starts listening immediately after marker rename.

### Anti-Pattern 5: Storing linbofs Build State in Redis

**What:** Using Redis keys to track whether the linbofs build is "in progress" (analogous to the linbo-update.service Redis lock).
**Why bad:** The linbofs build is coordinated via file markers (`.needs-rebuild`, `.needs-rebuild.running`, `.linbofs-patch-status`). Adding Redis state creates two sources of truth. The flock in `update-linbofs.sh` is the actual mutex; Redis would only be advisory and could get out of sync on crash.
**Instead:** Keep build state in file markers. Redis tracks high-level update orchestration (linbo-update.service) because that operation spans multiple phases and needs WebSocket progress reporting.

---

## Integration Points (Explicit)

### 1. Init Container → API (via `.needs-rebuild` on shared volume)

- **Trigger:** Init successfully provisions boot files (Step 8 of entrypoint.sh)
- **Signal:** `touch /srv/linbo/.needs-rebuild`
- **Consumer:** API startup in `containers/api/src/index.js` (lines 671-695)
- **Action:** Renames to `.needs-rebuild.running`, fires `linbofsService.updateLinbofs()` asynchronously
- **Success:** Deletes `.needs-rebuild.running`, writes `.linbofs-patch-status`
- **Failure:** Restores `.needs-rebuild.running` → `.needs-rebuild` for retry on next restart
- **Risk:** If API restarts mid-build (e.g., OOM), the running marker is left. Recovery requires one deliberate restart.

### 2. Init Container → update-linbofs.sh (via kernel set symlink)

- **Trigger:** Init provisions kernels (Step 9 of entrypoint.sh via `provision_kernels()`)
- **Signal:** `/var/lib/linuxmuster/linbo/current` symlink points to `sets/{hash}/`
- **Consumer:** `update-linbofs.sh` reads `$KERNEL_VAR_DIR/current/` for template and modules
- **Default KERNEL_VAR_DIR:** `/var/lib/linuxmuster/linbo/current`
- **Risk:** If `current` symlink is missing (init failed at Step 9), update-linbofs.sh logs "Kernel variant directory not found" and skips module injection. linbofs64 builds without new kernel modules — it uses whatever modules were in the vanilla template. This is a degraded but bootable state.

### 3. linbo-update.service.js → update-linbofs.sh (via linbofsService)

- **Trigger:** `rebuildLinbofs()` called at progress ~85% after package provisioning
- **Signal:** Direct call — `linbofsService.updateLinbofs()` execs `update-linbofs.sh`
- **Contract:** linbofsService returns `{success, output, errors, duration}`
- **Error behavior:** If rebuild fails, `startUpdate()` throws, Redis status set to `error`, lock released. The new package files ARE provisioned (step 3 completed) but linbofs64 is NOT rebuilt. The old linbofs64 remains active from `.bak`. The version file is NOT updated (finalize() was not reached).
- **Risk (partial state):** After a failed update, boot files are from the new package version but linbofs64 is from the old. A subsequent `POST /system/update-linbofs` (manual trigger) can repair this.

### 4. linbo-update.service.js → grubService (via regenerateAllGrubConfigs)

- **Trigger:** After successful linbofs rebuild, at progress ~90%
- **Contract:** `grubService.regenerateAllGrubConfigs()` returns `{configs, hosts}`
- **Error behavior:** Non-fatal. Errors are logged but do not fail the update. Existing GRUB configs remain in place.
- **Risk:** If a new LINBO package changes GRUB template syntax, regeneration produces incorrect configs. This would only be visible at next PXE boot attempt. The update appears successful.

### 5. update-linbofs.sh → TFTP container (via `.linbofs-patch-status` marker)

- **Trigger:** update-linbofs.sh writes `.linbofs-patch-status` at Step 14.5
- **Consumer:** TFTP container entrypoint busy-waits on this file before serving `linbofs64`
- **Contract:** File contains: `# Build Status — {ISO date}\nbuild|OK`
- **Risk (blocker):** If update-linbofs.sh fails after writing `linbofs64` but before writing `.linbofs-patch-status`, TFTP never unblocks. Manual recovery: `echo "build|OK" >> /srv/linbo/.linbofs-patch-status` or `make deploy-full`.

### 6. linbo-update.service.js → Kernel Set System (dual write)

- **Issue:** Both `provision_boot_files()` in entrypoint.sh and `provisionBootFiles()` in linbo-update.service.js implement the same kernel set provisioning logic independently.
- **Current state:** Both implementations use the same manifest hash + atomic symlink pattern. They produce structurally identical output.
- **Risk (divergence):** If the manifest schema changes, both implementations must be updated in sync. There is no shared library — this is duplicated business logic in shell + JS.

---

## Scalability Considerations

| Concern | Current (1 school, ~100 clients) | 10 schools | Notes |
|---------|----------------------------------|------------|-------|
| linbofs build time | 30-120s (CPU-bound XZ compression) | Same per instance | Each school has its own Docker instance |
| Concurrent PXE boots | TFTP serves linbofs64 to all clients simultaneously | Same | TFTP is stateless read-only |
| Package update frequency | Rare (LMN releases ~quarterly) | Same | Update is manual/admin-triggered |
| Hook execution overhead | Negligible (<1s for Plymouth theme hook) | Same | Hooks are isolated per build |
| linbofs64 size | ~55MB (after double-XZ bug fix in Session 33) | Same | XZ compression level: `-e` (extreme) |

---

## Build Order for v1.2 Phases

Based on integration point analysis, recommended phase order:

```
Phase 1: Pipeline Diff Documentation
  - Systematic diff of Docker update-linbofs.sh vs LMN original
  - Document every divergence with rationale (feeds this file)
  - No code changes — pure documentation
  - Dependencies: none (can start immediately)

Phase 2: Build Pipeline Tests
  - Unit tests for update-linbofs.sh (bats or shellspec)
  - Integration test: full build cycle with mock template
  - Verify: template extraction idempotency, hook execution order, marker state machine
  - Dependencies: diff analysis from Phase 1 (identifies what to test)

Phase 3: Update Safety Hardening
  - Test: linbo-update.service.js (extend existing test suite)
  - Cover: partial update failure states (provision OK, rebuild fails)
  - Cover: concurrent update attempt (409 response)
  - Cover: version comparison edge cases (dpkg --compare-versions)
  - Dependencies: Phase 2 establishes test infrastructure

Phase 4: Hook System Hardening (if init.sh serverid patch needed)
  - Implement 02_init-serverid-fix pre-hook (if viable)
  - Validate hook is update-safe (applies cleanly to new init.sh versions)
  - Test: hook runs correctly, DHCP serverid preserved
  - Dependencies: Phase 2 (hook execution tests)
```

**Phase ordering rationale:**
- Documentation first: the diff analysis is the foundation for knowing what needs testing.
- Tests before hardening: can't harden what you can't verify.
- Hook work last: the serverid fix may not be cleanly expressible as a hook (may need conditional logic based on init.sh version). Needs research.

---

## Sources

All findings are HIGH confidence — derived directly from current codebase:

- `scripts/server/update-linbofs.sh` — build pipeline, all 15 steps, hook execution
- `containers/init/entrypoint.sh` — bootstrap flow, checkpoint system, kernel set provisioning
- `containers/api/src/services/linbo-update.service.js` — update orchestration, dual provisioning logic
- `containers/api/src/services/linbofs.service.js` — shell-out wrapper, key management
- `containers/api/src/services/kernel.service.js` — kernel variant switch flow (referenced, not read in full)
- `containers/api/src/index.js` lines 665-698 — auto-rebuild startup hook, marker state machine
- `containers/api/src/routes/system/linbo-update.js` — HTTP API surface for updates
- `containers/api/src/routes/system/linbofs.js` — HTTP API surface for linbofs management
- `containers/api/src/routes/system/kernel.js` — HTTP API surface for kernel switching
- `docs/hooks.md` — hook system documentation, LMN compatibility notes
- `.planning/PROJECT.md` — milestone context, constraint definitions, key decisions

---

*Architecture research: 2026-03-10*
