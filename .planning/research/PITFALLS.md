# Domain Pitfalls

**Domain:** Adding boot-pipeline transparency and update-regression hardening to a Docker wrapper around an upstream Linux network boot system (LINBO Docker v1.2)
**Researched:** 2026-03-10
**Confidence:** HIGH (based on 33+ sessions of operational history, verified incidents in docs/debug/, known upstream divergence in Session 32, codebase analysis of update-linbofs.sh and linbo-upgrade-flow.md)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken boot clients, or silent regressions.

---

### Pitfall 1: "Fixing" Things That Work by Diffing Against the Wrong Reference

**What goes wrong:** The impulse when creating a "diff against LMN original" is to treat every difference as a defect that should be fixed. In practice Docker's update-linbofs.sh intentionally differs from the LMN original: it uses a template linbofs64.xz (not the live linbofs64), uses a KERNEL_VAR_DIR structure the LMN original does not have, and adds firmware/GUI-theme injection that LMN handles differently. A developer doing a naive diff and "aligning" Docker to LMN will remove these intentional divergences.

**Why it happens:** The phrase "Docker diverged from LMN original" implies divergence is wrong. But Docker is not a fork trying to stay in sync — it is a different deployment model with structurally different requirements. Some differences are bugs (Session 33's DEVNODES_CPIO leak); most are features.

**Consequences:**
- Removing KERNEL_VAR_DIR injection breaks kernel-variant switching (BOOT-03)
- Removing template-based rebuild reverts to in-place extraction (which was the root cause of the double-XZ bug in Session 33)
- Removing firmware injection silently breaks NIC firmware for deployed clients
- Clients boot but lack injected SSH keys, making remote management impossible

**Prevention:**
- When documenting differences, classify each one explicitly: INTENTIONAL (reason), BUG (fixed in sessionX), or UNKNOWN (needs investigation)
- The diff document must have a three-column structure: LMN behavior | Docker behavior | Justification
- Never remove a Docker-specific behavior without tracing which feature it enables

**Detection:** update-linbofs.sh builds successfully but linbofs64 is missing expected injections. Check with: `xzcat /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep -E 'lib/modules|etc/dropbear|etc/linbo_pwhash'`

**Phase:** Diff documentation phase — must be the first deliverable, before any "alignment" work.

---

### Pitfall 2: Module Selection Divergence Is Not Deterministic and Cannot Be Fixed by Matching Version Numbers

**What goes wrong:** Session 32 found that Docker's linbofs64 contains a DIFFERENT selection of kernel modules than LMN's linbofs64, despite both claiming the same kernel version (6.18.4) with the same nominal module count (720). Two processes that run `update-linbofs` with identical kernel packages do not produce identical module sets.

**Why it happens:** The `modules.tar.xz` in Docker's kernel variant sets is built by a different process than LMN's `update-linbofs`. LMN's original script likely uses `find /lib/modules/$KVERS -name "*.ko*"` to select modules, while Docker's init container builds modules.tar.xz from the kernel package's pre-selected set. The selection criteria differ even when the kernel binary is the same.

**Consequences:**
- Client enters "Remote Control Mode" (linbo_gui64_7.tar.lz not found because rsync failed because no network because a supporting module is missing)
- The symptom looks like a network driver issue but the root cause is a dependency module (e.g., a PCI bus enumeration module that a NIC driver depends on)
- The bug is intermittent: it affects specific hardware that relies on the missing module, but not hardware with builtin support

**Verified by Session 32:** Swapping LMN's linbofs64 into Docker's volume fixed boot. Swapping Docker's linbofs64 back broke it. Same kernel, same NIC drivers, different boot behavior.

**Prevention:**
- The fix is NOT to match version numbers. It is to use LMN's linbofs64 as the template (linbofs64.xz) for Docker's rebuild. This is already the architecture: Docker's update-linbofs.sh uses `$LINBOFS_TEMPLATE` (a saved copy of LMN's linbofs64.xz). If this template comes from the LMN .deb, the module selection will match.
- Verify the modules.tar.xz origin: does it come from the LMN .deb's pre-built linbofs64, or from a separately built kernel package? They must be the same source.
- Add a diagnostic: after any update, compare the module count AND the module name list (not just the count) against the LMN reference.

