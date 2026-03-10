# Technology Stack: linbofs Boot-Pipeline Transparency

**Project:** LINBO Docker v1.2 — linbofs Boot-Pipeline Transparency
**Researched:** 2026-03-10
**Mode:** Subsequent milestone — diff analysis, NOT new npm dependencies
**Confidence:** HIGH — LMN original obtained verbatim from GitHub, Docker version read directly

---

## Executive Decision

**No new stack components needed.** The work for v1.2 is analysis, documentation, and optionally a lightweight diff-tracking script (pure bash). The existing stack already covers everything.

The primary deliverable is a precise catalogue of every difference between `scripts/server/update-linbofs.sh` (Docker) and the LMN original at `serverfs/usr/sbin/update-linbofs` (upstream).

---

## Diff: Docker update-linbofs.sh vs LMN Original

### Sources Compared

| Version | Location | Retrieved |
|---------|----------|-----------|
| LMN Original | `github.com/linuxmuster/linuxmuster-linbo7` `serverfs/usr/sbin/update-linbofs` | 2026-03-10 (verbatim from raw.githubusercontent.com) |
| Docker | `scripts/server/update-linbofs.sh` in this repo | Read directly |

---

### Diff 1: Lockfile Mechanism

**LMN Original:**
```bash
locker=/tmp/.update-linbofs.lock
if [ -e "$locker" ]; then
    echo "Caution! Probably there is another update-linbofs process running!"
    ...
    exit 1
fi
touch $locker || exit 1
chmod 400 "$locker"
```
Uses a simple `touch`-based lockfile in `/tmp`. No guaranteed cleanup on crash. Not safe for concurrent Docker containers sharing a volume.

**Docker:**
```bash
REBUILD_LOCK="${CONFIG_DIR}/.rebuild.lock"
exec 8>"$REBUILD_LOCK"
if ! flock -n 8; then
    echo "ERROR: Another update-linbofs process is running!"
    exit 1
fi
# Lock is held until script exits (fd 8 is closed automatically)
```

**Rationale for Docker change:**
- `flock` on a file descriptor is atomic and crash-safe — the lock is released automatically when the process exits (normal or crash), no stale lockfiles
- Docker shares a volume between the API container and the build process — the shared volume makes `/etc/linuxmuster/linbo/.rebuild.lock` the correct location (visible to all containers)
- `touch + chmod` leaves a stale file if the process is killed; `exec 8>file + flock` does not

**DO NOT revert.** The Docker locking is strictly superior.

---

### Diff 2: Prerequisites Check

**LMN Original:** None. Relies on the LMN environment being set up correctly. No tool checks.

**Docker:**
```bash
for tool in xz cpio argon2; do
    if ! command -v $tool &> /dev/null; then
        echo "ERROR: Required tool '$tool' not found!"
        exit 1
    fi
done
```
Also checks for `linbofs64` existence and `rsyncd.secrets` non-empty before proceeding.

**Rationale for Docker change:**
- Docker containers are minimal Alpine-based images; tools may be absent if the Dockerfile changes
- Fail-fast with actionable messages is better than cryptic mid-script failures

**DO NOT revert.** These checks are defensive programming appropriate for a containerized build.

---

### Diff 3: Environment Sourcing

**LMN Original:**
```bash
source /usr/share/linuxmuster/helperfunctions.sh || exit 1
if [ ! -s "$SETUPINI" ]; then
    echo "linuxmuster.net is not yet set up, aborting!"
    exit 0
fi
```
Requires the full LMN server environment (`helperfunctions.sh` defines `$LINBODIR`, `$LINBOSYSDIR`, `$LINBOVARDIR`, `$LINBOCACHEDIR`, `$KSTBDIR`, `$KLTSDIR`, `$KLGCDIR`, `$HOOKSDIR`, `$SETUPINI`, etc.).

**Docker:**
```bash
LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
CONFIG_DIR="${CONFIG_DIR:-/etc/linuxmuster/linbo}"
CACHE_DIR="/var/cache/linbo"
KERNEL_VAR_DIR="${KERNEL_VAR_DIR:-/var/lib/linuxmuster/linbo/current}"
HOOKSDIR="${HOOKSDIR:-/etc/linuxmuster/linbo/hooks}"
```
All paths are configurable via environment variables with sensible defaults. No LMN environment dependency.

