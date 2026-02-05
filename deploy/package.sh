#!/bin/bash
# =============================================================================
# LINBO Docker - Packaging Script
# Erstellt ein deployierbares Archiv
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="/tmp/linbo-docker-build"
VERSION="${VERSION:-$(date +%Y%m%d)}"
OUTPUT_FILE="${OUTPUT_FILE:-linbo-docker-${VERSION}.tar.gz}"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║           LINBO Docker - Packaging                               ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Version: $VERSION"
echo "Output:  $OUTPUT_FILE"
echo ""

# Cleanup
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/linbo-docker"

echo "[1/5] Kopiere Container-Definitionen..."
cp -r "$PROJECT_DIR/containers" "$BUILD_DIR/linbo-docker/"

echo "[2/5] Kopiere Konfiguration..."
mkdir -p "$BUILD_DIR/linbo-docker/config"
cp "$PROJECT_DIR/config/init.sql" "$BUILD_DIR/linbo-docker/config/"

# rsyncd.conf Template
cat > "$BUILD_DIR/linbo-docker/config/rsyncd.conf" << 'EOF'
pid file = /var/run/rsyncd.pid
log file = /var/log/rsync.log
transfer logging = true
use chroot = yes
read only = no

[linbo]
  path = /srv/linbo
  comment = LINBO data
  uid = root
  gid = root
  read only = no
  auth users = linbo
  secrets file = /etc/rsyncd.secrets
  hosts allow = *
  dont compress = *.qcow2 *.qdiff *.iso *.xz *.gz *.bz2 *.zip
EOF

echo "[3/5] Kopiere Deploy-Dateien..."
cp "$SCRIPT_DIR/docker-compose.yml" "$BUILD_DIR/linbo-docker/"
cp "$SCRIPT_DIR/install.sh" "$BUILD_DIR/linbo-docker/"
chmod +x "$BUILD_DIR/linbo-docker/install.sh"

# .env.example
cat > "$BUILD_DIR/linbo-docker/.env.example" << 'EOF'
# LINBO Docker Konfiguration
# Kopiere diese Datei nach .env und passe die Werte an

# Server IP (sichtbar für PXE-Clients)
LINBO_SERVER_IP=10.0.0.1

# Environment
NODE_ENV=production

# API Port
API_PORT=3000

# Database
POSTGRES_USER=linbo
POSTGRES_PASSWORD=CHANGE_ME_SECURE_PASSWORD
POSTGRES_DB=linbo

# Authentication (generiere mit: openssl rand -base64 48)
JWT_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL
JWT_EXPIRES_IN=24h

# RSYNC Password
RSYNC_PASSWORD=CHANGE_ME_RSYNC_SECRET
EOF

echo "[4/6] Kopiere Test-Dateien..."
mkdir -p "$BUILD_DIR/linbo-docker/tests"
cp "$PROJECT_DIR/tests/run-api-tests.sh" "$BUILD_DIR/linbo-docker/tests/" 2>/dev/null || true
cp "$PROJECT_DIR/tests/run-api-tests-docker.sh" "$BUILD_DIR/linbo-docker/tests/" 2>/dev/null || true
chmod +x "$BUILD_DIR/linbo-docker/tests/"*.sh 2>/dev/null || true

echo "[5/6] Erstelle README..."
cat > "$BUILD_DIR/linbo-docker/README.md" << 'EOF'
# LINBO Docker - Standalone Deployment

## Voraussetzungen

- Linux Server (Ubuntu 22.04+, Debian 12+, oder ähnlich)
- Docker (20.10+)
- Docker Compose (v2+)
- Mindestens 2GB RAM, 10GB Disk

## Schnellinstallation

```bash
# Als root ausführen
sudo ./install.sh
```

## Manuelle Installation

1. **Konfiguration anpassen:**
   ```bash
   cp .env.example .env
   nano .env
   ```

2. **RSYNC-Secrets erstellen:**
   ```bash
   echo "linbo:DEIN_PASSWORT" > config/rsyncd.secrets
   chmod 600 config/rsyncd.secrets
   ```

3. **Container bauen und starten:**
   ```bash
   docker compose build
   docker compose up -d
   ```

## Zugriff

- **API:** http://SERVER_IP:3000/api/v1
- **Health:** http://SERVER_IP:3000/health
- **TFTP:** Port 69/UDP (PXE Boot)
- **RSYNC:** Port 873 (Image Sync)
- **SSH:** Port 2222 (Remote Commands)

## Standard-Login

- **Benutzer:** admin
- **Passwort:** admin

**WICHTIG:** Ändere das Passwort nach dem ersten Login!

## Befehle

```bash
# Status anzeigen
docker compose ps

# Logs anzeigen
docker compose logs -f api

# Neustart
docker compose restart

# Stoppen
docker compose down

# Komplett entfernen (inkl. Daten)
docker compose down -v
```

## API testen

```bash
# Health Check
curl http://localhost:3000/health

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Mit Token:
TOKEN="..."
curl http://localhost:3000/api/v1/hosts \
  -H "Authorization: Bearer $TOKEN"
```

## Troubleshooting

### Container startet nicht
```bash
docker compose logs api
docker compose logs db
```

### Datenbank-Verbindung fehlgeschlagen
```bash
docker compose exec db psql -U linbo -c "SELECT 1"
```

### API nicht erreichbar
```bash
docker compose exec api curl http://localhost:3000/health
```
EOF

echo "[6/6] Erstelle Archiv..."
cd "$BUILD_DIR"
tar -czf "$PROJECT_DIR/$OUTPUT_FILE" linbo-docker/

# Cleanup
rm -rf "$BUILD_DIR"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "Paket erstellt: $PROJECT_DIR/$OUTPUT_FILE"
echo ""
echo "Größe: $(du -h "$PROJECT_DIR/$OUTPUT_FILE" | cut -f1)"
echo ""
echo "Deployment auf Test-VM:"
echo "  1. Archiv auf VM kopieren: scp $OUTPUT_FILE user@vm:/tmp/"
echo "  2. Entpacken: tar -xzf $OUTPUT_FILE"
echo "  3. Installieren: cd linbo-docker && sudo ./install.sh"
echo "════════════════════════════════════════════════════════════════════"
