"""
LINBO Docker sync endpoints.

Provides read-only access to LINBO host data, start.conf files,
GRUB configs, and DHCP exports for LINBO Docker sync mode.
Uses file-based delta detection via mtimes (no database required).
"""

import hashlib
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse

from security import AuthenticatedUser, RoleChecker

from .body_schemas import LinboBatchIds, LinboBatchMacs

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/linbo",
    tags=["LINBO"],
    responses={404: {"description": "Not found"}},
)

# --- Paths ---

DEVICES_CSV_PATH = Path(
    "/etc/linuxmuster/sophomorix/default-school/devices.csv"
)
LINBO_DIR = Path("/srv/linbo")
GRUB_DIR = LINBO_DIR / "boot" / "grub"

# --- MAC / IP validation ---

_MAC_RE = re.compile(r"^([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}$")
_IP_RE = re.compile(
    r"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
    r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$"
)
_TAG_RE = re.compile(r"[^a-zA-Z0-9_-]")


# ── Helpers ──────────────────────────────────────────────────────────


def _normalize_mac(raw: str) -> str | None:
    """Normalize MAC to uppercase colon-separated. Returns None if invalid."""
    raw = raw.strip()
    if not _MAC_RE.match(raw):
        return None
    return raw.upper().replace("-", ":")


def _get_mtime(path: Path) -> datetime | None:
    """Return file mtime as UTC datetime, or None if missing."""
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None


def _mtime_cursor(dt: datetime | None) -> str:
    """Convert datetime to unix-timestamp cursor string."""
    if dt is None:
        return "0"
    return str(int(dt.timestamp()))


def _parse_devices_csv() -> tuple[list[dict], datetime | None]:
    """Parse devices.csv into a list of host dicts.

    Returns (hosts, file_mtime). Skips comment lines and invalid MACs.
    CSV columns (semicolon-separated):
      0=room, 1=hostname, 2=hostgroup, 3=mac, 4=ip, 8=sophomorixRole, 10=pxeFlag
    """
    try:
        text = DEVICES_CSV_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return [], None
    except OSError as exc:
        logger.error("Failed to read devices.csv: %s", exc)
        return [], None

    mtime = _get_mtime(DEVICES_CSV_PATH)
    hosts = []

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        fields = line.split(";")
        if len(fields) < 5:
            continue

        # Pad to 15 columns
        while len(fields) < 15:
            fields.append("")

        mac = _normalize_mac(fields[3])
        if mac is None:
            continue

        raw_ip = fields[4].strip()
        ip = raw_ip if raw_ip and _IP_RE.match(raw_ip) else None

        config = fields[2].strip()

        try:
            pxe_flag = int(fields[10].strip()) if fields[10].strip() else 1
        except ValueError:
            pxe_flag = 1

        pxe_enabled = pxe_flag > 0 and config.lower() != "nopxe"

        hosts.append({
            "mac": mac,
            "hostname": fields[1].strip(),
            "ip": ip,
            "room": fields[0].strip(),
            "school": "default-school",
            "hostgroup": config,
            "pxeEnabled": pxe_enabled,
            "pxeFlag": pxe_flag,
            "dhcpOptions": "",
            "startConfId": config,
            "updatedAt": mtime.isoformat() if mtime else None,
        })

    return hosts, mtime


def _list_startconf_ids() -> list[str]:
    """Return list of start.conf group IDs from /srv/linbo/start.conf.*."""
    ids = []
    for p in sorted(LINBO_DIR.glob("start.conf.*")):
        group = p.name.removeprefix("start.conf.")
        if group:
            ids.append(group)
    return ids


def _list_grub_cfg_ids() -> list[str]:
    """Return list of GRUB config group IDs from /srv/linbo/boot/grub/*.cfg."""
    ids = []
    for p in sorted(GRUB_DIR.glob("*.cfg")):
        group = p.stem
        if group:
            ids.append(group)
    return ids


