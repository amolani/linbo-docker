"""Image manifest and download endpoints for LINBO image sync."""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/linbo/images", tags=["images"])

IMAGES_DIR = Path("/srv/linbo/images")

# In-memory cache (60s TTL)
_manifest_cache: dict | None = None
_manifest_cache_time: float = 0.0
_CACHE_TTL = 60.0

_SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_.]+$")


def _parse_info(info_path: Path) -> dict:
    """Parse a LINBO .info file into a dict.

    Format:
        ["image.qcow2" Info File]
        timestamp="202511101136"
        image="image.qcow2"
        imagesize="4332732928"
    """
    result = {}
    try:
        for line in info_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if "=" not in line or line.startswith("["):
                continue
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip().strip('"')
    except Exception:
        pass
    return result


def _read_md5(md5_path: Path) -> str | None:
    """Read an MD5 sidecar. Handles both 'hash' and 'hash  filename' formats."""
    try:
        content = md5_path.read_text(encoding="utf-8").strip()
        if content:
            return content.split()[0]
    except Exception:
        pass
    return None


def _scan_images() -> list[dict]:
    """Scan IMAGES_DIR for image subdirectories and build manifest."""
    if not IMAGES_DIR.is_dir():
        return []

    images = []
    for entry in sorted(IMAGES_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        # List files (skip subdirectories like backups/)
        files = []
        total_size = 0
        qcow2_file = None
        for f in sorted(entry.iterdir()):
            if not f.is_file():
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            files.append({"name": f.name, "size": st.st_size})
            total_size += st.st_size
            if f.suffix == ".qcow2":
                qcow2_file = f.name

        if not qcow2_file:
            continue  # Skip directories without a qcow2

        # Parse .info
        info_path = entry / f"{qcow2_file}.info"
        info = _parse_info(info_path) if info_path.exists() else {}

        # Read .md5 checksum
        md5_path = entry / f"{qcow2_file}.md5"
        checksum = _read_md5(md5_path)

        images.append({
            "name": entry.name,
            "filename": qcow2_file,
            "totalSize": total_size,
            "files": files,
            "timestamp": info.get("timestamp"),
            "imagesize": info.get("imagesize"),
            "checksum": checksum,
        })

    return images


def _get_manifest() -> list[dict]:
    """Get image manifest with 60s cache."""
    global _manifest_cache, _manifest_cache_time
    now = time.monotonic()
    if _manifest_cache is not None and (now - _manifest_cache_time) < _CACHE_TTL:
        return _manifest_cache
    _manifest_cache = _scan_images()
    _manifest_cache_time = now
    return _manifest_cache


@router.get("/manifest")
async def get_manifest():
    """Return manifest of all available images with sizes and checksums."""
    images = _get_manifest()
    return {"images": images}


def _validate_path(name: str, filename: str) -> Path | None:
    """Validate and resolve a safe file path. Returns None if invalid."""
    if not _SAFE_NAME_RE.match(name) or not _SAFE_FILENAME_RE.match(filename):
        return None
    resolved = (IMAGES_DIR / name / filename).resolve()
    # Ensure the resolved path is under IMAGES_DIR
    if not str(resolved).startswith(str(IMAGES_DIR.resolve())):
        return None
    if not resolved.is_file():
        return None
    return resolved


@router.api_route("/download/{name}/{filename}", methods=["GET", "HEAD"])
async def download_image_file(name: str, filename: str, request: Request):
    """Download an image file with Range support (via FileResponse).

    FileResponse automatically handles:
    - Range header → 206 Partial Content
    - ETag and Last-Modified headers
    - Accept-Ranges: bytes header

    HEAD is supported for pre-flight size/etag checks.
    """
    safe = _validate_path(name, filename)
    if safe is None:
        return JSONResponse(
            status_code=404,
            content={"error": "NOT_FOUND", "message": f"File not found: {name}/{filename}"},
        )
    stat = os.stat(safe)
    return FileResponse(
        path=str(safe),
        filename=filename,
        stat_result=stat,
        media_type="application/octet-stream",
    )
