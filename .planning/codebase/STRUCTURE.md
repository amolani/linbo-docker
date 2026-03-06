# Codebase Structure

**Analysis Date:** 2026-03-06

## Directory Layout

```
linbo-docker/
├── containers/                # Docker container sources (one dir per service)
│   ├── api/                   # Node.js REST API + WebSocket server
│   │   ├── Dockerfile         # Multi-stage: builder (Prisma generate) + production
│   │   ├── package.json       # Node dependencies
│   │   ├── prisma/            # Prisma ORM schema
│   │   │   └── schema.prisma  # PostgreSQL models (10 models)
│   │   ├── src/               # Application source code
│   │   │   ├── index.js       # Entry point (Express, WS, workers, startup)
│   │   │   ├── data/          # Static data files (driver-catalog.json)
│   │   │   ├── lib/           # Shared libraries (redis, prisma, ws, lmn-api-client)
│   │   │   ├── middleware/    # Express middleware (auth, validate, audit)
│   │   │   ├── routes/        # Express route modules (16 files)
│   │   │   ├── services/      # Business logic services (23 files)
│   │   │   ├── templates/     # GRUB config templates
│   │   │   │   └── grub/      # grub.cfg.global, grub.cfg.os, grub.cfg.pxe
│   │   │   └── workers/       # Background workers (operation, host-status)
│   │   └── tests/             # API test files
│   │       ├── lib/           # Library tests
│   │       ├── routes/        # Route tests
│   │       ├── services/      # Service tests
│   │       └── workers/       # Worker tests
│   ├── dhcp/                  # dnsmasq DHCP proxy (optional)
│   │   └── Dockerfile         # Alpine + dnsmasq
│   ├── init/                  # Boot file provisioning (one-shot)
│   │   ├── Dockerfile         # Alpine + dpkg + curl
│   │   └── entrypoint.sh      # APT package download + extraction logic
│   ├── rsync/                 # Image sync server
│   │   ├── Dockerfile         # Ubuntu + rsync
│   │   └── scripts/           # rsync hook scripts (pre/post download/upload)
│   ├── ssh/                   # SSH server for remote commands
│   │   └── Dockerfile         # Ubuntu + openssh + tmux + linbo tools
│   ├── tftp/                  # PXE TFTP server
│   │   └── Dockerfile         # Ubuntu + tftpd-hpa
│   └── web/                   # React frontend + Nginx
│       ├── Dockerfile         # Multi-stage: Node build + Nginx serve
│       ├── nginx.conf         # Nginx reverse proxy config
│       └── frontend/          # React application
│           ├── package.json   # Frontend dependencies
│           ├── vite.config.ts # Vite build config
│           ├── tsconfig.json  # TypeScript config
│           ├── tailwind.config.js
│           ├── public/        # Static assets
│           └── src/           # React source code
│               ├── main.tsx   # React entry point
│               ├── App.tsx    # Root component (BrowserRouter)
│               ├── index.css  # Global styles (Tailwind)
│               ├── api/       # API client modules (16 files)
│               ├── components/ # React components (11 subdirectories)
│               ├── hooks/     # Custom React hooks (6 files)
│               ├── lib/       # Utility functions (utils.ts)
│               ├── pages/     # Page components (18 files)
│               ├── routes/    # React Router config (index.tsx, ProtectedRoute.tsx)
│               ├── stores/    # Zustand state stores (5 files)
│               ├── types/     # TypeScript type definitions (index.ts)
│               └── __tests__/ # Frontend tests
├── config/                    # Runtime configuration files
│   ├── rsyncd.conf            # Rsync daemon config
│   ├── rsyncd.secrets         # Rsync authentication
│   ├── ssh_config             # SSH client config
│   ├── init.sql               # PostgreSQL schema init
│   ├── dropbear_*_host_key    # Dropbear SSH host keys
│   ├── linbo_client_key       # SSH key for LINBO client connections
│   └── server_id_rsa.pub      # Server SSH public key
├── scripts/                   # Deployment and management scripts
│   ├── deploy.sh              # Deploy to remote server (rsync or git)
│   ├── install.sh             # First-time installation
│   ├── update.sh              # Update existing installation
│   ├── uninstall.sh           # Remove installation
│   ├── status.sh              # System status check
│   ├── lmn-post-hook/         # LMN server post-import hooks
│   └── server/                # Server-side scripts (mounted into containers)
│       ├── update-linbofs.sh  # linbofs64 builder (SSH keys, modules, firmware, hooks)
│       ├── linbo-remote       # Remote command execution script
│       ├── linbo-configure.sh # Configuration helper
│       ├── rsync-pre-*.sh     # Rsync pre-transfer hooks
│       ├── rsync-post-*.sh    # Rsync post-transfer hooks
│       └── ...                # Other linbo server tools
├── lmn-authority-api/         # Python FastAPI (runs on LMN server, not in Docker)
│   ├── lmn_authority/         # Python package
│   │   ├── adapters/          # File system adapters
│   │   ├── middleware/        # FastAPI middleware
│   │   ├── models/            # Pydantic models
│   │   ├── routers/           # API routers
│   │   └── services/          # Business logic
│   ├── tests/                 # Python tests
│   ├── deploy/                # Deployment scripts
│   └── pyproject.toml         # Python project config
├── dc-worker/                 # Device CSV worker (Debian package)
│   └── debian/                # Debian packaging files
├── themes/                    # LINBO GUI themes
├── plymouth/                  # Plymouth boot splash theme
├── etc/                       # Static config templates (linbo_pwhash, linbo_salt)
├── volumes/                   # Volume seed data (initial directory structure)
├── deploy/                    # Production deployment configs
│   ├── docker-compose.yml     # Production compose file
│   ├── install.sh             # Production installer
│   └── package.sh             # Package builder
├── tests/                     # Integration test runners
│   ├── run-api-tests.sh       # Local test runner
│   └── run-api-tests-docker.sh # Docker-based test runner
├── docs/                      # Documentation
│   ├── agents/                # Claude agent instructions
│   ├── debug/                 # Debug notes (LINBO boot issues)
│   ├── phase0/                # Planning docs (marked as proposals)
│   ├── upstream-pr/           # Upstream PR documentation
│   └── _archive/              # Archived planning docs
├── .github/workflows/         # CI/CD (GitHub Actions)
├── docker-compose.yml         # Main Docker Compose file
├── Makefile                   # Development shortcuts
├── CLAUDE.md                  # Claude AI instructions
├── README.md                  # Project documentation
├── .env.example               # Environment variable template
├── .gitignore                 # Git ignore patterns
└── init.sh                    # Legacy init script (root level)
```

