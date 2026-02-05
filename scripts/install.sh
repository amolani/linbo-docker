#!/bin/bash
#
# LINBO Docker - Installation Script
# Fully automated deployment for fresh VMs
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/amolani/linbo-docker/main/scripts/install.sh | bash
#
# With custom settings:
#   curl -fsSL ... | LINBO_IP=10.0.0.13 ADMIN_PASS=secret bash
#
# Interactive mode:
#   ./scripts/install.sh --interactive
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration (can be overridden via environment variables)
REPO_URL="${REPO_URL:-https://github.com/amolani/linbo-docker.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/linbo-docker}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"

# Check if running interactively
is_interactive() {
    [[ -t 0 && -t 1 ]] || [[ "$1" == "--interactive" ]] || [[ "$1" == "-i" ]]
}

# Functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║   ██╗     ██╗███╗   ██╗██████╗  ██████╗                       ║"
    echo "║   ██║     ██║████╗  ██║██╔══██╗██╔═══██╗                      ║"
    echo "║   ██║     ██║██╔██╗ ██║██████╔╝██║   ██║                      ║"
    echo "║   ██║     ██║██║╚██╗██║██╔══██╗██║   ██║                      ║"
    echo "║   ███████╗██║██║ ╚████║██████╔╝╚██████╔╝                      ║"
    echo "║   ╚══════╝╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝  DOCKER              ║"
    echo "║                                                               ║"
    echo "║   Standalone LINBO Network Boot Solution                      ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run as root (sudo ./install.sh)"
        exit 1
    fi
}

detect_ip() {
    local ip=""

    # Method 1: Default route interface
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')

    # Method 2: First non-loopback interface
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi

    # Method 3: Fallback
    if [ -z "$ip" ]; then
        ip="127.0.0.1"
    fi

    echo "$ip"
}

check_dependencies() {
    log_info "Checking dependencies..."

    local missing=()

    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    if ! docker compose version &> /dev/null 2>&1; then
        missing+=("docker-compose-plugin")
    fi

    if ! command -v git &> /dev/null; then
        missing+=("git")
    fi

    if ! command -v curl &> /dev/null; then
        missing+=("curl")
    fi

    if ! command -v openssl &> /dev/null; then
        missing+=("openssl")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_warn "Missing dependencies: ${missing[*]}"
        install_dependencies "${missing[@]}"
    else
        log_success "All dependencies installed"
    fi
}

install_dependencies() {
    log_info "Installing missing dependencies..."

    if command -v apt-get &> /dev/null; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq

        for dep in "$@"; do
            case "$dep" in
                docker)
                    log_info "Installing Docker..."
                    curl -fsSL https://get.docker.com | sh
                    systemctl enable docker
                    systemctl start docker
                    ;;
                docker-compose-plugin)
                    log_info "Installing Docker Compose plugin..."
                    apt-get install -y docker-compose-plugin
                    ;;
                git)
                    apt-get install -y git
                    ;;
                curl)
                    apt-get install -y curl
                    ;;
                openssl)
                    apt-get install -y openssl
                    ;;
            esac
        done
    elif command -v yum &> /dev/null; then
        for dep in "$@"; do
            case "$dep" in
                docker)
                    log_info "Installing Docker..."
                    curl -fsSL https://get.docker.com | sh
                    systemctl enable docker
                    systemctl start docker
                    ;;
                docker-compose-plugin)
                    yum install -y docker-compose-plugin
                    ;;
                git)
                    yum install -y git
                    ;;
                curl)
                    yum install -y curl
                    ;;
                openssl)
                    yum install -y openssl
                    ;;
            esac
        done
    else
        log_error "Unsupported package manager. Please install manually: $*"
        exit 1
    fi

    log_success "Dependencies installed"
}

clone_repository() {
    log_info "Setting up LINBO Docker..."

    if [ -d "$INSTALL_DIR" ]; then
        if [ "$INTERACTIVE" = true ]; then
            log_warn "Directory $INSTALL_DIR already exists"
            read -p "Overwrite? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Using existing installation"
                return
            fi
        else
            log_warn "Directory $INSTALL_DIR exists, removing..."
        fi
        rm -rf "$INSTALL_DIR"
    fi

    git clone "$REPO_URL" "$INSTALL_DIR"
    log_success "Repository cloned to $INSTALL_DIR"
}

generate_secrets() {
    JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
    POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n' | tr -d '/' | tr -d '+')
    INTERNAL_API_KEY=$(openssl rand -hex 32)
    RSYNC_PASSWORD=$(openssl rand -base64 16 | tr -d '\n' | tr -d '/' | tr -d '+')
}