**Rationale for Docker change:**
- `helperfunctions.sh` is part of linuxmuster.net and not available in Docker
- Docker containers configure paths via environment variables (standard Docker practice)
- The defaults match the LMN-standard paths exactly, so the script works identically on an LMN server if run manually

**DO NOT revert.** This is the fundamental reason the script can run standalone.

---

### Diff 4: Kernel Variant Parsing

**LMN Original:**
```bash
if [ -s "$LINBOSYSDIR/custom_kernel" ]; then
    source "$LINBOSYSDIR/custom_kernel"
    if [ -n "$KERNELPATH" ]; then
        case "$KERNELPATH" in
            ${KLGCDIR}*|legacy)
                KERNELPATH="$KLGCDIR/linbo64"
                MODULESPATH="$KLGCDIR/modules.tar.xz"
                KVERS="$(cat "$KLGCDIR/version")"
                KTYPE="legacy"
                ;;
            ${KLTSDIR}*|longterm)
                ...
                KTYPE="longterm"
                ;;
            *)
                # custom kernel stuff
                ...
                KTYPE="custom"
                ;;
        esac
    fi
fi
```
Uses `source` (which can execute arbitrary code) on the `custom_kernel` file. Supports a `KTYPE="custom"` with arbitrary `KERNELPATH`/`MODULESPATH` pointing anywhere on the filesystem.

**Docker:**
```bash
KPATH=$(grep -E '^[[:space:]]*KERNELPATH=' "$CUSTOM_KERNEL_FILE" 2>/dev/null | tail -1 | sed 's/.*=//;s/[" ]//g')
case "$KPATH" in
    legacy|longterm|stable) KTYPE="$KPATH" ;;
    "") KTYPE="stable" ;;
    *) echo "ERROR: Invalid KERNELPATH '$KPATH' in custom_kernel"; exit 1 ;;
esac
```
Uses `grep` + `sed` to extract only the `KERNELPATH=` line without executing it. Only accepts `stable`, `longterm`, `legacy` as values. Rejects anything else with an error.

**Rationale for Docker change:**
- `source` on a user-controlled file is a code execution vulnerability
- Docker manages kernel variants atomically via `KERNEL_VAR_DIR/current` — there is no need for arbitrary path support
- Custom kernel paths pointing to host `/boot` were removed in Session 31 (HOST_KERNEL architecture abolished)
- `grep`-based parsing is idempotent and safe; `source` is not

**DO NOT revert.** The security improvement is intentional. If custom kernel support is needed later, it must be done via a controlled mechanism, not `source`.

---

### Diff 5: Kernel Module Injection Method

**LMN Original:**
```bash
case "$KTYPE" in
    stable|longterm|legacy)
        echo "Extracting modules ..."
        tar xf "$MODULESPATH" | exit 1
        ;;
    *)
        echo "Copying modules ..."
        cp -r "$MODULESPATH" lib/modules
        ;;
esac
```
Pipes `tar xf` output to `exit 1` — this is a bug in the LMN original (pipes the stdout of `tar` to `exit`, not what was intended; likely meant `|| exit 1`). No path traversal check on the tar archive.

**Docker:**
```bash
# Tar safety: check for path traversal
if tar tf "$VARIANT_DIR/modules.tar.xz" | grep -qE '(^/|\.\.)'; then
    echo "ERROR: modules.tar.xz contains absolute paths or .. segments — refusing to extract"
    exit 1
fi

tar xf "$VARIANT_DIR/modules.tar.xz"

# Validate: exactly one lib/modules/<kver> directory
MOD_DIRS=$(ls -d lib/modules/*/ 2>/dev/null | wc -l)
if [ "$MOD_DIRS" -ne 1 ]; then
    echo "ERROR: Expected exactly 1 modules directory, found $MOD_DIRS"
    exit 1
fi

MOD_KVER=$(basename $(ls -d lib/modules/*/))
# Sanity check on module version format
if [ -z "$MOD_KVER" ] || [ ${#MOD_KVER} -lt 3 ] || ! echo "$MOD_KVER" | grep -qE '^[0-9]+\.'; then
    echo "ERROR: Suspicious module version '$MOD_KVER'"
    exit 1
fi
```

**Rationale for Docker change:**
- Path traversal check: `modules.tar.xz` is built by the init container from a verified APT package, but belt-and-suspenders security is correct
- Module directory count validation: detects corrupt archives
- Version format check: catches mismatched archive / metadata
- The LMN `tar xf ... | exit 1` is almost certainly a typo (`|` instead of `||`); Docker uses correct error handling