## Directory Purposes

**`containers/api/src/routes/`:**
- Purpose: Express route handlers organized by domain
- Contains: 16 route modules, 1 index aggregator
- Key files:
  - `index.js`: Async factory that reads sync mode and conditionally mounts routes
  - `system.js`: System management (linbofs, GRUB, kernel, LINBO updates)
  - `hosts.js`: Host CRUD (standalone mode)
  - `configs.js`: Config CRUD + deployment (standalone mode)
  - `images.js`: Image management (both modes, Prisma-optional)
  - `sync.js`: Sync mode read endpoints (Redis-backed)
  - `sync-operations.js`: Operations in sync mode (Redis-backed)
  - `internal.js`: Container-to-container endpoints (API key auth)
  - `patchclass.js`: Driver/patchclass management
  - `settings.js`: Runtime settings CRUD
  - `terminal.js`: SSH terminal session management

**`containers/api/src/services/`:**
- Purpose: Business logic decoupled from HTTP layer
- Contains: 23 service modules
- Key files:
  - `sync.service.js`: Delta sync from LMN Authority API
  - `config.service.js`: start.conf generation + deployment
  - `grub.service.js`: GRUB config generation (standalone, Prisma)
  - `grub-generator.js`: GRUB config generation (sync mode, Redis)
  - `grub-theme.service.js`: GRUB boot menu theming
  - `image-sync.service.js`: Image download with resume + MD5
  - `remote.service.js`: linbo-remote replacement (SSH commands, onboot .cmd files)
  - `ssh.service.js`: SSH client for LINBO clients
  - `terminal.service.js`: Interactive SSH terminal sessions
  - `kernel.service.js`: Kernel variant switching
  - `linbofs.service.js`: linbofs64 rebuild orchestration
  - `linbo-update.service.js`: APT-based LINBO package updates
  - `patchclass.service.js`: Windows driver patchclass management
  - `firmware.service.js`: Firmware scanning + injection
  - `settings.service.js`: Runtime settings (Redis + env fallback)
  - `host.service.js`: Host status management
  - `wol.service.js`: Wake-on-LAN
  - `macct.service.js`: Machine account provisioning (Redis Streams)
  - `dhcp.service.js`: DHCP config export
  - `deviceImport.service.js`: CSV device import
  - `provisioning.service.js`: Host provisioning orchestration
  - `sync-operations.service.js`: Redis-backed operations for sync mode

