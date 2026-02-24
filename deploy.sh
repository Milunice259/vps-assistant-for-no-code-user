#!/bin/bash

################################################################################
# VPS Control App - Automated Deployment Script
# This script automates the complete deployment process on a fresh VPS.
# It installs all dependencies, configures Traefik, and deploys the app.
################################################################################

set -e  # Exit on any error

# --- Colors for Output ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- Configuration ---
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAEFIK_DIR="/opt/traefik"
COMPOSE_CMD=""   # Will be set by detect_compose_command()
MIN_RAM_MB=800   # Minimum ~1GB RAM (allowing for OS usage)
MIN_DISK_GB=5    # Minimum 5GB disk
GIT_CREDENTIAL_FILE="$APP_DIR/.git-credentials"
REPO_NAME="Milunice259/vps-assistant-for-no-code-user"

# ═══════════════════════════════════════════════════
#  Git Credential Management & Auto-Update
# ═══════════════════════════════════════════════════

# Auto-update deploy.sh if remote has a newer version
auto_update_script() {
    cd "$APP_DIR" || return 1

    # Only if this is a git repo with remote refs
    [ -d .git ] || return 0
    git rev-parse --verify origin/main >/dev/null 2>&1 || return 0

    LOCAL_HASH=$(git rev-parse HEAD:deploy.sh 2>/dev/null || echo "")
    REMOTE_HASH=$(git rev-parse origin/main:deploy.sh 2>/dev/null || echo "")

    if [ -n "$LOCAL_HASH" ] && [ -n "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
        if git diff --quiet HEAD -- deploy.sh 2>/dev/null; then
            echo -e "${BLUE}  ℹ Auto-updating deploy.sh to latest version...${NC}"
            git checkout origin/main -- deploy.sh >/dev/null 2>&1
            chmod +x "$APP_DIR/deploy.sh" 2>/dev/null || true
            echo -e "${GREEN}  ✓ deploy.sh updated. Restarting...${NC}"
            exec bash "$APP_DIR/deploy.sh" "$@"
        fi
    fi
}

# Setup git credential store for this repo only
setup_git_credential_helper() {
    [ -f "$APP_DIR/.git/config" ] || return 0
    if ! git -C "$APP_DIR" config --local credential.helper >/dev/null 2>&1; then
        git -C "$APP_DIR" config --local credential.helper "store --file=$GIT_CREDENTIAL_FILE"
    fi
}

# Test if stored credentials still work
check_git_credentials() {
    [ -f "$GIT_CREDENTIAL_FILE" ] || return 1
    timeout 10 git -C "$APP_DIR" ls-remote --heads origin main >/dev/null 2>&1
}

# Show PAT creation guide
show_pat_instructions() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}   How to create a GitHub Personal Access Token (PAT)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "  GitHub does NOT support password auth. You need a PAT."
    echo ""
    echo "  1. Visit: https://github.com/settings/tokens"
    echo "  2. Click 'Generate new token' → 'Classic'"
    echo "  3. Name it (e.g. 'VPS Deploy'), select scope: 'repo'"
    echo "  4. Set expiration (90 days recommended)"
    echo "  5. Click 'Generate token' and COPY it immediately"
    echo ""
    echo -e "  Token will be saved in: ${YELLOW}$GIT_CREDENTIAL_FILE${NC}"
    echo -e "  File permissions: ${YELLOW}600${NC} (owner only)"
    echo ""
}

# Prompt user for GitHub username + PAT, save credentials
get_git_credentials() {
    show_pat_instructions

    echo -e -n "${YELLOW}  GitHub username: ${NC}"
    read GIT_USERNAME
    [ -z "$GIT_USERNAME" ] && { echo -e "${RED}  ✗ Username cannot be empty.${NC}"; return 1; }

    echo -e -n "${YELLOW}  Personal Access Token (hidden): ${NC}"
    read -s GIT_PAT
    echo ""
    [ -z "$GIT_PAT" ] && { echo -e "${RED}  ✗ PAT cannot be empty.${NC}"; return 1; }

    # Save credentials
    echo "https://${GIT_USERNAME}:${GIT_PAT}@github.com" > "$GIT_CREDENTIAL_FILE"
    chmod 600 "$GIT_CREDENTIAL_FILE"

    # Update remote URL to include credentials
    git -C "$APP_DIR" remote set-url origin \
        "https://${GIT_USERNAME}:${GIT_PAT}@github.com/${REPO_NAME}.git" 2>/dev/null || true

    echo -e "${GREEN}  ✓ Credentials saved.${NC}"
}

