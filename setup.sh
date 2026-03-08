#!/bin/bash
#
# LINBO Docker - Configuration Setup
# Validates prerequisites, detects network, generates .env
#
# Usage:
#   ./setup.sh              # Interactive mode (recommended)
#   ./setup.sh < /dev/null  # Non-interactive mode (uses defaults)
#
# This script does NOT start containers. After setup, run:
#   make up  OR  docker compose up -d
#

# Strict mode for main flow; individual checks use explicit return values
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Header and color setup
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Color-safe output: degrade gracefully in non-interactive terminals
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# Detect interactive mode
INTERACTIVE=false
[[ -t 0 ]] && INTERACTIVE=true

# ---------------------------------------------------------------------------
# 2. Helper functions
# ---------------------------------------------------------------------------
print_banner() {
    echo ""
    echo -e "${BLUE}+--------------------------------------------------+${NC}"
    echo -e "${BLUE}|          LINBO Docker - Setup Wizard              |${NC}"
    echo -e "${BLUE}|          Standalone Network Boot Solution         |${NC}"
    echo -e "${BLUE}+--------------------------------------------------+${NC}"
    echo ""
}

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }

print_check() {
    local status="$1"
    local name="$2"
    local detail="$3"

    # Pad name with dots to 30 chars for alignment
    local padded
    padded=$(printf "%-30s" "$name")
    padded="${padded// /.}"

    case "$status" in
        PASS) echo -e "  ${GREEN}[PASS]${NC} ${padded} ${detail}" ;;
        FAIL) echo -e "  ${RED}[FAIL]${NC} ${padded} ${detail}" ;;
        WARN) echo -e "  ${YELLOW}[WARN]${NC} ${padded} ${detail}" ;;
    esac
}

# ---------------------------------------------------------------------------
# 3. Prerequisite checks
# ---------------------------------------------------------------------------
PREREQ_FAILED=0

check_root() {
    if [[ "$EUID" -eq 0 ]]; then
        print_check "PASS" "Privileges" "running as root"
        return 0
    fi

    if id -nG 2>/dev/null | grep -qw docker; then
        print_check "PASS" "Privileges" "user in docker group"
        log_warn "  Not root -- ss -p process names may be unavailable"
        return 0
    fi

    print_check "FAIL" "Privileges" "not root and not in docker group"
    echo "  Fix: Run as root (sudo ./setup.sh) or add user to docker group"
    PREREQ_FAILED=$((PREREQ_FAILED + 1))
    return 0
}

check_docker() {
    if ! command -v docker &>/dev/null; then
        print_check "FAIL" "Docker" "docker not found"
        echo "  Fix: curl -fsSL https://get.docker.com | sh"
        PREREQ_FAILED=$((PREREQ_FAILED + 1))
        return 0
    fi

    local version
    version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
    if [[ -z "$version" ]]; then
        print_check "FAIL" "Docker" "Docker daemon not running"
        echo "  Fix: systemctl start docker"
        PREREQ_FAILED=$((PREREQ_FAILED + 1))
        return 0
    fi

    print_check "PASS" "Docker" "version $version"
    return 0
}

check_compose() {
    if ! docker compose version &>/dev/null 2>&1; then
        print_check "FAIL" "Docker Compose" "docker compose plugin not found"
        echo "  Fix: apt-get install docker-compose-plugin"
        PREREQ_FAILED=$((PREREQ_FAILED + 1))
        return 0
    fi

    local version
    version=$(docker compose version --short 2>/dev/null || true)
    print_check "PASS" "Docker Compose" "version ${version:-unknown}"
    return 0
}

check_disk() {
    local mount_point="/srv"
    local available

    # Try /srv first, then fall back to /
    available=$(df -P "$mount_point" 2>/dev/null | awk 'NR==2 {print $4}')
    if [[ -z "$available" ]]; then
        mount_point="/"
        available=$(df -P "$mount_point" 2>/dev/null | awk 'NR==2 {print $4}')
    fi

    if [[ -z "$available" ]]; then
        print_check "FAIL" "Disk space" "could not determine available space"
        PREREQ_FAILED=$((PREREQ_FAILED + 1))
        return 0
    fi

    local available_gb
    available_gb=$(awk "BEGIN {printf \"%.1f\", $available / 1048576}")

    if [[ "$available" -lt 2097152 ]]; then
        print_check "FAIL" "Disk space ($mount_point)" "${available_gb}GB available (need >= 2GB)"
        echo "  Fix: Free up disk space in $mount_point"
        PREREQ_FAILED=$((PREREQ_FAILED + 1))
        return 0
    fi

    print_check "PASS" "Disk space ($mount_point)" "${available_gb}GB available"
    return 0
}