**`containers/api/src/lib/`:**
- Purpose: Shared utility libraries
- Contains: 16 library files
- Key files:
  - `redis.js`: Redis singleton, cache helpers, pub/sub
  - `prisma.js`: Prisma client singleton with retry
  - `websocket.js`: WS broadcast with typed event methods
  - `lmn-api-client.js`: LMN API client (auto-detects port 8001 JWT vs 8400 Bearer)
  - `image-path.js`: Image path resolution + validation
  - `atomic-write.js`: Crash-safe file writes
  - `startconf-rewrite.js`: start.conf server= field rewriting
  - `driver-path.js`: Path security for driver management
  - `driver-shell.js`: Shell escaping for driver commands
  - `driver-fs.js`: Filesystem operations for drivers
  - `driver-catalog.js`: Driver catalog queries
  - `firmware-catalog.js`: Firmware identification
  - `firmware-scanner.js`: Host firmware scanning
  - `dmesg-firmware-parser.js`: Parse dmesg for missing firmware

**`containers/api/src/middleware/`:**
- Purpose: Express middleware stack
- Contains: 3 middleware modules
- Key files:
  - `auth.js`: JWT generation/verification, API key auth, role-based access (`authenticateToken`, `requireRole`, `authenticateAny`, `optionalAuth`)
  - `validate.js`: Zod schemas for request validation (host, config, operation, image, etc.)
  - `audit.js`: Audit logging to PostgreSQL (Prisma-optional, degrades silently)

**`containers/web/frontend/src/api/`:**
- Purpose: Typed API client functions matching backend routes
- Contains: 16 TypeScript files
- Key file: `client.ts` (axios instance with auth interceptor + 401 redirect)
- Each file exports functions for one domain: `auth.ts`, `hosts.ts`, `configs.ts`, `images.ts`, `operations.ts`, `sync.ts`, `system.ts`, `patchclass.ts`, etc.

**`containers/web/frontend/src/pages/`:**
- Purpose: Top-level page components (one per route)
- Contains: 18 page components
- Key files: `DashboardPage.tsx`, `HostsPage.tsx`, `ConfigsPage.tsx`, `ImagesPage.tsx`, `OperationsPage.tsx`, `SyncPage.tsx`, `SettingsPage.tsx`, `TerminalPage.tsx`
- Barrel export: `index.ts`

**`containers/web/frontend/src/components/`:**
- Purpose: Reusable React components organized by domain
- Contains: 11 subdirectories
- Structure: `configs/`, `dashboard/`, `dhcp/`, `drivers/`, `hosts/`, `layout/`, `operations/`, `sync/`, `system/`, `terminal/`, `ui/`
- `ui/` contains shared primitives: `Button.tsx`, `Input.tsx`, `Modal.tsx`, `Table.tsx`, `Badge.tsx`, `Toast.tsx`, `FileUpload.tsx`
- `layout/` contains `AppLayout.tsx`, `Sidebar.tsx`, `Header.tsx`