# Ensure valid credentials exist, prompt if not
ensure_git_credentials() {
    setup_git_credential_helper

    if check_git_credentials; then
        echo -e "${GREEN}  ✓ Stored Git credentials are valid.${NC}"
        return 0
    fi

    if [ -f "$GIT_CREDENTIAL_FILE" ]; then
        echo -e "${YELLOW}  ⚠ Stored credentials expired or invalid. Re-entering...${NC}"
        rm -f "$GIT_CREDENTIAL_FILE"
    else
        echo -e "${BLUE}  ℹ No stored Git credentials found.${NC}"
    fi

    get_git_credentials || return 1

    if check_git_credentials; then
        echo -e "${GREEN}  ✓ Credentials validated.${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Credentials invalid. Check your PAT and try again.${NC}"
        rm -f "$GIT_CREDENTIAL_FILE"
        return 1
    fi
}

# Check for code updates from remote
check_for_updates() {
    print_header "Checking for Updates"

    cd "$APP_DIR"

    # Not a git repo?
    if [ ! -d .git ]; then
        print_warning "Not a git repository. Skipping update check."
        return 0
    fi

    # Ensure credentials
    if ! ensure_git_credentials; then
        print_warning "Git credentials not available. Skipping update."
        return 0
    fi

    # Fetch latest
    print_info "Fetching latest changes..."
    if ! git fetch origin 2>/dev/null; then
        print_warning "Failed to fetch. Credentials may have expired."
        rm -f "$GIT_CREDENTIAL_FILE"
        print_info "Run deploy.sh again to enter new credentials."
        return 0
    fi

    # Auto-update deploy.sh first
    auto_update_script "$@"

    # Check upstream
    UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")
    if [ -z "$UPSTREAM" ]; then
        print_info "No upstream branch. Setting origin/main..."
        git branch --set-upstream-to=origin/main main 2>/dev/null || true
    fi

    LOCAL=$(git rev-parse @ 2>/dev/null || echo "")
    REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")

    if [ "$LOCAL" = "$REMOTE" ]; then
        print_success "Already up to date."
        return 0
    fi

    print_info "Updates available. Resetting to remote version..."

    # On a deploy server, always match remote exactly
    git reset --hard origin/main 2>/dev/null
    chmod +x "$APP_DIR/deploy.sh" 2>/dev/null || true

    # NOTE: If deploy.sh itself was updated, auto_update_script() (line 168)
    # already handled the restart via exec. No need to restart here for
    # non-deploy-script changes — just continue with the current flow.
    print_success "Code updated to latest version."
}

# --- Helper Functions ---

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}  ✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}  ⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}  ✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}  ℹ $1${NC}"
}

# Read input with default value
read_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local is_password="$4"

    if [ -n "$default" ]; then
        display_prompt="$prompt (Default: $default)"
    else
        display_prompt="$prompt"
    fi

    echo -e -n "${YELLOW}  $display_prompt: ${NC}"

    if [ "$is_password" == "true" ]; then
        read -s input
        echo "" # New line after silent input
    else
        read input
    fi

    if [ -z "$input" ]; then
        input="$default"
    fi

    eval $var_name="\"$input\""
}

# ─── [1/8] Check Root ───
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root or with sudo"
        exit 1
    fi
}