check_dns() {
    local host="deb.linuxmuster.net"

    if command -v nslookup &>/dev/null && nslookup "$host" &>/dev/null; then
        print_check "PASS" "DNS resolution" "$host resolves"
        return 0
    fi

    if command -v host &>/dev/null && host "$host" &>/dev/null; then
        print_check "PASS" "DNS resolution" "$host resolves"
        return 0
    fi

    if getent hosts "$host" &>/dev/null; then
        print_check "PASS" "DNS resolution" "$host resolves"
        return 0
    fi

    print_check "FAIL" "DNS resolution" "cannot resolve $host"
    echo "  Fix: Check /etc/resolv.conf or set DNS server"
    PREREQ_FAILED=$((PREREQ_FAILED + 1))
    return 0
}

check_network() {
    if curl -sf --max-time 10 https://deb.linuxmuster.net/dists/lmn73/Release -o /dev/null 2>/dev/null; then
        print_check "PASS" "Network connectivity" "deb.linuxmuster.net reachable"
        return 0
    fi

    print_check "FAIL" "Network connectivity" "cannot reach deb.linuxmuster.net"
    echo "  Fix: Check internet connectivity or firewall/proxy settings"
    PREREQ_FAILED=$((PREREQ_FAILED + 1))
    return 0
}

check_openssl() {
    if command -v openssl &>/dev/null; then
        print_check "PASS" "OpenSSL" "$(openssl version 2>/dev/null | awk '{print $1, $2}')"
        return 0
    fi

    print_check "FAIL" "OpenSSL" "openssl not found"
    echo "  Fix: apt-get install openssl"
    echo "  Note: Secrets can use /dev/urandom as fallback, but openssl is preferred"
    PREREQ_FAILED=$((PREREQ_FAILED + 1))
    return 0
}

run_prerequisites() {
    echo "Checking prerequisites..."
    echo ""

    check_root
    check_docker
    check_compose
    check_disk
    check_dns
    check_network
    check_openssl

    echo ""

    if [[ "$PREREQ_FAILED" -gt 0 ]]; then
        log_error "$PREREQ_FAILED prerequisite check(s) failed. Fix the issues above and re-run ./setup.sh"
        exit 1
    fi

    log_info "All prerequisites passed"
}

# ---------------------------------------------------------------------------
# 4. Port conflict detection
# ---------------------------------------------------------------------------
PORT_WARNINGS=0

check_port_conflict() {
    local port="$1"
    local proto="$2"
    local service="$3"

    local flag
    case "$proto" in
        tcp) flag="-tlnp" ;;
        udp) flag="-ulnp" ;;
        *)   flag="-tlnp" ;;
    esac

    local ss_output
    ss_output=$(ss "$flag" sport = :"$port" 2>/dev/null || true)

    if echo "$ss_output" | grep -q ":${port}"; then
        local process
        process=$(echo "$ss_output" | grep ":${port}" | grep -oP 'users:\(\("\K[^"]+' | head -1)
        process=${process:-"unknown"}

        print_check "WARN" "$service port $port/$proto" "in use by '$process'"

        if [[ "$process" == "docker-proxy" ]]; then
            echo "    Another Docker container is using port $port."
            echo "    Run: docker ps --filter publish=$port"
        elif [[ "$service" == "TFTP" ]]; then
            echo "    TFTP uses host networking and CANNOT be remapped."
            echo "    Stop the conflicting service: systemctl stop $process && systemctl disable $process"
        else
            echo "    Stop the conflicting service: systemctl stop $process"
        fi

        PORT_WARNINGS=$((PORT_WARNINGS + 1))
        return 0
    fi

    print_check "PASS" "$service port $port/$proto" "available"
    return 0
}

check_ports() {
    echo ""
    echo "Checking port availability..."
    echo ""

    check_port_conflict 69 udp "TFTP"
    check_port_conflict 873 tcp "rsync"

    echo ""

    if [[ "$PORT_WARNINGS" -gt 0 ]]; then
        log_warn "$PORT_WARNINGS port conflict(s) detected. Resolve before running 'make up'"
    else
        log_info "All required ports available"
    fi
}