**`containers/web/frontend/src/stores/`:**
- Purpose: Zustand state management stores
- Contains: 5 stores
- Key files:
  - `authStore.ts`: JWT token persistence (localStorage), login/logout/checkAuth
  - `wsStore.ts`: WebSocket connection with auto-reconnect, event subscription
  - `hostStore.ts`: Host data with WS-driven status updates
  - `notificationStore.ts`: Toast notification queue
  - `serverConfigStore.ts`: Cached operating mode (sync/standalone)

**`scripts/server/`:**
- Purpose: Server-side scripts mounted into containers via Docker volume
- Contains: Shell scripts for LINBO operations
- Key file: `update-linbofs.sh` -- core linbofs64 builder (extracts template, injects SSH keys + password hash + kernel modules + firmware, runs pre/post hooks, repacks as XZ-compressed CPIO)
- rsync hook scripts: `rsync-pre-download-api.sh`, `rsync-post-upload-api.sh`, etc.
- Mounted at: `/usr/share/linuxmuster/linbo/` inside api and ssh containers

## Key File Locations

**Entry Points:**
- `containers/api/src/index.js`: API server startup (Express + WS + workers)
- `containers/web/frontend/src/main.tsx`: React app bootstrap
- `containers/init/entrypoint.sh`: Init container boot file provisioning
- `scripts/server/update-linbofs.sh`: linbofs64 build script

**Configuration:**
- `docker-compose.yml`: Container orchestration
- `.env.example`: Environment variable reference
- `config/rsyncd.conf`: Rsync daemon configuration
- `config/init.sql`: PostgreSQL schema initialization
- `containers/api/prisma/schema.prisma`: Database schema (10 models)

**Core Logic:**
- `containers/api/src/services/sync.service.js`: LMN sync engine
- `containers/api/src/services/grub-generator.js`: GRUB config generation (sync mode)
- `containers/api/src/services/grub.service.js`: GRUB config generation (standalone)
- `containers/api/src/services/config.service.js`: start.conf generation + deployment
- `containers/api/src/services/remote.service.js`: Remote command execution
- `containers/api/src/services/image-sync.service.js`: Image download with resume
- `containers/api/src/services/kernel.service.js`: Kernel variant management
- `containers/api/src/services/patchclass.service.js`: Driver patchclass management

**Testing:**
- `containers/api/tests/`: API tests (lib, routes, services, workers subdirs)
- `containers/web/frontend/src/__tests__/`: Frontend tests (api, integration, stores)
- `tests/run-api-tests.sh`: Test runner script

## Naming Conventions

**Files (Backend, JS):**
- Routes: `{domain}.js` (e.g., `hosts.js`, `configs.js`, `system.js`)
- Services: `{domain}.service.js` (e.g., `sync.service.js`, `grub.service.js`)
- Libraries: `{name}.js` (e.g., `redis.js`, `prisma.js`, `websocket.js`)
- Workers: `{name}.worker.js` (e.g., `operation.worker.js`)
- Multi-word: kebab-case (e.g., `image-sync.service.js`, `lmn-api-client.js`)
- Tests: mirror source path in `tests/` dir (e.g., `tests/services/linbo-update.service.test.js`)

**Files (Frontend, TSX):**
- Pages: PascalCase with Page suffix (e.g., `DashboardPage.tsx`, `HostsPage.tsx`)
- Components: PascalCase (e.g., `StatsCards.tsx`, `Sidebar.tsx`)
- API modules: camelCase (e.g., `hosts.ts`, `patchclass.ts`)
- Hooks: camelCase with use prefix (e.g., `useAuth.ts`, `useWebSocket.ts`)
- Stores: camelCase with Store suffix (e.g., `authStore.ts`, `wsStore.ts`)
- Barrel exports: `index.ts` in component directories