# ─── [2/8] Check System Requirements ───
check_system_requirements() {
    print_header "[1/8] Checking System Requirements"

    # Check OS
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        print_info "Operating System: $NAME $VERSION"

        if [[ ! "$ID" =~ ^(ubuntu|debian)$ ]]; then
            print_warning "This script is optimized for Ubuntu/Debian. Proceed with caution."
        fi
    else
        print_warning "Cannot detect OS. Proceeding anyway..."
    fi

    # Check RAM
    total_ram=$(free -m | awk 'NR==2 {print $2}')
    if [ "$total_ram" -lt "$MIN_RAM_MB" ]; then
        print_warning "RAM: ${total_ram}MB (Recommended: 1GB+)"
        print_warning "Application may run slowly with limited RAM"
    else
        print_success "RAM: ${total_ram}MB"
    fi

    # Check Disk Space
    available_disk=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$available_disk" -lt "$MIN_DISK_GB" ]; then
        print_error "Insufficient disk space: ${available_disk}GB (Minimum: ${MIN_DISK_GB}GB)"
        exit 1
    else
        print_success "Disk Space: ${available_disk}GB available"
    fi

    # Check CPU
    cpu_cores=$(nproc)
    print_info "CPU Cores: $cpu_cores"

    # Check Internet connectivity
    if ping -c 1 google.com &> /dev/null; then
        print_success "Internet connectivity verified"
    else
        print_error "No internet connection detected"
        exit 1
    fi
}

# ─── [3/8] Install System Dependencies ───
install_dependencies() {
    print_header "[2/8] Installing System Dependencies"

    print_info "Updating package list..."
    apt-get update -qq

    print_info "Installing basic tools..."
    apt-get install -y -qq curl git wget ufw openssl > /dev/null 2>&1
    print_success "Basic tools installed (curl, git, wget, ufw, openssl)"
}

# ─── [4/8] Install Docker ───
install_docker() {
    if command -v docker &> /dev/null; then
        print_success "Docker already installed ($(docker --version | head -1))"
    else
        print_header "[3/8] Installing Docker"

        print_info "Downloading Docker installation script..."
        curl -fsSL https://get.docker.com -o get-docker.sh

        print_info "Installing Docker (this may take a minute)..."
        sh get-docker.sh > /dev/null 2>&1
        rm -f get-docker.sh

        # Start and enable Docker
        systemctl start docker
        systemctl enable docker > /dev/null 2>&1

        if [ -n "$SUDO_USER" ]; then
            usermod -aG docker "$SUDO_USER"
            print_info "Added $SUDO_USER to docker group"
        fi

        print_success "Docker installed successfully ($(docker --version | head -1))"
    fi
}

install_docker_compose() {
    # Already have a working compose command? Skip.
    if docker compose version &> /dev/null 2>&1 || command -v docker-compose &> /dev/null; then
        detect_compose_command
        return
    fi

    print_header "[3/8] Installing Docker Compose"

    print_info "Installing Docker Compose..."
    mkdir -p /usr/local/lib/docker/cli-plugins

    # Install as Docker CLI plugin (docker compose)
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    # Also install as standalone binary (docker-compose) for compatibility
    cp /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose

    print_success "Docker Compose installed successfully"
    detect_compose_command
}

# Detect which compose command is available and store it in COMPOSE_CMD.
# Prefers "docker compose" (V2 plugin) but falls back to "docker-compose" (standalone).
detect_compose_command() {
    if docker compose version &> /dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        print_error "No docker compose command found. Cannot continue."
        exit 1
    fi
    print_success "Using compose command: $COMPOSE_CMD"
}

# ─── [5/8] Configure Firewall ───
configure_firewall() {
    print_header "[4/8] Configuring Firewall"

    if ! ufw status | grep -q "Status: active"; then
        print_info "Configuring UFW firewall..."

        ufw allow 22/tcp > /dev/null 2>&1
        print_success "Allowed SSH (port 22)"

        ufw allow 80/tcp > /dev/null 2>&1
        ufw allow 443/tcp > /dev/null 2>&1
        print_success "Allowed HTTP (80) and HTTPS (443)"

        echo "y" | ufw enable > /dev/null 2>&1
        print_success "Firewall configured and enabled"
    else
        print_success "Firewall already configured"
    fi
}