# ---------------------------------------------------------------------------
# 5. IP auto-detection
# ---------------------------------------------------------------------------
detect_server_ip() {
    local ip=""

    # Method 1: IP on default route interface (safer awk pattern)
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')

    # Method 2: First non-loopback IPv4
    if [[ -z "$ip" ]]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi

    # Method 3: Fallback
    echo "${ip:-127.0.0.1}"
}

detect_ip_interactive() {
    local detected_ip
    detected_ip=$(detect_server_ip)

    echo ""
    echo "Network interfaces:"
    # List all IPv4 addresses with interface names
    while IFS= read -r line; do
        local iface addr
        iface=$(echo "$line" | awk '{print $NF}')
        addr=$(echo "$line" | awk '{print $2}' | cut -d/ -f1)
        if [[ "$addr" != "127.0.0.1" ]]; then
            if [[ "$addr" == "$detected_ip" ]]; then
                echo -e "  ${GREEN}*${NC} $addr ($iface) -- default route"
            else
                echo "    $addr ($iface)"
            fi
        fi
    done < <(ip -4 addr show 2>/dev/null | grep 'inet ' || true)

    echo ""
    echo "Detected server IP: $detected_ip"

    if [[ "$INTERACTIVE" == "true" ]]; then
        local confirm
        read -p "Use this IP for LINBO_SERVER_IP? [Y/n]: " confirm
        if [[ "$confirm" =~ ^[Nn] ]]; then
            local custom_ip
            read -p "Enter server IP: " custom_ip
            # Validate IP format
            if [[ "$custom_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                detected_ip="$custom_ip"
            else
                log_error "Invalid IP format: $custom_ip"
                exit 1
            fi
        fi
    else
        log_info "Non-interactive mode: using detected IP $detected_ip"
    fi

    LINBO_SERVER_IP="$detected_ip"
}

# ---------------------------------------------------------------------------
# 6. Secret generation
# ---------------------------------------------------------------------------
generate_secret() {
    local type="$1"

    if command -v openssl &>/dev/null; then
        case "$type" in
            jwt)      openssl rand -base64 48 | tr -d '\n' ;;
            api_key)  openssl rand -hex 32 ;;
            password) openssl rand -base64 24 | tr -d '\n/+=' | head -c 32 ;;
        esac
    else
        # Fallback: /dev/urandom (defense in depth -- openssl checked in prereqs)
        case "$type" in
            jwt)      head -c 48 /dev/urandom | base64 | tr -d '\n' ;;
            api_key)  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' ;;
            password) head -c 24 /dev/urandom | base64 | tr -d '\n/+=' | head -c 32 ;;
        esac
    fi
}

generate_all_secrets() {
    log_info "Generating cryptographic secrets..."
    JWT_SECRET=$(generate_secret jwt)
    INTERNAL_API_KEY=$(generate_secret api_key)
    DB_PASSWORD=$(generate_secret password)
    RSYNC_PASSWORD=$(generate_secret password)
}

# ---------------------------------------------------------------------------
# 7. GITHUB_TOKEN prompt
# ---------------------------------------------------------------------------
prompt_github_token() {
    echo ""
    echo "The web UI container requires a GitHub token for npm package access."
    echo "Create one at: https://github.com/settings/tokens"
    echo "Required scope: read:packages"
    echo ""

    if [[ "$INTERACTIVE" == "true" ]]; then
        local token
        read -p "GitHub token (leave empty to skip): " token
        GITHUB_TOKEN="${token:-}"
    else
        GITHUB_TOKEN=""
    fi

    if [[ -z "$GITHUB_TOKEN" ]]; then
        log_warn "No GitHub token set. Web container build will fail (tracked as OSS-01)."
        log_warn "You can add GITHUB_TOKEN to .env later."
    fi
}

# ---------------------------------------------------------------------------
# 8. Existing .env detection
# ---------------------------------------------------------------------------
handle_existing_env() {
    local env_file="${SCRIPT_DIR}/.env"

    if [[ -f "$env_file" ]]; then
        local modified
        modified=$(stat -c '%y' "$env_file" 2>/dev/null | cut -d. -f1 || echo "unknown")

        echo ""
        log_warn "Existing .env found (last modified: $modified)"

        if [[ "$INTERACTIVE" == "true" ]]; then
            local confirm
            read -p "Back up and overwrite? [Y/n]: " confirm
            if [[ "$confirm" =~ ^[Nn] ]]; then
                log_info "Keeping existing .env. Exiting."
                exit 0
            fi
        fi

        local backup="${env_file}.backup.$(date +%Y%m%d-%H%M%S)"
        cp "$env_file" "$backup"
        log_info "Backed up to $backup"
    fi
}