def _generate_dnsmasq_proxy(hosts: list[dict]) -> str:
    """Generate dnsmasq proxy-DHCP config from host list."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pxe_hosts = [h for h in hosts if h["pxeEnabled"]]

    lines = [
        "#",
        "# LINBO - dnsmasq Configuration (proxy mode)",
        f"# Generated: {ts}",
        f"# Hosts: {len(pxe_hosts)}",
        "#",
        "",
        "# Proxy DHCP mode - no IP assignment, PXE only",
        "port=0",
        "dhcp-range=10.0.0.0,proxy",
        "log-dhcp",
        "",
        "interface=eth0",
        "bind-interfaces",
        "",
        "# PXE boot architecture detection",
        "dhcp-match=set:bios,option:client-arch,0",
        "dhcp-match=set:efi32,option:client-arch,6",
        "dhcp-match=set:efi64,option:client-arch,7",
        "dhcp-match=set:efi64,option:client-arch,9",
        "",
        "dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,10.0.0.1",
        "dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,10.0.0.1",
        "dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,10.0.0.1",
        "",
    ]

    if pxe_hosts:
        # Group by config
        config_groups: dict[str, list[dict]] = {}
        for h in pxe_hosts:
            config_groups.setdefault(h["hostgroup"], []).append(h)

        lines.append("# Host config assignments")
        for h in pxe_hosts:
            tag = _TAG_RE.sub("_", h["hostgroup"])
            lines.append(f"dhcp-host={h['mac']},set:{tag}")
        lines.append("")

        lines.append("# Config name via NIS-Domain (Option 40)")
        for config_name in config_groups:
            if config_name:
                tag = _TAG_RE.sub("_", config_name)
                lines.append(f"dhcp-option=tag:{tag},40,{config_name}")
        lines.append("")

    return "\n".join(lines)


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/health", name="LINBO subsystem health check")
def linbo_health(
    who: AuthenticatedUser = Depends(RoleChecker("G")),
):
    """
    ## LINBO subsystem health check.

    Returns status of LINBO data sources (devices.csv, start.conf files,
    GRUB configs). Used by LINBO Docker to verify connectivity.

    ### Access
    - global-administrators

    \\f
    :param who: User requesting the data, read from API Token
    :type who: AuthenticatedUser
    :return: Health status with file availability
    :rtype: dict
    """
    devices_ok = DEVICES_CSV_PATH.is_file()
    linbo_ok = LINBO_DIR.is_dir()
    startconfs = len(_list_startconf_ids())
    grub_cfgs = len(_list_grub_cfg_ids())

    return {
        "status": "ok" if devices_ok and linbo_ok else "degraded",
        "devicesCSV": devices_ok,
        "linboDir": linbo_ok,
        "startConfs": startconfs,
        "grubConfigs": grub_cfgs,
    }


@router.get("/changes", name="Delta feed for LINBO sync")
def get_changes(
    since: str = "0",
    who: AuthenticatedUser = Depends(RoleChecker("G")),
):
    """
    ## Get changes since last sync (delta feed).

    Cursor-based change detection using file modification times.
    Pass `since=0` for a full snapshot of all known entities.
    Pass the `nextCursor` from a previous response for incremental updates.

    The cursor format is a unix timestamp. Changes are detected by comparing
    file mtimes of devices.csv, start.conf.*, and GRUB *.cfg files.

    ### Access
    - global-administrators

    \\f
    :param since: Cursor from previous sync (unix timestamp), or '0' for full snapshot
    :type since: str
    :param who: User requesting the data, read from API Token
    :type who: AuthenticatedUser
    :return: Delta response with changed entity lists and next cursor
    :rtype: dict
    """
    # Parse cursor
    try:
        cursor_ts = int(since) if since else 0
    except ValueError:
        cursor_ts = 0

    cursor_dt = (
        datetime.fromtimestamp(cursor_ts, tz=timezone.utc) if cursor_ts > 0
        else None
    )

    # Always parse all known entities (needed for deletion detection)
    all_hosts, _ = _parse_devices_csv()
    all_host_macs = [h["mac"] for h in all_hosts]
    all_startconf_ids = _list_startconf_ids()
    all_config_ids = _list_grub_cfg_ids()

    # Detect changes via mtimes
    devices_mtime = _get_mtime(DEVICES_CSV_PATH)
    hosts_changed_macs: list[str] = []
    deleted_hosts: list[str] = []
    dhcp_changed = False

    # Full snapshot or devices.csv changed?
    devices_modified = (
        cursor_dt is None
        or devices_mtime is None
        or (devices_mtime > cursor_dt)
    )

    if devices_modified:
        hosts_changed_macs = list(all_host_macs)
        dhcp_changed = True

    # Check start.conf files
    startconfs_changed: list[str] = []
    deleted_startconfs: list[str] = []
    for group in all_startconf_ids:
        conf_path = LINBO_DIR / f"start.conf.{group}"
        mtime = _get_mtime(conf_path)
        if cursor_dt is None or (mtime and mtime > cursor_dt):
            startconfs_changed.append(group)

    # Check GRUB configs
    configs_changed: list[str] = []
    for group in all_config_ids:
        cfg_path = GRUB_DIR / f"{group}.cfg"
        mtime = _get_mtime(cfg_path)
        if cursor_dt is None or (mtime and mtime > cursor_dt):
            configs_changed.append(group)

    # Next cursor = current time
    next_cursor = str(int(time.time()))

    return {
        "nextCursor": next_cursor,
        "hostsChanged": hosts_changed_macs,
        "startConfsChanged": startconfs_changed,
        "configsChanged": configs_changed,
        "dhcpChanged": dhcp_changed,
        "deletedHosts": deleted_hosts,
        "deletedStartConfs": deleted_startconfs,
        "allHostMacs": all_host_macs,
        "allStartConfIds": all_startconf_ids,
        "allConfigIds": all_config_ids,
    }


@router.post("/hosts:batch", name="Batch get hosts by MAC")
def batch_get_hosts(
    body: LinboBatchMacs,
    who: AuthenticatedUser = Depends(RoleChecker("G")),
):
    """
    ## Get host records for a list of MAC addresses.

    Parses devices.csv and returns matching host records.
    Used by LINBO Docker for sync mode delta updates.
    Maximum 500 MACs per request.

    ### Access
    - global-administrators

    \\f
    :param body: List of MAC addresses to look up
    :type body: LinboBatchMacs
    :param who: User requesting the data, read from API Token
    :type who: AuthenticatedUser
    :return: Dict with hosts list
    :rtype: dict
    """
    if len(body.macs) > 500:
        raise HTTPException(
            status_code=400,
            detail="Maximum 500 MACs per request"
        )

    devices, _ = _parse_devices_csv()
    if not devices:
        raise HTTPException(
            status_code=404,
            detail="devices.csv not found or empty"
        )

    macs_upper = {m.upper().replace("-", ":") for m in body.macs}
    hosts = [d for d in devices if d["mac"] in macs_upper]

    if not hosts:
        raise HTTPException(
            status_code=404,
            detail="No hosts found for given MACs"
        )

    return {"hosts": hosts}


@router.post("/startconfs:batch", name="Batch get start.conf files")
def batch_get_startconfs(
    body: LinboBatchIds,
    who: AuthenticatedUser = Depends(RoleChecker("G")),
):
    """
    ## Get start.conf file contents for a list of group IDs.

    Reads start.conf.<group> files from /srv/linbo/ and returns
    their raw content with SHA-256 hash and modification timestamp.

    ### Access
    - global-administrators

    \\f
    :param body: List of start.conf group IDs
    :type body: LinboBatchIds
    :param who: User requesting the data, read from API Token
    :type who: AuthenticatedUser
    :return: Dict with startConfs list
    :rtype: dict
    """
    if len(body.ids) > 100:
        raise HTTPException(
            status_code=400,
            detail="Maximum 100 IDs per request"
        )

    results = []
    for group_id in body.ids:
        conf_path = LINBO_DIR / f"start.conf.{group_id}"
        if not conf_path.is_file():
            continue
        try:
            content = conf_path.read_text(encoding="utf-8")
        except OSError:
            continue

        mtime = _get_mtime(conf_path)
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        results.append({
            "id": group_id,
            "content": content,
            "hash": content_hash,
            "updatedAt": mtime.isoformat() if mtime else None,
        })

    if not results:
        raise HTTPException(
            status_code=404,
            detail="No start.conf files found for given IDs"
        )

    return {"startConfs": results}


@router.post("/configs:batch", name="Batch get GRUB configs")
def batch_get_configs(
    body: LinboBatchIds,
    who: AuthenticatedUser = Depends(RoleChecker("G")),
):
    """
    ## Get GRUB configuration files for a list of group IDs.

    Reads <group>.cfg files from /srv/linbo/boot/grub/ and returns
    their raw content with modification timestamp.

    ### Access
    - global-administrators

    \\f
    :param body: List of GRUB config group IDs
    :type body: LinboBatchIds
    :param who: User requesting the data, read from API Token
    :type who: AuthenticatedUser
    :return: Dict with configs list
    :rtype: dict
    """
    if len(body.ids) > 100:
        raise HTTPException(
            status_code=400,
            detail="Maximum 100 IDs per request"
        )

    results = []
    for group_id in body.ids:
        cfg_path = GRUB_DIR / f"{group_id}.cfg"
        if not cfg_path.is_file():
            continue
        try:
            content = cfg_path.read_text(encoding="utf-8")
        except OSError:
            continue

        mtime = _get_mtime(cfg_path)

        results.append({
            "id": group_id,
            "content": content,
            "updatedAt": mtime.isoformat() if mtime else None,
        })

    if not results:
        raise HTTPException(
            status_code=404,
            detail="No GRUB configs found for given IDs"
        )

    return {"configs": results}


@router.get(
    "/dhcp/export/dnsmasq-proxy",
    name="DHCP export for dnsmasq proxy mode",
    response_class=PlainTextResponse,
)
def dhcp_export_dnsmasq(
    request: Request,
    who: AuthenticatedUser = Depends(RoleChecker("G")),
):
    """
    ## Generate dnsmasq proxy-DHCP configuration.

    Exports all PXE-enabled hosts from devices.csv as a dnsmasq
    configuration file for proxy DHCP mode. Supports ETag-based
    conditional requests (If-None-Match).

    ### Access
    - global-administrators

    \\f
    :param request: FastAPI request for ETag header access
    :type request: Request
    :param who: User requesting the data, read from API Token
    :type who: AuthenticatedUser
    :return: dnsmasq configuration as plain text
    :rtype: PlainTextResponse
    """
    devices, mtime = _parse_devices_csv()
    if not devices:
        raise HTTPException(
            status_code=404,
            detail="devices.csv not found or empty"
        )

    content = _generate_dnsmasq_proxy(devices)
    etag = hashlib.md5(content.encode()).hexdigest()

    # Conditional GET
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match.strip('"') == etag:
        return PlainTextResponse(
            content="",
            status_code=304,
            headers={"ETag": f'"{etag}"'},
        )

    return PlainTextResponse(
        content=content,
        headers={
            "ETag": f'"{etag}"',
            "Last-Modified": mtime.strftime("%a, %d %b %Y %H:%M:%S GMT")
            if mtime else "",
        },
    )