# ─── [6/8] Setup Traefik Reverse Proxy ───
setup_traefik() {
    print_header "[5/8] Setting Up Traefik Reverse Proxy"

    # 1. List bridge networks and let user choose
    print_info "Available Docker networks (bridge):"
    NETWORK_LIST=()
    while IFS= read -r line; do
        [ -n "$line" ] && NETWORK_LIST+=("$line")
    done < <(docker network ls --format '{{.Name}}' --filter driver=bridge 2>/dev/null || true)

    if [ "${#NETWORK_LIST[@]}" -gt 1 ]; then
        echo ""
        for i in "${!NETWORK_LIST[@]}"; do
            echo -e "  ${CYAN}  $((i+1)))${NC} ${NETWORK_LIST[$i]}"
        done
        echo ""
        echo -e -n "${YELLOW}  Enter number (1-${#NETWORK_LIST[@]}) or network name (Default: 1): ${NC}"
        read choice
        choice="${choice:-1}"
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "${#NETWORK_LIST[@]}" ] 2>/dev/null; then
            TRAEFIK_NETWORK="${NETWORK_LIST[$((choice-1))]}"
        else
            TRAEFIK_NETWORK="${choice}"
        fi
        echo ""
    elif [ "${#NETWORK_LIST[@]}" -eq 1 ]; then
        TRAEFIK_NETWORK="${NETWORK_LIST[0]}"
        print_info "Using only available network: $TRAEFIK_NETWORK"
    else
        echo -e "  ${YELLOW}(No bridge networks found)${NC}"
        echo ""
        read_input "Enter Traefik network name" "traefik" "TRAEFIK_NETWORK" "false"
    fi

    # 2. Check if network exists and Traefik is running
    if docker network inspect "$TRAEFIK_NETWORK" &> /dev/null; then
        print_success "Network '$TRAEFIK_NETWORK' found"

        if docker ps --format '{{.Names}}' | grep -q '^traefik$'; then
            print_success "Traefik container is running"

            if docker container inspect traefik 2>/dev/null | grep -q "$TRAEFIK_NETWORK"; then
                print_success "Traefik is connected to '$TRAEFIK_NETWORK'"
                TRAEFIK_EXISTS=true
                return
            else
                print_warning "Traefik is running but NOT on '$TRAEFIK_NETWORK'"
                print_info "Connecting Traefik to '$TRAEFIK_NETWORK'..."
                docker network connect "$TRAEFIK_NETWORK" traefik 2>/dev/null || true
                TRAEFIK_EXISTS=true
                return
            fi
        else
            print_warning "Network exists but Traefik is NOT running"
            if [ -d "$TRAEFIK_DIR" ]; then
                print_info "Found Traefik directory at $TRAEFIK_DIR. Attempting to start..."
                cd "$TRAEFIK_DIR"
                if $COMPOSE_CMD up -d &> /dev/null; then
                    print_success "Existing Traefik started"
                    TRAEFIK_EXISTS=true
                    cd "$APP_DIR"
                    return
                fi
            fi
            print_warning "Could not start existing Traefik. Will install new one."
        fi
    else
        print_info "Network '$TRAEFIK_NETWORK' does not exist"
    fi

    # 3. Setup new Traefik
    print_info "Setting up new Traefik instance on network '$TRAEFIK_NETWORK'..."

    if [ -d "$TRAEFIK_DIR" ] && [ -z "$TRAEFIK_EXISTS" ]; then
        print_warning "Traefik directory exists at $TRAEFIK_DIR"
        read_input "Remove and reinstall Traefik? (y/N)" "N" "REINSTALL" "false"

        if [[ "$REINSTALL" =~ ^[Yy]$ ]]; then
            print_info "Removing existing Traefik setup..."
            cd "$TRAEFIK_DIR"
            $COMPOSE_CMD down &> /dev/null || true
            cd /
            rm -rf "$TRAEFIK_DIR"
        fi
    fi

    mkdir -p "$TRAEFIK_DIR"
    cd "$TRAEFIK_DIR"

    read_input "Email for SSL certificates" "" "TRAEFIK_EMAIL" "false"
    while [ -z "$TRAEFIK_EMAIL" ]; do
        print_error "Email is required for Let's Encrypt SSL!"
        read_input "Email for SSL certificates" "" "TRAEFIK_EMAIL" "false"
    done

    # Create Traefik config
    print_info "Creating Traefik configuration..."

    cat > traefik.yml <<EOF