**Detection:** `Remote Control Mode` on clients that worked before an update. Also: `xzcat linbofs64 | cpio -t 2>/dev/null | grep lib/modules | wc -l` shows different count than LMN reference.

**Phase:** Update regression testing phase. This is the single most dangerous silent regression scenario.

---

### Pitfall 3: init.sh DHCP serverid Overwrite Cannot Be Fixed with a Pre-Hook (or Can It?)

**What goes wrong:** init.sh's `do_env()` function overwrites the `server=` kernel cmdline parameter with the DHCP `serverid` when `HOSTGROUP` is set. In Docker deployments where the DHCP server (10.0.0.11, LMN) and the LINBO server (10.0.0.13, Docker) are different machines, the client rsyncs from the wrong server. No error is shown — the client silently contacts the wrong server and may boot successfully (using LMN's images) or fail (if LMN's LINBO server is not Docker).

**Why it happens:** The vanilla LINBO assumption is that the DHCP server IS the LINBO server. Docker breaks this assumption. init.sh is a vanilla file that must not be modified directly (LINBO-Kern constraint).

**The hook problem:** A pre-hook runs inside the extracted linbofs BEFORE repack. It CAN modify init.sh inside linbofs. But this means Docker IS modifying a vanilla LINBO file, which violates the "LINBO-Kern: Vanilla" constraint. The question is whether a hook-based patch of init.sh is acceptable.

**Two possible approaches:**
1. **Hook patches init.sh** — Technically works, but init.sh is a vanilla file. If LMN ships a new init.sh in the next linbo7 package, the hook's patch offsets will be wrong, potentially breaking boot silently.
2. **GRUB cmdline workaround** — Add a custom GRUB entry that passes `serverid=$LINBO_SERVER_IP` in the cmdline to override the DHCP value before init.sh's `do_env()` runs. This works without touching init.sh.

**Consequences of doing it wrong:**
- A sed-based patch on init.sh breaks silently when LMN updates init.sh: the sed pattern no longer matches, patch is skipped, clients start rsyncing from wrong server again
- No error is visible in logs — the client appears to boot normally but from the wrong server

**Prevention:**
- If hook-patching init.sh: use a line-number-independent patch (grep for the exact function name, use awk to replace the specific logic block, not sed with line numbers)
- Include an idempotency check: after patching, verify the patch was applied by searching for the patched string — if not found, fail loudly
- Consider the GRUB cmdline approach as a zero-risk alternative: no vanilla file modification, no fragile text substitution
- Document the LMN init.sh version this was verified against (linuxmuster-linbo7 4.3.31-0)

**Detection:** Client boots but rsync session appears in the wrong server's logs (10.0.0.11 instead of 10.0.0.13). `cat /proc/cmdline` inside the booted linbofs will show `server=<wrong IP>`.

**Phase:** init.sh fix phase — high risk, needs explicit approval of approach before implementation.

---

### Pitfall 4: LMN linbo7 Package Update Silently Invalidates Docker's Template-Based Rebuild

**What goes wrong:** Docker's rebuild depends on `linbofs64.xz` as a template. This template comes from the LMN linbo7 .deb package. When LMN ships a new linbo7 version, the init container downloads the new .deb, extracts a new linbofs64.xz template, and update-linbofs.sh rebuilds from it. But if the new linbofs64.xz uses a different internal path for any of Docker's injected items (e.g., `etc/linbo_pwhash`, `etc/dropbear/`, `.ssh/authorized_keys`), Docker's injections silently write to paths that LINBO no longer reads.

**Known injection paths (verified against linuxmuster-linbo7 4.3.31-0):**
- `etc/linbo_pwhash` — rsync password hash
- `etc/linbo_salt` — argon2 salt
- `etc/dropbear/dropbear_*_host_key` — dropbear SSH keys
- `etc/ssh/ssh_host_*_key` — OpenSSH host keys
- `.ssh/authorized_keys` — server-to-client public keys
- `lib/modules/$KVERS/` — kernel modules

**Why it happens:** LMN can change internal paths in any package release without announcing it as a breaking change. Docker's update-linbofs.sh has no version-specific path validation — it writes to hardcoded paths and assumes they are correct.

**Consequences:**
- After an LMN update: Docker rebuilds successfully, linbofs64 passes the 10MB size check, but LINBO clients cannot connect via SSH (wrong key paths), or clients cannot rsync (wrong password hash path)
- The regression is only discovered when testing a real PXE boot

**Prevention:**
- After each linbo7 package update, verify that injection target paths exist in the new template: `xzcat linbofs64.xz | cpio -t 2>/dev/null | grep -E 'linbo_pwhash|linbo_salt|dropbear'`
- Add a path-existence check in update-linbofs.sh: before injecting, verify the target directory exists in the extracted linbofs; if not, fail loudly with a clear message about what changed
- Include verification in the update regression test suite: boot a client and verify SSH connectivity after every linbo7 update

**Detection:** Clients boot to LINBO GUI but SSH connections from the server fail. Also: after update, check `docker exec linbo-api xzcat /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep linbo_pwhash` should return exactly one hit.

**Phase:** Update regression testing and monitoring.

---

### Pitfall 5: CPIO Concatenation Format Requirement Is Undocumented and Fragile

**What goes wrong:** Docker's update-linbofs.sh uses a concatenated cpio/xz format: the main archive is one XZ stream, and device nodes are a second XZ stream appended to the file. This works because Linux initramfs supports concatenated compressed archives. But if any tool along the processing chain (backup, transfer, verification) treats the file as a single XZ and decompresses it, the result is a broken cpio with no device nodes. Tools like `xzcat` on the full file only emit the first XZ stream, silently dropping the device node segment.

**Evidence:** Session 33 fixed the DEVNODES_CPIO bug where a temp file in WORKDIR was being included in the main cpio archive instead of as a separate segment. The fix was correct but introduced a non-obvious dependency: the format now REQUIRES understanding of the concatenation.

**Consequences:**
- After transferring linbofs64 via any tool that recompresses or verifies XZ integrity, device nodes are lost
- Client boots to kernel but `/dev/console` and `/dev/null` are missing — kernel panics immediately
- The MD5 hash check in update-linbofs.sh still passes because it checks the concatenated file

**Prevention:**
- Document the concatenation format explicitly in update-linbofs.sh with a comment block at the top
- Add a verification step after rebuild that confirms both XZ segments decode to valid cpio: `xzcat linbofs64 | cpio -t 2>/dev/null | grep dev/console` should return at least one hit
- When implementing any copy/transfer of linbofs64, use `cp` or `rsync --inplace` — never recompress

**Detection:** Client kernel panics immediately after decompression with "unable to open an initial console". Also: `xzcat linbofs64 | cpio -t 2>/dev/null | grep dev/console` returns no output.

**Phase:** Transparency documentation phase — the format must be documented before any future modifications to the repack step.

---

## Moderate Pitfalls

---

### Pitfall 6: Hook Errors Are Swallowed by Design — Silent Failure in Production

**What goes wrong:** The current `exec_hooks()` implementation logs a WARNING if a hook exits non-zero but continues the build. This is intentional for resilience: a Plymouth theme failure should not break the entire linbofs rebuild. But in production, no one reads the update-linbofs.sh log carefully, and a hook that fails silently (e.g., the edulution Plymouth theme hook silently skipping because the source directory doesn't exist) leaves an uncommunicated degraded state.

**Evidence from docs/hooks.md:** "Hook-Fehler erzeugen WARNING, brechen Build nicht ab" — this is correct behavior but creates an observability gap.

**Consequences:**
- A hook that patches init.sh for the serverid fix fails silently after an LMN update (init.sh changed)
- The Plymouth theme hook silently skips if `/root/linbo-docker/plymouth/linbo-splash` doesn't exist
- Build status marker reports `build|OK` even though hooks failed

**Prevention:**
- Distinguish between "advisory" hooks (failure = warning, build continues) and "critical" hooks (failure = build fails)
- Add a `HOOK_REQUIRED=true` header convention that hooks can use to declare themselves critical
- Write hook warnings to the `.linbofs-patch-status` file so the API and UI can surface them: `build|OK|warnings:hook_01_failed`
- For init.sh patches specifically: implement explicit idempotency verification (see Pitfall 3 prevention)

**Detection:** `cat /srv/linbo/.linbofs-patch-status` shows `build|OK` but hook warnings appeared in container logs that no one monitors.

**Phase:** Hook governance phase — define the criticality model before adding any new hooks.

---

### Pitfall 7: The Size-Check Threshold Is Not Sensitive Enough for Regression Detection

**What goes wrong:** update-linbofs.sh validates that the new linbofs64 is at least 10MB. This catches catastrophic failures (empty cpio, failed compression) but not regressions. A linbofs64 that is missing kernel modules might be 45MB instead of 55MB — still well above 10MB, still passes the check. The double-XZ bug from Session 33 produced a 172MB linbofs64, which also passed the check.

**Evidence:** Session 33 found the double-XZ bug only because 172MB was visually suspicious. The 10MB minimum would never catch this or the inverse case (missing large module set).

**Consequences:**
- A modules.tar.xz that fails to extract silently produces a linbofs64 with no modules
- Clients boot to kernel but cannot load NIC drivers, enter Remote Control Mode
- The build log says "OK", the size check passes, MD5 is written

**Prevention:**
- Add a size sanity range check: not just minimum but also maximum (e.g., warn if > 80MB, fail if > 200MB)
- Add a content check: after rebuild, verify that `lib/modules` contains at least one `.ko` file if kernel variant injection was expected
- Compare size against previous build: warn if the new size differs from the previous by more than 20%
- Log the size breakdown: cpio entries count, estimated module size, estimated firmware size

**Detection:** `ls -lh /srv/linbo/linbofs64` shows a size that doesn't match expected range. Also: `xzcat linbofs64 | cpio -t 2>/dev/null | grep '^lib/modules.*\.ko' | wc -l` should be > 0.

**Phase:** Update regression testing phase — improve verification before adding transparency features.

---

### Pitfall 8: Atomic Symlink Swap Does Not Prevent a Race Window During Kernel Update

**What goes wrong:** The linbo-update flow uses an atomic symlink swap for kernel variant sets: `current.new -> mv -> current`. This prevents a half-written kernel set from being used. But between the symlink swap (Step 3b, Phase 3b in the upgrade flow) and the linbofs64 rebuild (Phase 4), there is a window where linbo64 (the kernel binary) has been updated but linbofs64 still contains the old kernel's modules. If a client boots during this window, it gets kernel 6.18.5 with modules compiled for 6.18.4 — a module version mismatch that causes kernel panics.

**Why it happens:** The upgrade flow in `linbo-upgrade-flow.md` sequences these as separate phases with separate error handling. Phase 3b failure does not prevent Phase 4 from running, but Phase 4 failure could leave Phase 3b's kernel update deployed with old modules.

**Consequences:**
- During a linbo7 update (which typically takes 30-90 seconds), any PXE boot that happens during Phase 3b-to-Phase 4 transition gets a mismatched kernel/modules combination
- School environments with scheduled mass-reboots (8am class start) could have many clients simultaneously hit this window

**Prevention:**
- Treat the kernel binary copy (Step 15 in update-linbofs.sh) and the linbofs64 rebuild as an atomic unit: do not update linbo64 in LINBO_DIR until AFTER linbofs64.new is successfully built
- The current update-linbofs.sh already does this correctly (linbo64 is copied at Step 15, after linbofs64 is built and verified), but this property must be explicitly documented and protected against future refactoring
- Add a correlation check: the kernel version embedded in linbofs64 (`lib/modules/` directory name) must match the version of linbo64 (`strings linbo64 | grep 'Linux version'`)

**Detection:** Client kernel panic on boot with `module: <name>: kernel taint flags: E` or version mismatch errors in dmesg. Only occurs during the update window.

**Phase:** Update regression testing — document this as an invariant to preserve.

---

### Pitfall 9: LMN APT Repo Down Makes Docker Unable to Build linbofs64 on Fresh Install

**What goes wrong:** Docker's init container downloads the linbo7 .deb from `deb.linuxmuster.net`. If this repo is unreachable (school network, DNS failure, repo maintenance), the init container fails, all dependent containers wait, and the system never starts. There is a cached .deb mechanism (v1.1 improvement), but on a true fresh install with no prior cache, no linbofs64.xz template exists. update-linbofs.sh has a fallback: it uses the existing linbofs64 if no template is found. But on a fresh install there is no existing linbofs64 either.

**Evidence from update-linbofs.sh (Step 6):**
```
if [ -f "$LINBOFS_TEMPLATE" ]; then
    echo "Extracting linbofs template (linbofs64.xz)..."
else
    echo "WARNING: linbofs64.xz template not found, using current linbofs64"
    xzcat "$LINBOFS" | ...
fi
```
And Step 1 prerequisite check: `if [ ! -f "$LINBOFS" ]; then echo "ERROR: $LINBOFS not found!" ; exit 1; fi`

**Consequence:** On a fresh install where `deb.linuxmuster.net` is unreachable, the entire system fails with a cryptic init container error. The linbofs64 prerequisite check exits immediately with no recovery path.

**Prevention:**
- Ship a minimal fallback linbofs64 in the Docker image itself (could be a very old version, just enough to boot to Remote Control Mode so an admin can diagnose)
- Or document clearly: "first install requires internet access to deb.linuxmuster.net" — and add this to the setup.sh prerequisites check
- Add the APT repo connectivity check to `make doctor` alongside the 24 existing checks

**Detection:** `docker logs linbo-init` shows download failure. All other containers in "waiting" state. `make doctor` should flag this before startup.

**Phase:** Documentation (fresh install prerequisites) and possibly bootstrap resilience phase.

---

### Pitfall 10: Overwriting linbofs64 During Active Client Downloads

**What goes wrong:** update-linbofs.sh uses a temporary file (`$LINBOFS.new`) then atomically renames it to `$LINBOFS`. However, the Web container (Nginx) serves linbofs64 via HTTP. If a client begins downloading linbofs64 just before the rename, it downloads from a file descriptor that is now the old inode. A new client starting immediately after the rename downloads the new file. Both are correct. But if the Nginx worker caches the file or keeps the file open across requests (unlikely with Nginx, which re-opens files per request), a client could get a half-written file.

The actual risk is different: the `linbofs64` path in the Docker volume is accessed by both the rebuild script (via container exec) AND the Nginx container (via volume mount). The atomic rename ensures that after Step 13, the file is complete. But during the rename, inode creation is atomic at the filesystem level only if both the source and destination are on the same filesystem (same volume). Docker volumes guarantee this.

**Why this matters for transparency:** When adding diff/monitoring tooling that reads linbofs64, any tool that opens the file for analysis during a rebuild could read a partial state if it holds the file descriptor open across the rename boundary.

**Prevention:**
- Monitoring/diff tools should always read `linbofs64.md5` first, then open `linbofs64` — if the MD5 does not match after opening, retry
- Document that the rebuild process is safe for active HTTP downloads (atomic rename) but NOT for long-running analysis processes

**Detection:** MD5 verification failure on a downloaded linbofs64. `cat linbofs64.md5` vs `md5sum linbofs64` mismatch during an active rebuild.

**Phase:** Minor — awareness item for transparency tooling phase.

---

## Minor Pitfalls

---

### Pitfall 11: depmod Inside Container May Disagree With depmod Results on Bare Metal

**What goes wrong:** update-linbofs.sh runs `depmod -a -b . "$MOD_KVER"` inside the Docker container (which runs a different Ubuntu kernel than the LINBO modules). depmod is version-independent in practice for generating dependency maps, but if the container's depmod binary is very old compared to the kernel modules, it may generate incomplete or incorrect `modules.dep.bin` files.

**Prevention:**
- Verify that `depmod -V` output in the API container is close to the kernel module version
- Check that `lib/modules/$KVERS/modules.dep` exists and is non-empty after the rebuild

**Detection:** LINBO client fails to load a module even though it exists in linbofs64. `dmesg | grep 'unknown symbol'` shows dependency resolution failures.

**Phase:** Awareness item for module injection phase.

---

### Pitfall 12: Hook Path Hardcodes `/root/linbo-docker/` — Not Portable for Other Operators

**What goes wrong:** The example Plymouth hook in `docs/hooks.md` hardcodes `THEME_SRC="/root/linbo-docker/plymouth/linbo-splash"`. This path is specific to the edulution internal deployment. An external operator deploying the Docker image as documented will have a different checkout path.

**Prevention:**
- Hooks should derive paths from exported variables (`LINBO_DIR`, `CONFIG_DIR`) rather than hardcoding `/root/linbo-docker/`
- Or: store hook-required assets in `$CONFIG_DIR` (which is Docker-volume-mounted and thus survives container rebuilds)
- Update the hook example in docs/hooks.md to use `$CONFIG_DIR` as the source

**Detection:** Hook runs on external operator's server and silently skips (because `[ -d "$THEME_SRC" ] || exit 0` exits gracefully).

**Phase:** Documentation phase — fix example before v1.2 ships.

---

### Pitfall 13: Update Regression Test Must Test a Real Boot, Not Just the Build

**What goes wrong:** After an LMN linbo7 update, it is tempting to verify "does update-linbofs.sh complete successfully?" and call it done. But the actual regressions (wrong module set — Session 32, wrong DHCP serverid — described in Session 32, wrong injection path — Pitfall 4) are all invisible until a client actually boots. A passing build does not guarantee a booting client.

**Prevention:**
- The update regression test must include: (1) run update-linbofs.sh, (2) boot a real PXE client (physical or KVM VM), (3) verify rsync completes from the correct Docker server, (4) verify SSH access from server to client
- Automated checks that can be scripted without a real boot: verify module list matches LMN reference, verify injection paths exist, verify linbofs64 size range
- A boot test on real hardware cannot be automated but must be part of the operator runbook for any linbo7 update

**Detection:** The only reliable detection is: "client boots correctly and can be SSH'd by the server."

**Phase:** Update regression testing — define the test runbook before implementing anything else.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Diff documentation | Misclassifying intentional differences as bugs | Three-column format: LMN behavior / Docker behavior / Justification |
| Diff documentation | Incomplete list if LMN original is not read directly | Always diff against the LMN .deb script, not memory or old notes |
| Module selection analysis | Concluding modules are equivalent because version matches | Compare name lists, not just counts — same count, different modules (Session 32) |
| init.sh serverid fix | Hook-based patch breaking silently after LMN update | Use idempotency verification; document LMN version patch was designed for |
| init.sh serverid fix | Choosing text-based patch over GRUB cmdline approach | Evaluate GRUB cmdline approach first — it avoids vanilla file modification entirely |
| linbofs64 format docs | Missing the concatenated XZ segment for device nodes | Document and verify both XZ segments in the transparency report |
| Hook governance | Hook failures not surfaced to API/UI | Extend `.linbofs-patch-status` to include hook warning summary |
| Update regression | Only testing build success, not client boot | Define and follow the boot test runbook for every linbo7 update |
| Update regression | Race window between kernel binary update and module injection | Document Step 15 (linbo64 copy happens AFTER linbofs64 is verified) as a protected invariant |
| Size verification | 10MB threshold catching catastrophic failure but not regressions | Add size range check and module count verification |

---

## Sources

### Project-Internal (HIGH confidence)

- `scripts/server/update-linbofs.sh` — current Docker implementation, full source read
- `docs/linbo-upgrade-flow.md` — complete upgrade flow with risk table
- `docs/debug/linbo/08-kernel-schutz.md` — kernel variant architecture, historical host-kernel removal
- `docs/debug/linbo/09-kernel-version-bug.md` — kernel version mismatch incident (Session 19), atomic deployment lesson
- `docs/hooks.md` — hook system specification and LMN compatibility table
- `.planning/PROJECT.md` — v1.2 milestone definition, constraints
- `.planning/codebase/CONCERNS.md` — fragile areas analysis including marker state machine and volume permissions
- `.planning/research/PITFALLS.md` (prior version, 2026-03-08) — v1.1 pitfalls, several still relevant (marker state machine, Docker volume paths)
- MEMORY.md Session 32 entry — module selection divergence root cause
- MEMORY.md Session 33 entry — DEVNODES_CPIO bug and double-XZ template bug
- MEMORY.md constraints — "LINBO-Kern: Vanilla — keine Änderungen an init.sh, linbo.sh"

### Derived (HIGH confidence — inferred from verified incidents)

- Module selection divergence is non-deterministic at same version: derived from Session 32 findings (identical version string, identical count, different boot behavior, fixed by swapping template source)
- CPIO concatenation format fragility: derived from Session 33 DEVNODES_CPIO bug fix and the resulting two-segment XZ format
- Injection path staleness risk: derived from the general principle that LMN can change paths in any .deb release combined with the known injection path list

---

*Pitfalls analysis: 2026-03-10*