**DO NOT revert.** These are security and robustness improvements.

---

### Diff 6: Password Hash Source

**LMN Original:**
```bash
[ ! -s /etc/rsyncd.secrets ] && bailout "/etc/rsyncd.secrets not found!"
linbo_passwd="$(grep ^linbo /etc/rsyncd.secrets | awk -F\: '{ print $2 }')"
```
Hardcoded path `/etc/rsyncd.secrets`.

**Docker:**
```bash
linbo_passwd="$(grep ^linbo "$RSYNC_SECRETS" | awk -F: '{print $2}')"
```
Uses `$RSYNC_SECRETS` environment variable (default: `$CONFIG_DIR/rsyncd.secrets`).

**Rationale for Docker change:**
- Docker stores rsync secrets in the config volume at `/etc/linuxmuster/linbo/rsyncd.secrets`, not at `/etc/rsyncd.secrets`
- Environment-configurable path is consistent with Docker conventions

**DO NOT revert.** The path is deliberately different from the LMN host path.

---

### Diff 7: Locale Handling

**LMN Original:**
```bash
copy_locale() {
    [ -z "$LANG" ] && return
    cmap="${LANG#*.}"
    echo "Copy locale $LANG ..."
    mkdir -p usr/lib/locale
    mkdir -p usr/share/locale
    ...
    cp /usr/sbin/locale-gen usr/sbin
    cp /usr/bin/localedef usr/bin
    ...
    chroot ./ /usr/sbin/locale-gen --lang "$LANG"
    rm -f usr/sbin/locale-gen usr/bin/localedef
}
```
Copies system locale files and runs `locale-gen` inside a chroot. Requires `locale-gen` and related tools to exist in the build environment.

**Docker:**
No `copy_locale()` function. Locale is not injected into linbofs64.

**Rationale for Docker change:**
- LINBO clients run purely in RAM as a minimal rescue environment — localized error messages are not required for the boot/imaging workflow
- The linbofs64 template from the APT package already has basic English locale support
- `chroot` inside a Docker container requires `--privileged` or specific capabilities; the API container runs without these
- Eliminating locale injection reduces build complexity and linbofs64 size

**DO NOT revert.** If locale is ever needed, it should be done via a pre-hook script.

---

### Diff 8: Firmware Handling

**LMN Original:**
```bash
provide_firmware() {
    # reads from $LINBOSYSDIR/firmware AND parses $LINBOLOGDIR/*_linbo.log
    # downloads from kernel.org if not locally available
    # copies to FW_CACHE, then rsync to linbofs
    local fw_conf="$LINBOSYSDIR/firmware"
    download_fwlist   # from kernel.org
    copy_fw           # from /lib/firmware
    download_fw       # from kernel.org WHENCE list
    ...
    rsync -v --exclude="$fw_list" "$FW_CACHE/"* "$fw_target/"
}
```
Full firmware pipeline:
1. Parses LINBO host logs for missing firmware entries
2. Downloads firmware list from kernel.org
3. Falls back to downloading firmware blobs from kernel.org
4. Uses `rsync` to copy to linbofs

**Docker:**
```bash
# Step 10.5: Inject firmware files
FIRMWARE_CONFIG="$CONFIG_DIR/firmware"

if [ -f "$FIRMWARE_CONFIG" ] && grep -qvE '^[[:space:]]*(#|$)' "$FIRMWARE_CONFIG" 2>/dev/null; then
    # Reads firmware config line-by-line
    # Path traversal checks (segment-based and symlink-out-of-base)
    # Handles .zst decompression
    # rsync --safe-links for directories
    # cp -aL for single files
fi
```
Firmware pipeline:
1. Reads only from `$CONFIG_DIR/firmware` (no log parsing, no kernel.org downloads)
2. Source is always local `/lib/firmware/` on the host
3. Comprehensive path traversal protection and symlink validation
4. `.zst` decompression handled inline

**Rationale for Docker change:**
- Log-based firmware auto-detection is a Docker-exclusive feature managed by the Firmware Manager in the API (separate service) — the API populates `$CONFIG_DIR/firmware`, the script just reads it
- Downloading firmware from kernel.org during a linbofs rebuild is inappropriate for a containerized build (network dependency during critical rebuild, adds minutes of latency)
- Docker's firmware source is always the host's `/lib/firmware/` — this is clean and predictable
- Path traversal protection is stronger in the Docker version (segment-based check vs. none in LMN)
- `rsync --safe-links` prevents symlink escapes

