#!/bin/bash
# =============================================================================
# LINBO Docker - Installation Script
# Für Test-VMs und Standalone-Deployments
# =============================================================================

set -e

# WICHTIG: SCRIPT_DIR muss VOR jedem cd berechnet werden!
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║           LINBO Docker - Installation                            ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# =============================================================================
# Prüfungen
# =============================================================================
echo -e "${YELLOW}[1/7] Prüfe Voraussetzungen...${NC}"

# Root-Check
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Fehler: Bitte als root ausführen${NC}"
    exit 1
fi

# Docker-Check
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Fehler: Docker ist nicht installiert${NC}"
    echo "Installiere Docker mit: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Docker Compose Check
if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Fehler: Docker Compose ist nicht installiert${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Alle Voraussetzungen erfüllt${NC}"

# =============================================================================
# Installationsverzeichnis
# =============================================================================
echo -e "${YELLOW}[2/7] Erstelle Verzeichnisstruktur...${NC}"

INSTALL_DIR="${INSTALL_DIR:-/opt/linbo-docker}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo -e "${GREEN}✓ Installationsverzeichnis: $INSTALL_DIR${NC}"

# =============================================================================
# Dateien kopieren
# =============================================================================
echo -e "${YELLOW}[3/7] Kopiere Dateien...${NC}"

# Kopiere alle notwendigen Dateien
if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    # Kopiere alle Dateien aus dem Quellverzeichnis
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true

    # Falls containers im selben Verzeichnis (Paket-Struktur)
    if [ -d "$SCRIPT_DIR/containers" ]; then
        cp -r "$SCRIPT_DIR/containers" "$INSTALL_DIR/"
    # Falls containers im Elternverzeichnis (Entwicklungs-Struktur)
    elif [ -d "$SCRIPT_DIR/../containers" ]; then
        cp -r "$SCRIPT_DIR/../containers" "$INSTALL_DIR/"
    fi

    # Falls config im selben Verzeichnis (Paket-Struktur)
    if [ -d "$SCRIPT_DIR/config" ]; then
        cp -r "$SCRIPT_DIR/config" "$INSTALL_DIR/"
    # Falls config im Elternverzeichnis (Entwicklungs-Struktur)
    elif [ -d "$SCRIPT_DIR/../config" ]; then
        cp -r "$SCRIPT_DIR/../config" "$INSTALL_DIR/"
    fi
fi

# Verifiziere, dass docker-compose.yml kopiert wurde
if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo -e "${RED}Fehler: docker-compose.yml konnte nicht kopiert werden${NC}"
    exit 1
fi

# Verifiziere, dass containers-Verzeichnis existiert
if [ ! -d "$INSTALL_DIR/containers" ]; then
    echo -e "${RED}Fehler: containers-Verzeichnis nicht gefunden${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Dateien kopiert${NC}"

# =============================================================================
# Umgebungsvariablen
# =============================================================================
echo -e "${YELLOW}[4/7] Konfiguriere Umgebung...${NC}"

if [ ! -f "$INSTALL_DIR/.env" ]; then
    # Server IP ermitteln
    DEFAULT_IP=$(hostname -I | awk '{print $1}')
    read -p "Server IP [$DEFAULT_IP]: " SERVER_IP
    SERVER_IP=${SERVER_IP:-$DEFAULT_IP}

    # JWT Secret generieren
    JWT_SECRET=$(openssl rand -hex 32)

    # Postgres Passwort (hex statt base64, um URL-Probleme zu vermeiden)
    POSTGRES_PASSWORD=$(openssl rand -hex 16)

    cat > "$INSTALL_DIR/.env" << EOF
# LINBO Docker Konfiguration
# Generiert am: $(date)

# Server
LINBO_SERVER_IP=$SERVER_IP
NODE_ENV=production

# API
API_PORT=3000

# Database
POSTGRES_USER=linbo
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=linbo

# Authentication
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=24h

# RSYNC (für Image-Uploads)
RSYNC_PASSWORD=$(openssl rand -hex 12)
EOF

    echo -e "${GREEN}✓ .env erstellt${NC}"
else
    echo -e "${YELLOW}✓ .env existiert bereits${NC}"
fi

# =============================================================================
# RSYNC Secrets
# =============================================================================
echo -e "${YELLOW}[5/7] Erstelle RSYNC-Konfiguration...${NC}"

mkdir -p "$INSTALL_DIR/config"

if [ ! -f "$INSTALL_DIR/config/rsyncd.secrets" ]; then
    source "$INSTALL_DIR/.env"
    echo "linbo:${RSYNC_PASSWORD:-linbo_rsync_secret}" > "$INSTALL_DIR/config/rsyncd.secrets"
    chmod 600 "$INSTALL_DIR/config/rsyncd.secrets"
fi

if [ ! -f "$INSTALL_DIR/config/rsyncd.conf" ]; then
    cat > "$INSTALL_DIR/config/rsyncd.conf" << 'EOF'
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
fi

echo -e "${GREEN}✓ RSYNC konfiguriert${NC}"

# =============================================================================
# Container bauen
# =============================================================================
echo -e "${YELLOW}[6/7] Baue Container...${NC}"

cd "$INSTALL_DIR"

# Docker Compose Befehl ermitteln
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

$COMPOSE_CMD build --no-cache

echo -e "${GREEN}✓ Container gebaut${NC}"

# =============================================================================
# Starten
# =============================================================================
echo -e "${YELLOW}[7/7] Starte Services...${NC}"

$COMPOSE_CMD up -d

# Warten auf Health Checks
echo "Warte auf Services..."
sleep 10

# Status prüfen
$COMPOSE_CMD ps

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Installation abgeschlossen!                            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
# Server IP aus .env laden falls nicht gesetzt
if [ -z "$SERVER_IP" ]; then
    SERVER_IP=$(grep LINBO_SERVER_IP "$INSTALL_DIR/.env" | cut -d= -f2)
fi
echo -e "API URL:      ${BLUE}http://$SERVER_IP:3000/api/v1${NC}"
echo -e "Health Check: ${BLUE}http://$SERVER_IP:3000/health${NC}"
echo ""
echo -e "Login:        ${YELLOW}admin / admin${NC} (Bitte ändern!)"
echo ""
echo "Befehle:"
echo "  Status:     cd $INSTALL_DIR && $COMPOSE_CMD ps"
echo "  Logs:       cd $INSTALL_DIR && $COMPOSE_CMD logs -f api"
echo "  Stoppen:    cd $INSTALL_DIR && $COMPOSE_CMD down"
echo "  Neustart:   cd $INSTALL_DIR && $COMPOSE_CMD restart"
echo ""