configure_environment() {
    log_info "Configuring environment..."

    cd "$INSTALL_DIR"

    # Use LINBO_IP env var or detect automatically
    SERVER_IP="${LINBO_IP:-$(detect_ip)}"

    if [ "$INTERACTIVE" = true ]; then
        echo ""
        echo -e "${YELLOW}Server Configuration${NC}"
        echo "===================="
        echo ""
        read -p "Server IP address [$SERVER_IP]: " INPUT_IP
        SERVER_IP=${INPUT_IP:-$SERVER_IP}

        read -p "Admin username [$ADMIN_USER]: " INPUT_USER
        ADMIN_USER=${INPUT_USER:-$ADMIN_USER}

        read -p "Admin password [$ADMIN_PASS]: " INPUT_PASS
        ADMIN_PASS=${INPUT_PASS:-$ADMIN_PASS}
        echo ""
    else
        log_info "Using Server IP: $SERVER_IP"
        log_info "Using Admin: $ADMIN_USER / $ADMIN_PASS"
    fi

    # Generate secrets
    generate_secrets

    # Create .env file
    cat > .env << EOF
# =============================================================================
# LINBO Docker - Environment Configuration
# Generated by install.sh on $(date)
# =============================================================================

# Server Configuration
LINBO_SERVER_IP=$SERVER_IP
NODE_ENV=production

# API Configuration
API_PORT=3000
API_HOST=0.0.0.0
CORS_ORIGIN=*

# Database (PostgreSQL)
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_USER=linbo
POSTGRES_DB=linbo
POSTGRES_HOST=linbo-db
POSTGRES_PORT=5432
DATABASE_URL=postgresql://linbo:${POSTGRES_PASSWORD}@linbo-db:5432/linbo?schema=public

# Redis
REDIS_HOST=linbo-cache
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Authentication (JWT)
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=24h
API_KEY_PREFIX=lnb_

# SSH Configuration
SSH_HOST=linbo-ssh
SSH_PORT=22
SSH_TIMEOUT=10000
SSH_USER=root
SSH_PRIVATE_KEY=/etc/linuxmuster/linbo/ssh_host_rsa_key

# RSYNC
RSYNC_PASSWORD=$RSYNC_PASSWORD

# Storage Paths
LINBO_DATA_DIR=/srv/linbo
LINBO_IMAGE_DIR=/srv/linbo/images
LINBO_CONFIG_DIR=/etc/linuxmuster/linbo
LINBO_LOG_DIR=/var/log/linuxmuster/linbo

# Logging
LOG_LEVEL=info
REQUEST_LOGGING=true

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1

# Web UI
WEB_PORT=8080

# Operation Worker
ENABLE_OPERATION_WORKER=true
OPERATION_POLL_INTERVAL=5000
MAX_CONCURRENT_SESSIONS=5

# Internal API
INTERNAL_API_KEY=$INTERNAL_API_KEY

# Feature Flags
ENABLE_TORRENT=false
ENABLE_MULTICAST=false
ENABLE_AUDIT_LOG=true

# Development
PRISMA_LOG_QUERIES=false
DEBUG_ERRORS=false
EOF

    log_success "Environment configured (Server IP: $SERVER_IP)"
}

start_containers() {
    log_info "Building and starting containers..."

    cd "$INSTALL_DIR"

    # Build images
    docker compose build --quiet 2>/dev/null || docker compose build

    # Start containers
    docker compose up -d

    log_success "Containers started"
}

wait_for_api() {
    log_info "Waiting for API to be ready..."

    local max_attempts=60
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if docker exec linbo-api curl -s http://localhost:3000/health > /dev/null 2>&1; then
            echo ""
            log_success "API is healthy"
            return 0
        fi

        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo ""
    log_error "API did not become healthy in time"
    log_info "Check logs with: docker logs linbo-api"
    return 1
}

sync_database() {
    log_info "Synchronizing database schema..."
    docker exec linbo-api npx prisma db push --accept-data-loss > /dev/null 2>&1
    log_success "Database schema synchronized"
}

create_admin_user() {
    log_info "Creating admin user '$ADMIN_USER'..."

    docker exec linbo-api node -e "
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const hash = await bcrypt.hash('$ADMIN_PASS', 10);
    await prisma.user.upsert({
      where: { username: '$ADMIN_USER' },
      update: { passwordHash: hash },
      create: {
        username: '$ADMIN_USER',
        passwordHash: hash,
        role: 'admin'
      }
    });
    console.log('Admin user created/updated');
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
" 2>/dev/null || log_warn "Could not create admin user automatically"

    log_success "Admin user '$ADMIN_USER' created"
}

fix_permissions() {
    log_info "Setting file permissions..."

    local volume_path=$(docker volume inspect linbo-docker_srv_data --format '{{.Mountpoint}}' 2>/dev/null || echo "")

    if [ -n "$volume_path" ] && [ -d "$volume_path" ]; then
        chown -R 1001:1001 "$volume_path"
        log_success "Permissions set on $volume_path"
    else
        log_warn "Could not find volume path, skipping permission fix"
    fi
}

print_summary() {
    local SERVER_IP=$(grep LINBO_SERVER_IP "$INSTALL_DIR/.env" | cut -d'=' -f2)

    echo ""
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                  Installation Complete!                       ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "${BLUE}Access URLs:${NC}"
    echo "  Web UI:     http://$SERVER_IP:8080"
    echo "  API:        http://$SERVER_IP:3000"
    echo "  API Health: http://$SERVER_IP:3000/health"
    echo ""
    echo -e "${BLUE}Login Credentials:${NC}"
    echo "  Username: $ADMIN_USER"
    echo "  Password: $ADMIN_PASS"
    echo ""
    echo -e "${BLUE}Container Status:${NC}"
    cd "$INSTALL_DIR"
    docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || docker compose ps
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo "  cd $INSTALL_DIR"
    echo "  docker compose ps              # Container status"
    echo "  docker compose logs -f api     # API logs"
    echo "  docker compose down            # Stop all"
    echo "  docker compose up -d           # Start all"
    echo ""
    echo -e "${YELLOW}PXE Boot Configuration:${NC}"
    echo "  Configure your DHCP server with:"
    echo "    next-server $SERVER_IP"
    echo "    filename \"boot/grub/i386-pc/core.0\"      # BIOS"
    echo "    filename \"boot/grub/x86_64-efi/core.efi\" # EFI"
    echo ""
}

# Main installation flow
main() {
    # Check for interactive mode
    INTERACTIVE=false
    if is_interactive "$1"; then
        INTERACTIVE=true
        log_info "Running in interactive mode"
    else
        log_info "Running in automatic mode (use --interactive for prompts)"
    fi

    print_banner
    check_root
    check_dependencies
    clone_repository
    configure_environment
    start_containers
    wait_for_api
    sync_database
    create_admin_user
    fix_permissions
    print_summary
}

# Run main function
main "$@"