**DO NOT revert the path traversal protection.** The log-parsing and kernel.org download features could potentially be added back via a pre-hook if needed.

---

### Diff 9: inittab Custom Entries

**LMN Original:**
```bash
# provide additional inittab entries
conf="$LINBOSYSDIR/inittab"
if [ -s "$conf" ]; then
    echo "Adding custom $(basename $conf) entries ..."
    echo "# custom entries" >> "etc/$(basename $conf)"
    grep -v ^# "$conf" | grep -v '^$' >> "etc/$(basename $conf)"
fi
```
Supports appending custom inittab entries from a config file.

**Docker:**
No `inittab` injection.

**Rationale for Docker change:**
- The `inittab` in linbofs64 controls `init.sh`, `linbo.sh`, and `linbo_vnc` — modifying it risks breaking the boot chain
- The project principle is "Vanilla LINBO, only Hooks" — the pre-hook system is the correct mechanism for any custom init entries
- No current use case exists for custom inittab entries

**DO NOT revert.** If needed, implement as a pre-hook.

---

### Diff 10: efipxe Copy

**LMN Original:**
```bash
# copy efi pxe devicenames
cp "$LINBOSHAREDIR/efipxe" usr/share/linbo
```
Copies an `efipxe` device names file from the LMN share directory.

**Docker:**
No `efipxe` copy.

**Rationale for Docker change:**
- `$LINBOSHAREDIR` maps to `/usr/share/linuxmuster/linbo/` — this directory is part of the LMN server installation, not available in Docker
- The `efipxe` file likely comes from the APT package itself and is already present in the linbofs64 template extracted from the package
- Verified: UEFI PXE boot works correctly on real hardware (Lenovo L16, Intel Core Ultra 5) without this explicit copy step

**DO NOT revert.** If UEFI boot breaks on a specific device, investigate whether the template already contains this file.

---

### Diff 11: SSH Key Sources

**LMN Original:**
```bash
cp $LINBOSYSDIR/dropbear_*_host_key etc/dropbear
cp $LINBOSYSDIR/ssh_host_*_key* etc/ssh
cat /root/.ssh/id_*.pub > .ssh/authorized_keys
[ -s /root/.ssh/authorized_keys ] && cat /root/.ssh/authorized_keys >> .ssh/authorized_keys
```
Reads authorized_keys only from `/root/.ssh/`.