**Directories:**
- Backend: kebab-case (e.g., `src/services/`, `src/middleware/`)
- Frontend components: kebab-case by domain (e.g., `components/hosts/`, `components/ui/`)
- Container dirs: kebab-case (e.g., `containers/api/`, `containers/web/`)

## Where to Add New Code

**New API Endpoint:**
- Route handler: `containers/api/src/routes/{domain}.js`
- Service logic: `containers/api/src/services/{domain}.service.js`
- Validation schema: Add to `containers/api/src/middleware/validate.js`
- Mount route: Register in `containers/api/src/routes/index.js`
- Tests: `containers/api/tests/routes/{domain}.test.js` and `tests/services/{domain}.service.test.js`

**New Frontend Page:**
- Page component: `containers/web/frontend/src/pages/{Name}Page.tsx`
- Route registration: Add to `containers/web/frontend/src/routes/index.tsx`
- API client: `containers/web/frontend/src/api/{domain}.ts`
- Components: `containers/web/frontend/src/components/{domain}/`
- Export from: `containers/web/frontend/src/pages/index.ts`

**New Service:**
- Implementation: `containers/api/src/services/{name}.service.js`
- Shared utilities: `containers/api/src/lib/{name}.js`
- Import in route handler or worker

**New Background Worker:**
- Worker file: `containers/api/src/workers/{name}.worker.js`
- Start in: `containers/api/src/index.js` (in `startServer()` function)

**New Container:**
- Directory: `containers/{name}/`
- Add to: `docker-compose.yml`
- Dockerfile + entrypoint

**New React Component:**
- Domain component: `containers/web/frontend/src/components/{domain}/{ComponentName}.tsx`
- Shared UI primitive: `containers/web/frontend/src/components/ui/{ComponentName}.tsx`
- Register in barrel: directory `index.ts`

**New Hook Script (linbofs64 customization):**
- Pre-repack: Create numbered script in `/etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/` (e.g., `01_mytheme`)
- Post-repack: Create numbered script in `/etc/linuxmuster/linbo/hooks/update-linbofs.post.d/`
- Scripts receive exported vars: `LINBO_DIR`, `CONFIG_DIR`, `CACHE_DIR`, `KTYPE`, `KVERS`, `WORKDIR`

## Special Directories

**`volumes/`:**
- Purpose: Seed data for Docker volumes on first run
- Generated: No (checked in)
- Committed: Yes

**`lmn-authority-api/`:**
- Purpose: Python FastAPI application deployed separately on LMN server (not in Docker Compose)
- Generated: No
- Committed: Yes (source code for authority API at port 8400)

**`dc-worker/`:**
- Purpose: Debian package for device CSV processing worker
- Generated: No
- Committed: Yes

**`deploy/`:**
- Purpose: Production deployment artifacts (separate docker-compose, installer, packager)
- Generated: No
- Committed: Yes

**`plymouth/`:**
- Purpose: Plymouth boot splash theme files
- Generated: No
- Committed: Yes

**`themes/`:**
- Purpose: LINBO GUI themes (mounted read-only into init container)
- Generated: No
- Committed: Yes

## Docker Volumes

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `linbo_srv_data` | `/srv/linbo` | Boot files, images, GRUB configs, linbocmd |
| `linbo_config` | `/etc/linuxmuster/linbo` | SSH keys, hook scripts, kernel state |
| `linbo_log` | `/var/log/linuxmuster/linbo` | Operation logs |
| `linbo_kernel_data` | `/var/lib/linuxmuster/linbo` | Kernel variant sets + current symlink |
| `linbo_driver_data` | `/var/lib/linbo/drivers` | Windows driver patchclasses |
| `linbo_redis_data` | `/data` (Redis) | Redis persistence |

---

*Structure analysis: 2026-03-06*