# ---------------------------------------------------------------------------
# 9. .env file write
# ---------------------------------------------------------------------------
write_env() {
    local env_file="${SCRIPT_DIR}/.env"
    local tmp_file="${env_file}.tmp"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Write using explicit variable substitution
    # The heredoc is NOT quoted so variables expand, but all values are
    # pre-validated (no special chars that could cause issues)
    cat > "$tmp_file" << ENVEOF
# LINBO Docker - Environment Configuration
# Generated by: ./setup.sh on $timestamp
# Re-run ./setup.sh to regenerate

# === Server ===
LINBO_SERVER_IP=$LINBO_SERVER_IP
NODE_ENV=production

# === Secrets (auto-generated -- do not share) ===
JWT_SECRET=$JWT_SECRET
INTERNAL_API_KEY=$INTERNAL_API_KEY
DB_PASSWORD=$DB_PASSWORD
RSYNC_PASSWORD=$RSYNC_PASSWORD

# === Web UI ===
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Muster!
GITHUB_TOKEN=$GITHUB_TOKEN

# === Network (uncomment to override defaults) ===
# LINBO_SUBNET=10.0.0.0
# LINBO_NETMASK=255.255.0.0
# LINBO_GATEWAY=10.0.0.254
# LINBO_DNS=10.0.0.1
# LINBO_DOMAIN=linuxmuster.lan

# === Optional (uncomment to override defaults) ===
# WEB_PORT=8080
# API_PORT=3000
# LOG_LEVEL=info
ENVEOF

    mv "$tmp_file" "$env_file"
    chmod 600 "$env_file"

    log_info "Written: $env_file (mode 600)"
}

# ---------------------------------------------------------------------------
# 10. rsyncd.secrets sync
# ---------------------------------------------------------------------------
write_rsyncd_secrets() {
    local secrets_file="${SCRIPT_DIR}/config/rsyncd.secrets"

    # Ensure config directory exists
    mkdir -p "${SCRIPT_DIR}/config"

    echo "linbo:${RSYNC_PASSWORD}" > "$secrets_file"
    chmod 600 "$secrets_file"

    log_info "Written: config/rsyncd.secrets (matching RSYNC_PASSWORD, mode 600)"
}

# ---------------------------------------------------------------------------
# 11. Validation and summary
# ---------------------------------------------------------------------------
validate_and_summarize() {
    echo ""
    echo "Validating configuration..."
    echo ""

    # Validate with docker compose
    if (cd "$SCRIPT_DIR" && docker compose config --quiet 2>/dev/null); then
        print_check "PASS" "docker compose config" "valid"
    else
        print_check "FAIL" "docker compose config" "validation failed"
        log_error "Generated .env has errors. Check docker-compose.yml compatibility."
        exit 1
    fi

    echo ""
    echo -e "${GREEN}+--------------------------------------------------+${NC}"
    echo -e "${GREEN}|              Setup Complete                       |${NC}"
    echo -e "${GREEN}+--------------------------------------------------+${NC}"
    echo ""
    echo "  Configuration:  ${SCRIPT_DIR}/.env"
    echo "  Server IP:      ${LINBO_SERVER_IP}"
    echo "  Admin user:     admin"
    echo "  Admin password: Muster!"
    echo "  Secrets:        auto-generated (unique, random)"
    echo ""
    echo "  Next steps:"
    echo "    make up               # Start all containers"
    echo "    docker compose up -d  # Alternative"
    echo ""

    if [[ "$PORT_WARNINGS" -gt 0 ]]; then
        log_warn "Resolve $PORT_WARNINGS port conflict(s) before starting containers!"
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# 12. main() -- orchestrate all steps
# ---------------------------------------------------------------------------
main() {
    print_banner
    run_prerequisites
    check_ports
    detect_ip_interactive
    generate_all_secrets
    prompt_github_token
    handle_existing_env
    write_env
    write_rsyncd_secrets
    validate_and_summarize
}

main "$@"