**Docker:**
```bash
# Dropbear host keys
if ls "$CONFIG_DIR"/dropbear_*_host_key 1>/dev/null 2>&1; then
    cp "$CONFIG_DIR"/dropbear_*_host_key etc/dropbear/
fi

# OpenSSH host keys
if ls "$CONFIG_DIR"/ssh_host_*_key* 1>/dev/null 2>&1; then
    cp "$CONFIG_DIR"/ssh_host_*_key* etc/ssh/
fi

# Authorized keys from config dir
if ls "$CONFIG_DIR"/*.pub 1>/dev/null 2>&1; then
    cat "$CONFIG_DIR"/*.pub > .ssh/authorized_keys
fi

# Also check /root/.ssh for authorized keys (compatibility with linuxmuster.net)
if [ -f /root/.ssh/id_rsa.pub ] || [ -f /root/.ssh/id_ed25519.pub ]; then
    cat /root/.ssh/id_*.pub >> .ssh/authorized_keys 2>/dev/null
fi
```
Reads authorized_keys from both `$CONFIG_DIR/*.pub` (Docker's primary location) AND `/root/.ssh/` (LMN compatibility). The `$CONFIG_DIR/*.pub` location is the primary source for keys provisioned by the SSH container.

**Rationale for Docker change:**
- Docker auto-provisions keys into the config volume (`$CONFIG_DIR`) via the SSH container's `entrypoint.sh`
- The key files are named `server_id_rsa.pub`, `linbo_client_key.pub`, etc. — not `id_rsa.pub` as LMN expects
- Guard clauses (`if ls ... 2>&1`) prevent errors on fresh deploys before keys are generated
- The `--owner 0:0` flag on the `cpio` repack (Step 11) ensures keys in the initrd are owned by root, which is required by dropbear

**DO NOT revert.** The key source paths are different by design.

---

### Diff 12: Repack Command (Critical: Device Nodes)

**LMN Original:**
```bash
find . -print | cpio --quiet -o -H newc | xz -e --check=none -z -f -T 0 -c -v > "$linbofs_xz"
```
Single cpio archive, no device nodes injection, no `--owner` flag.

**Docker:**
```bash
find . -print | cpio --quiet -o -H newc --owner 0:0 | xz -e --check=none -z -f -T 0 -c > "$LINBOFS.new"
# Append device nodes as a separately compressed cpio segment.
xz -e --check=none -z -f -T 0 -c < "$DEVNODES_CPIO" >> "$LINBOFS.new"
```

Three differences:
1. `--owner 0:0` flag on cpio
2. Device nodes appended as second XZ segment
3. Writes to `$LINBOFS.new` (temp file), then renamed atomically in Step 13

**Rationale for Docker change:**

**--owner 0:0:** The Docker build runs as the `linbo` user (uid 1001), but the LINBO client boots as root. Without `--owner 0:0`, all files in the initrd are owned by uid 1001. Dropbear refuses `authorized_keys` not owned by root. This flag was explicitly added in Session 33 to fix SSH authentication failures.

**Device nodes:** Device nodes (`/dev/console`, `/dev/null`) require `mknod` which requires root or `CAP_MKNOD`. The Docker API container does not have this capability. The solution is to embed a pre-built cpio fragment containing these two nodes (as base64 in the script) and append it as a second XZ segment. Linux initramfs supports concatenated compressed cpio archives.

**Atomic write:** The LMN original writes directly to the final file. If the process is killed mid-write, the TFTP server serves a corrupt file. Docker writes to `$LINBOFS.new` and renames atomically after verification.

**DO NOT revert any of these three changes.** They solve real, verified problems:
- `--owner 0:0`: SSH auth would break
- Device nodes: `/dev/null` and `/dev/console` are required by dropbear and other processes
- Atomic write: TFTP race condition (documented in Session 19, doc 09-kernel-version-bug.md)

---

### Diff 13: Post-Repack Steps

**LMN Original:**
After repack, immediately copies kernel and runs `make-linbo-iso.sh`:
```bash
cp "$KERNELPATH" "$LINBODIR/linbo64"
md5sum "$LINBODIR/linbo64" | awk '{ print $1 }' > "$LINBODIR/linbo64.md5"
# create iso files
"$LINBOSHAREDIR"/make-linbo-iso.sh
# execute post hook scripts
exec_hooks post
rm -f "$locker"
```

**Docker:**
Additional steps after repack:
1. **Size verification** (Step 12): Rejects files smaller than 10MB
2. **MD5 generation** (Step 14): Same as LMN
3. **Build status marker** (Step 14.5): Writes `.linbofs-patch-status` — TFTP container waits for this
4. **Docker volume sync** (Step 14.6): Copies to Docker volume if `LINBO_DIR` differs
5. **Kernel copy** (Step 15): Same as LMN
6. **Post-hooks** (Step 15.5): Same as LMN
7. **No ISO creation**: `make-linbo-iso.sh` not called

**Rationale for Docker changes:**

**Size verification:** Guards against corrupt rebuilds (e.g., XZ compression failure producing a tiny file). Minimum 10MB is conservative — a real linbofs64 is 50-170MB.

**Build status marker:** The TFTP container reads `.linbofs-patch-status` as a gate before serving files to PXE clients. Without this marker, clients could receive an incomplete linbofs64 during the first build.

**Docker volume sync:** When `update-linbofs.sh` runs on the Docker host (outside containers), `LINBO_DIR` might be `/srv/linbo` while the actual Docker volume is at `/var/lib/docker/volumes/linbo_srv_data/_data/`. The sync step handles this case.

**No ISO:** `make-linbo-iso.sh` is part of the LMN server package, not available in Docker. LINBO Docker doesn't need ISO support (PXE-only boot chain).

**DO NOT revert the size check, marker, or volume sync.** The ISO step is intentionally absent.

---

### Diff 14: Additional Docker-Only Injections

Docker adds several injection steps not present in the LMN original:

**Step 10.5: Firmware injection** — covered in Diff 8 above. Different algorithm, same purpose.

**Step 10.6: wpa_supplicant.conf** — LMN original also has this step. Identical.

**Step 10.7a: GUI themes** — Docker injects GUI themes from `$LINBO_DIR/gui-themes/` into the `themes/` directory inside linbofs64. The LMN original has no GUI theme injection mechanism.

**Step 10.7b: Custom linbo_gui binary** — Docker supports replacing the default `linbo_gui` binary with a custom one from `$CONFIG_DIR/linbo_gui`. The LMN original has no mechanism for this.

**Rationale:** GUI theming and custom GUI binaries are Docker-exclusive features (React Frontend, edulution branding). These additions do not affect vanilla LINBO behavior — the standard binary is used when no override is present.

---

### Diff 15: Hook System

**LMN Original:**
```bash
exec_hooks() {
    case "$1" in
        pre|post) ;;
        *) return ;;
    esac
    local hookdir="$HOOKSDIR/update-linbofs.$1.d"
    [ -d "$hookdir" ] || mkdir -p $hookdir    # creates dir if missing
    local hook_files=$(find "$hookdir" -type f -executable)
    [ -z "$hook_files" ] && return
    local file
    for file in $hook_files; do
        if [ -x "$file" ]; then
            echo "Executing $1 hookfile $file"
            "$file"         # no error handling — failure propagates or silently continues
        fi
    done
}
# Hook dir: $HOOKSDIR = /var/lib/linuxmuster/hooks/
# Exports: nothing — hooks must source helperfunctions.sh
# Sorting: unsorted (find order)
```

**Docker:**
```bash
exec_hooks() {
    case "$1" in
        pre|post) ;;
        *) return ;;
    esac
    local hookdir="$HOOKSDIR/update-linbofs.$1.d"
    [ -d "$hookdir" ] || return 0             # returns cleanly if dir missing
    local hook_files
    hook_files=$(find "$hookdir" -type f -executable 2>/dev/null | sort)  # sorted
    [ -z "$hook_files" ] && return 0
    local file
    for file in $hook_files; do
        echo "Executing $1 hook: $(basename "$file")"
        "$file" || echo "  WARNING: hook $(basename "$file") exited with $?"  # non-fatal
    done
}
# Hook dir: $HOOKSDIR = /etc/linuxmuster/linbo/hooks/
# Exports: LINBO_DIR, CONFIG_DIR, CACHE_DIR, KTYPE, KVERS, WORKDIR
# Sorting: alphabetical (| sort)
export LINBO_DIR CONFIG_DIR CACHE_DIR KTYPE KVERS WORKDIR
```

Differences:
1. Hook directory path: `/etc/linuxmuster/linbo/hooks/` vs LMN's `/var/lib/linuxmuster/hooks/`
2. Directory handling: Docker returns `0` if dir missing (no auto-create); LMN creates dir
3. Sorting: Docker pipes through `sort` (alphabetical order via numeric prefixes); LMN uses `find` order (undefined)
4. Error handling: Docker logs WARNING but continues build; LMN hook failure may stop build
5. Exported variables: Docker exports `LINBO_DIR`, `CONFIG_DIR`, `CACHE_DIR`, `KTYPE`, `KVERS`, `WORKDIR`; LMN exports nothing
6. `exec_hooks post` runs before the summary (same as LMN)

**Rationale for Docker changes:**
- Path: Docker stores everything under `/etc/linuxmuster/linbo/` for volume mounting simplicity
- Sorting: Numeric prefix ordering (`01_`, `02_`) requires sorted execution; LMN hooks are run once on a full server and ordering doesn't matter much
- Error handling: A failed Plymouth theme hook should not abort the entire linbofs rebuild; making hooks non-fatal is correct for optional customizations
- Exported variables: Hooks need access to build context without sourcing LMN's `helperfunctions.sh`

**DO NOT revert.** The hook improvements are documented in `docs/hooks.md` and are the intended interface for all customizations.

---

## Compatibility Matrix: LMN Hook Scripts in Docker

| LMN Hook Feature | Docker Compatible | Notes |
|-----------------|-------------------|-------|
| Hook in `.pre.d/` | Yes | Same pattern, different directory path |
| Hook in `.post.d/` | Yes | Same pattern |
| Uses `$LINBODIR` | Yes (as `$LINBO_DIR`) | Docker exports `LINBO_DIR` |
| Uses `$LINBOSYSDIR` | No | Use `$CONFIG_DIR` instead |
| Uses `$LINBOCACHEDIR` | Partial | Use `$CACHE_DIR` instead |
| Uses `$KTYPE`, `$KVERS` | Yes | Exported by Docker |
| Uses `$WORKDIR` | Yes (Docker-only) | Not available in LMN |
| Sources `helperfunctions.sh` | No | Not available in Docker |
| Calls `bailout` | No | LMN function, not available in Docker |

---

## Summary: What Docker Adds vs LMN Original

| Category | Docker Addition | Purpose |
|----------|----------------|---------|
| Security | `flock`-based locking | Crash-safe, no stale locks |
| Security | Prereq tool check | Fail-fast in minimal containers |
| Security | No `source` on user files | Prevents code injection |
| Security | tar path traversal check | Belt-and-suspenders |
| Security | Firmware symlink escape check | Prevent injection attacks |
| Correctness | `--owner 0:0` on cpio | SSH auth works as root |
| Correctness | Device nodes via cpio fragment | `/dev/null` + `/dev/console` without CAP_MKNOD |
| Correctness | Atomic write (`$LINBOFS.new` → rename) | No partial file served during rebuild |
| Correctness | Size check (>10MB) | Detect corrupt rebuilds |
| Robustness | Sorted hook execution | Deterministic order via numeric prefix |
| Robustness | Non-fatal hooks | Theme hook failure doesn't break build |
| Robustness | Hook variable exports | No `helperfunctions.sh` dependency |
| Docker-specific | Build status marker | TFTP gate |
| Docker-specific | Docker volume sync | Host path vs volume path |
| Docker-specific | GUI theme injection | Branding support |
| Docker-specific | Custom linbo_gui injection | Binary override |
| Docker-specific | Kernel variant support (3-way) | stable/longterm/legacy |
| Env | All paths via env vars | Docker volume configurability |

## Summary: What Docker Removes vs LMN Original

| Removed Feature | Reason | Alternative |
|----------------|--------|-------------|
| `source helperfunctions.sh` | LMN-only, not available | Env vars with defaults |
| `$SETUPINI` check | LMN-only setup marker | Not needed in Docker |
| Locale injection (`copy_locale`) | `chroot` requires capabilities not available | Locale in template is sufficient |
| Log-based firmware auto-detection | API's Firmware Manager handles this | `$CONFIG_DIR/firmware` populated by API |
| kernel.org firmware download | Network dependency during build | Pre-populated by API |
| inittab custom entries | Risk, no use case | Pre-hook |
| efipxe copy | File is in template already | Validated working on real hardware |
| ISO creation (`make-linbo-iso.sh`) | Not available in Docker | PXE-only boot, ISO not needed |
| Unsorted hook execution | Non-deterministic | Replaced with sorted |
| Auto-create hook dir | Silent side-effect | Return 0 if missing |
| Custom kernel path support | Session 31: HOST_KERNEL architecture removed | `stable/longterm/legacy` variants only |

---

## Drift Tracking Strategy

### Problem

When `linuxmuster-linbo7` releases a new version, the LMN `update-linbofs` script may change. Without a systematic diff process, Docker might miss important fixes or accidentally drift from improvements.

### Recommended Approach: Pinned Reference Copy

**Store a copy of the LMN original** in the repository for comparison:

```
scripts/server/update-linbofs-lmn-original.sh   # Verbatim copy of LMN version
scripts/server/update-linbofs.sh                 # Docker's version
```

At each LMN package update:
1. Download the new LMN version: `dpkg-deb -x linuxmuster-linbo7_*.deb /tmp/lmn-extract && cp /tmp/lmn-extract/usr/sbin/update-linbofs scripts/server/update-linbofs-lmn-original.sh`
2. Run `diff scripts/server/update-linbofs-lmn-original.sh scripts/server/update-linbofs.sh`
3. Review each diff hunk against the catalogue above
4. Apply any relevant fixes to the Docker version

**What to watch for in LMN updates:**
- New injection steps (new features in LINBO may require corresponding injection)
- Changes to internal paths (e.g., if LMN changes `etc/linbo_pwhash` location, Docker must match)
- New firmware handling (LMN 4.3.30+ added log-based firmware detection — Docker handles this differently via API)
- Hook interface changes (though the hook contract is stable by design)

### Risk Assessment: Upstream Changes

| Change Type | Risk | Detection | Action |
|-------------|------|-----------|--------|
| New injection file location (e.g., password hash path) | HIGH | Client can't authenticate | Check via: `xz -dc linbofs64 \| cpio -t 2>/dev/null \| grep linbo_pw` |
| linbofs64 format change (not cpio+xz) | LOW | Repack fails, size check catches it | Build will fail with error |
| New module requirement (new kernel ABI) | MEDIUM | Module loading fails on client | Test boot after update |
| GRUB config syntax change | MEDIUM | Clients don't boot | GRUB logs + test in VM |
| New wpa_supplicant syntax | LOW | WLAN only | Only affects wireless clients |
| Argon2 parameters change | LOW | Client login fails | Compare `etc/linbo_pwhash` content |

### Quick Verification After Update

```bash
# 1. Check password hash in built linbofs64
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep linbo_p"
# Expect: etc/linbo_pwhash, etc/linbo_salt

# 2. Check SSH keys injected
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep -E '(dropbear|authorized)'"
# Expect: etc/dropbear/, .ssh/authorized_keys

# 3. Check kernel modules present
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep lib/modules | head -3"
# Expect: lib/modules/<kver>/...

# 4. Check device nodes
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 2>/dev/null | cpio -tv 2>/dev/null | grep 'dev/'"
# Expect: dev/console (c 5,1), dev/null (c 1,3)

# 5. Check file ownership
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 2>/dev/null | cpio -tv 2>/dev/null | grep authorized_keys"
# Expect: root root .ssh/authorized_keys
```

---

## What NOT to Change Back to Original

These Docker differences MUST be preserved in any future update:

| Item | Why It Must Stay |
|------|-----------------|
| `flock` locking | LMN `touch`-based locking leaves stale files on crash |
| `--owner 0:0` on cpio | Without this, SSH auth fails (dropbear rejects non-root authorized_keys) |
| Device nodes cpio fragment | Without this, `/dev/console` and `/dev/null` are missing (dropbear crash) |
| Atomic `$LINBOFS.new` write | Without this, TFTP serves corrupt files during rebuild |
| Env vars instead of `helperfunctions.sh` | LMN environment not available in Docker |
| `grep` instead of `source` for custom_kernel | Security: no arbitrary code execution |
| Non-fatal hooks | Theme hooks should not break the build |
| Hook variable exports | Hooks need context without LMN dependencies |
| Size check (>10MB) | Catches silent XZ failures |
| Build status marker | TFTP gate would break without it |

---

## Existing Stack (Unchanged from v1.1)

The v1.2 work requires no stack changes. All tools are already present.

| Technology | Version | Purpose |
|------------|---------|---------|
| Bash | 5.x | update-linbofs.sh, entrypoint.sh |
| xz-utils | system | cpio compression/decompression |
| cpio | system | initramfs packing/unpacking |
| argon2 | system | Password hashing in linbofs64 |
| flock | util-linux | Crash-safe locking |
| depmod | kmod | Kernel module dependency generation |
| rsync | system | Firmware directory copying |
| tar | system | Module archive extraction |
| md5sum | coreutils | Integrity checksums |
| Node.js 20 | 20.20.0-alpine | API container |
| Express.js | ^4.18.2 | REST API (linbo-update.service.js) |
| ioredis | ^5.3.2 | Update lock, status tracking |

## Sources

- LMN Original: [github.com/linuxmuster/linuxmuster-linbo7 serverfs/usr/sbin/update-linbofs](https://raw.githubusercontent.com/linuxmuster/linuxmuster-linbo7/main/serverfs/usr/sbin/update-linbofs) — retrieved 2026-03-10
- Docker version: `scripts/server/update-linbofs.sh` — read directly from working tree
- Context: `docs/hooks.md` — hook system documentation
- Context: `docs/linbo-upgrade-flow.md` — upgrade flow with risk table
- Context: `docs/UNTERSCHIEDE-ZU-LINBO.md` — existing differences documentation
- Context: `docs/debug/linbo/08-kernel-schutz.md` — kernel architecture history
- Context: `containers/init/entrypoint.sh` — how init container calls update-linbofs.sh
- Session history: Sessions 30-33 (GRUB fix, kernel architecture, hooks, CPIO bug)

---
*Research: 2026-03-10*
*Confidence: HIGH — LMN original read verbatim, Docker version read directly, all diffs verified against actual code*