api:
  dashboard: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: $TRAEFIK_NETWORK

certificatesResolvers:
  letsencrypt:
    acme:
      email: $TRAEFIK_EMAIL
      storage: /acme.json
      httpChallenge:
        entryPoint: web
EOF

    cat > docker-compose.yml <<EOF
services:
  traefik:
    image: traefik:v2.11
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    networks:
      - web
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/traefik.yml:ro
      - ./acme.json:/acme.json

networks:
  web:
    name: $TRAEFIK_NETWORK
    driver: bridge
EOF

    touch acme.json
    chmod 600 acme.json

    print_info "Starting Traefik..."
    $COMPOSE_CMD up -d

    print_success "Traefik configured and started on network '$TRAEFIK_NETWORK'"
    TRAEFIK_EXISTS=true

    cd "$APP_DIR"
}

# ─── [7/8] Configure Application ───
configure_application() {
    print_header "[6/8] Configuring VPS Control App"

    cd "$APP_DIR"
    DETECTED_CERT_RESOLVER=$(docker inspect traefik --format '{{range .Config.Cmd}}{{println .}}{{end}}' 2>/dev/null \
        | sed -n 's/^--certificatesresolvers\.\([^.]*\)\.acme\..*$/\1/p' | head -n1)

    # Helper: read KEY=value from .env safely (strip optional quotes)
    get_env_value() {
        local key="$1"
        local raw
        raw=$(grep -E "^${key}=" .env 2>/dev/null | tail -n1 | cut -d'=' -f2-)
        raw="${raw%\"}"
        raw="${raw#\"}"
        echo "$raw"
    }

    # Check if .env already exists
    if [ -f .env ]; then
        print_warning ".env file already exists"
        read_input "Reconfigure? (y/N)" "N" "RECONFIG" "false"

        if [[ ! "$RECONFIG" =~ ^[Yy]$ ]]; then
            # Load existing values so summary/checks don't become empty
            DOMAIN="$(get_env_value DOMAIN)"
            ADMIN_USERNAME="$(get_env_value ADMIN_USERNAME)"
            CERT_RESOLVER="$(get_env_value CERT_RESOLVER)"
            EXISTING_TRAEFIK_NETWORK="$(get_env_value TRAEFIK_NETWORK)"
            EXISTING_CERT_RESOLVER="$CERT_RESOLVER"
            if [ -n "$EXISTING_TRAEFIK_NETWORK" ]; then
                TRAEFIK_NETWORK="$EXISTING_TRAEFIK_NETWORK"
            fi

            # DOMAIN and CERT_RESOLVER are mandatory for Traefik host routing + TLS.
            if [ -z "$DOMAIN" ]; then
                print_warning "Existing .env is missing DOMAIN."
                print_info "Starting reconfiguration to fix routing..."
            elif [ -z "$CERT_RESOLVER" ]; then
                print_warning "Existing .env is missing CERT_RESOLVER."
                print_info "Starting reconfiguration to fix TLS resolver..."
            elif [ -n "$DETECTED_CERT_RESOLVER" ] && [ "$CERT_RESOLVER" != "$DETECTED_CERT_RESOLVER" ]; then
                print_warning "CERT_RESOLVER mismatch (.env=$CERT_RESOLVER, traefik=$DETECTED_CERT_RESOLVER)."
                print_info "Starting reconfiguration to fix TLS resolver..."
            else
                print_info "Keeping existing configuration"
                return
            fi
        fi
        cp .env ".env.backup.$(date +%s)"
        print_info "Existing .env backed up"
    fi

    print_info "Starting configuration wizard..."
    echo ""

    # Domain
    read_input "Enter domain (e.g. panel.example.com)" "" "DOMAIN" "false"
    while [ -z "$DOMAIN" ]; do
        print_error "Domain is required!"
        read_input "Enter domain (e.g. panel.example.com)" "" "DOMAIN" "false"
    done

    # Cert resolver: prefer detected value from running Traefik, then existing .env, then fallback.
    DEFAULT_CERT_RESOLVER="$DETECTED_CERT_RESOLVER"
    if [ -z "$DEFAULT_CERT_RESOLVER" ] && [ -n "$EXISTING_CERT_RESOLVER" ]; then
        DEFAULT_CERT_RESOLVER="$EXISTING_CERT_RESOLVER"
    fi
    if [ -z "$DEFAULT_CERT_RESOLVER" ]; then
        DEFAULT_CERT_RESOLVER="letsencrypt"
    fi

    read_input "Certificate resolver name (Traefik)" "$DEFAULT_CERT_RESOLVER" "CERT_RESOLVER" "false"
    while [ -z "$CERT_RESOLVER" ]; do
        print_error "Certificate resolver is required!"
        read_input "Certificate resolver name (Traefik)" "$DEFAULT_CERT_RESOLVER" "CERT_RESOLVER" "false"
    done

    # Admin credentials
    read_input "Admin username" "admin" "ADMIN_USERNAME" "false"

    while true; do
        read_input "Admin password (min 6 characters)" "" "ADMIN_PASSWORD" "true"
        if [ ${#ADMIN_PASSWORD} -ge 6 ]; then
            break
        else
            print_error "Password must be at least 6 characters!"
        fi
    done

    # Generate secrets
    print_info "Generating cryptographic secrets..."
    JWT_SECRET=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)

    print_success "JWT secret generated (64 hex chars)"
    print_success "AES-256-GCM encryption key generated (64 hex chars)"

    # Write .env file
    print_info "Creating .env file..."
    cat > .env <<ENVFILE
# ═══════════════════════════════════════════════════
#  VPS Control App - Environment Configuration
#  Generated by deploy.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
#  DO NOT commit this file to version control.
# ═══════════════════════════════════════════════════

# ─── Domain & Traefik ───
DOMAIN=${DOMAIN}
CERT_RESOLVER=${CERT_RESOLVER}
TRAEFIK_NETWORK=${TRAEFIK_NETWORK}

# ─── Database (SQLite, stored in Docker volume) ───
DATABASE_URL=file:/app/data/vpscontrol.db

# ─── Security ───
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ─── Admin Account ───
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ENVFILE

    chmod 600 .env
    print_success "Configuration saved to .env"
}

# ─── [8/8] Deploy Application ───
deploy_application() {
    print_header "[7/8] Building and Deploying"

    cd "$APP_DIR"

    # Set Docker timeouts for stability
    export DOCKER_CLIENT_TIMEOUT=300
    export COMPOSE_HTTP_TIMEOUT=300

    # Stop and remove old containers (volumes kept — app_data has SQLite DB)
    print_info "Stopping old containers..."
    $COMPOSE_CMD down --remove-orphans 2>/dev/null || true

    # Pull only pre-built images (e.g. from docker hub). App is built from Dockerfile, so "app skipped" is normal.
    print_info "Pulling pre-built images (app is built locally; 'app skipped' is expected)..."
    $COMPOSE_CMD pull --ignore-buildable 2>&1 | grep -v "Pulling" || true

    read_input "Build with cache? (Y = faster / n = clean build, no cache)" "Y" "USE_CACHE" "false"
    USE_NO_CACHE=""
    if [[ "$USE_CACHE" =~ ^[Nn]$ ]]; then
        USE_NO_CACHE="--no-cache"
        print_info "Clean build (no cache)..."
    else
        print_info "Building with cache (only changed layers rebuild)..."
    fi

    export DOCKER_BUILDKIT=1
    export BUILDKIT_PROGRESS=plain
    export PROGRESS_NO_TRUNC=1

    # ── Build with visual progress bar ──
    BUILD_LOG=$(mktemp)
    START_TIME=$(date +%s)

    # Get terminal width (fallback 80) — used to prevent line wrapping
    TERM_WIDTH=$(tput cols 2>/dev/null || echo 80)

    # Run build in background, capturing all output to log file.
    # --progress=plain outputs to stdout/stderr (no /dev/tty), so direct redirection works.
    $COMPOSE_CMD build $USE_NO_CACHE --progress=plain > "$BUILD_LOG" 2>&1 &
    BUILD_PID=$!

    SPINNER='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    SPIN_IDX=0

    # Hide cursor for cleaner single-line updates
    tput civis 2>/dev/null || true

    while kill -0 "$BUILD_PID" 2>/dev/null; do
        NOW=$(date +%s)
        ELAPSED=$((NOW - START_TIME))
        MINS=$((ELAPSED / 60))
        SECS=$((ELAPSED % 60))

        # Parse BuildKit --progress=plain format, strip ALL control chars
        #   "#5 [deps 2/4] RUN apk add ..."
        #   "#12 [builder 1/3] COPY . ."
        CURRENT_STEP=$(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g; s/[^[:print:]]//g' "$BUILD_LOG" 2>/dev/null \
            | grep -oE '#[0-9]+ \[[a-z_-]+ [0-9]+/[0-9]+\] .+' \
            | tail -1 \
            | sed 's/#[0-9]* \[\([^]]*\)\] /\1 · /')

        if [ -z "$CURRENT_STEP" ]; then
            CURRENT_STEP=$(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g; s/[^[:print:]]//g' "$BUILD_LOG" 2>/dev/null \
                | grep -oE '#[0-9]+ \[.+\]' \
                | tail -1 \
                | sed 's/#[0-9]* //')
        fi
        if [ -z "$CURRENT_STEP" ]; then
            CURRENT_STEP="preparing..."
        fi

        # Count completed steps (from sanitized log)
        DONE_COUNT=$(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g; s/[^[:print:]]//g' "$BUILD_LOG" 2>/dev/null \
            | grep -c 'DONE' || echo "0")

        CHAR="${SPINNER:$SPIN_IDX:1}"
        SPIN_IDX=$(( (SPIN_IDX + 1) % ${#SPINNER} ))

        # Build raw text (no ANSI) to measure real length
        RAW_TEXT=$(printf "  %s Building (%s done) %02d:%02d  %s" \
            "$CHAR" "$DONE_COUNT" "$MINS" "$SECS" "$CURRENT_STEP")

        # Truncate to terminal width - 1 (leave room, prevent wrap)
        MAX_LEN=$((TERM_WIDTH - 1))
        RAW_TEXT="${RAW_TEXT:0:$MAX_LEN}"

        # Pad with spaces to fill entire line (overwrites any previous longer text)
        PADDED=$(printf "%-${MAX_LEN}s" "$RAW_TEXT")

        # Print: carriage return → overwrite entire line (no newline, no wrap)
        printf "\r%s" "$PADDED"
        sleep 1
    done

    # Restore cursor
    tput cnorm 2>/dev/null || true

    # Check build result
    wait "$BUILD_PID"
    BUILD_EXIT=$?
    printf "\r%-${TERM_WIDTH}s\r" " "  # Clear the progress line

    if [ $BUILD_EXIT -ne 0 ]; then
        echo ""
        print_error "Build failed! Error details:"
        echo ""
        echo -e "${RED}─── Build Error Log (last 40 lines) ───${NC}"
        tail -40 "$BUILD_LOG"
        echo -e "${RED}───────────────────────────────────────${NC}"
        echo ""
        print_info "Full log: $BUILD_LOG"
        exit 1
    fi

    TOTAL_TIME=$(($(date +%s) - START_TIME))
    TOTAL_MINS=$((TOTAL_TIME / 60))
    TOTAL_SECS=$((TOTAL_TIME % 60))
    print_success "Build completed in ${TOTAL_MINS}m ${TOTAL_SECS}s (${DONE_COUNT} steps)"
    rm -f "$BUILD_LOG"

    print_info "Starting containers..."
    $COMPOSE_CMD up -d

    # Clean up old resources (after new containers run, so app_data + traefik_network stay)
    print_info "Cleaning up unused images, volumes, and networks..."
    docker image prune -f 2>/dev/null || true
    docker volume prune -f 2>/dev/null || true
    docker network prune -f 2>/dev/null || true

    print_success "Containers started"
}

# ─── Verify Deployment ───
# Returns 0 if app is running, 1 otherwise. Caller must check and show success/failure.
verify_deployment() {
    print_header "[8/8] Verifying Deployment"

    cd "$APP_DIR"

    print_info "Waiting for application to initialize (30 seconds)..."
    sleep 30

    APP_OK=0
    if [ -z "$DOMAIN" ]; then
        print_error "DOMAIN is empty. Web route cannot work via Traefik."
        print_info "Run deploy again and set a valid domain in configuration."
        APP_OK=1
    fi

    if $COMPOSE_CMD ps 2>/dev/null | grep -q "Up\|running"; then
        print_success "Application container is running"
    else
        print_error "Application container failed to start"
        print_info "Check logs with: $COMPOSE_CMD logs app"
        $COMPOSE_CMD logs --tail=30 app 2>/dev/null || true
        APP_OK=1
    fi

    if docker ps | grep -q traefik; then
        print_success "Traefik is running"
    else
        print_warning "Traefik is not running"
    fi

    return $APP_OK
}

# ─── Completion Message ───
show_completion_message() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════╗"
    echo -e "║       VPS Control App — Deployed Successfully    ║"
    echo -e "╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${YELLOW}URL:${NC}       https://$DOMAIN"
    echo -e "  ${YELLOW}Admin:${NC}     $ADMIN_USERNAME"
    echo -e "  ${YELLOW}Network:${NC}   $TRAEFIK_NETWORK"
    echo ""

    # Show apps sharing Traefik
    echo -e "  ${BLUE}Apps on Traefik network ($TRAEFIK_NETWORK):${NC}"
    docker network inspect "$TRAEFIK_NETWORK" --format '{{range .Containers}}    - {{.Name}}{{println}}{{end}}' 2>/dev/null || echo "    - vps-control-app"
    echo ""

    echo -e "  ${BLUE}Next Steps:${NC}"
    echo "    1. Point your domain DNS (A record) to this server's IP"
    echo "    2. Wait 1-2 minutes for SSL certificate provisioning"
    echo "    3. Visit https://$DOMAIN and log in"
    echo ""
    echo -e "  ${BLUE}Useful Commands:${NC}"
    echo "    View logs:     cd $APP_DIR && $COMPOSE_CMD logs -f app"
    echo "    Restart:       cd $APP_DIR && $COMPOSE_CMD restart"
    echo "    Stop:          cd $APP_DIR && $COMPOSE_CMD down"
    echo "    Update:        cd $APP_DIR && ./deploy.sh  (checks git + rebuilds)"
    echo "    Backup DB:     docker cp vps-control-app:/app/data/vpscontrol.db ./backup.db"
    echo ""
}

# ═══════════════════════════════════════════════════
#  Main Deployment Flow
# ═══════════════════════════════════════════════════
main() {
    clear
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║   VPS Control App - Automated Deployment v2.0   ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # Must be root
    check_root

    # Check for code updates (optional)
    echo ""
    read_input "Check for code updates from GitHub? (Y/n)" "Y" "DO_UPDATE" "false"
    if [[ "$DO_UPDATE" =~ ^[Yy]$ ]]; then
        check_for_updates
    fi

    # System checks
    check_system_requirements

    # Confirm
    echo ""
    read_input "Proceed with deployment? (Y/n)" "Y" "PROCEED" "false"
    if [[ ! "$PROCEED" =~ ^[Yy]$ ]]; then
        print_info "Deployment cancelled"
        exit 0
    fi

    # Install everything
    install_dependencies
    install_docker
    install_docker_compose
    configure_firewall

    # Setup services
    setup_traefik
    configure_application
    deploy_application
    if verify_deployment; then
        show_completion_message
        print_success "Deployment completed!"
    else
        echo ""
        echo -e "${RED}╔══════════════════════════════════════════════════╗"
        echo -e "║       VPS Control App — Deployment Failed         ║"
        echo -e "╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        print_error "Application container did not start. Check logs above."
        echo -e "  ${BLUE}Debug:${NC} cd $APP_DIR && $COMPOSE_CMD logs -f app"
        echo ""
        exit 1
    fi
}

# Run
main "$@"
