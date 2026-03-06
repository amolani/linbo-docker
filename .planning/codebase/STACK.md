# Technology Stack

**Analysis Date:** 2026-03-06

## Languages

**Primary:**
- JavaScript (Node.js, CommonJS) - API backend (`containers/api/src/`)
- TypeScript (ESM) - Web frontend (`containers/web/frontend/src/`)
- Shell (Bash/sh) - Init scripts, deploy scripts, server utilities (`scripts/server/`, `containers/*/entrypoint.sh`)

**Secondary:**
- Python 3 - DC Worker for machine account repair (`dc-worker/macct-worker.py`)
- SQL - Prisma schema generates PostgreSQL DDL (`containers/api/prisma/schema.prisma`)

## Runtime

**Environment:**
- Node.js 20 (Alpine) - API container base image (`containers/api/Dockerfile`: `FROM node:20-alpine`)
- Node.js 20 (Alpine) - Web build stage (`containers/web/Dockerfile`: `FROM node:20-alpine AS builder`)
- Alpine 3.19 - Init container, DHCP container (`containers/init/Dockerfile`, `containers/dhcp/Dockerfile`)
- Ubuntu 24.04 - TFTP, SSH, RSYNC containers (`containers/tftp/Dockerfile`, `containers/ssh/Dockerfile`, `containers/rsync/Dockerfile`)

**Package Manager:**
- npm - Both API and frontend
- Lockfile: `package-lock.json` present in `containers/api/` and `containers/web/frontend/`
- pip - DC Worker (`redis`, `requests` packages)

## Frameworks

**Core:**
- Express.js ^4.18.2 - REST API framework (`containers/api/package.json`)
- React ^18.2.0 - Frontend SPA (`containers/web/frontend/package.json`)
- React Router DOM ^6.22.0 - Client-side routing

**Testing:**
- Jest ^29.7.0 - API backend tests (`containers/api/package.json`, config via `npm test`)
- Vitest ^1.2.2 - Frontend tests (`containers/web/frontend/package.json`)
- Testing Library React ^14.2.1 - React component testing
- Testing Library Jest-DOM ^6.4.2 - DOM assertions
- jsdom ^24.0.0 - Browser environment for Vitest

**Build/Dev:**
- Vite ^5.1.0 - Frontend build tool and dev server (`containers/web/frontend/vite.config.ts`)
- TypeScript ^5.3.3 - Frontend type checking
- Docker Compose - Multi-container orchestration (`docker-compose.yml`)
- Make - Developer workflow automation (`Makefile`)
- Nodemon ^3.0.2 - API hot-reload in development

## Key Dependencies

**Critical (API):**
- `@prisma/client` ^5.8.0 - PostgreSQL ORM (optional in sync mode)
- `ioredis` ^5.3.2 - Redis client for caching, pub/sub, streams
- `ws` ^8.16.0 - WebSocket server (dual: main events + terminal)
- `ssh2` ^1.15.0 - SSH client for remote LINBO commands and terminal sessions
- `jsonwebtoken` ^9.0.2 - JWT auth token generation/verification
- `bcryptjs` ^2.4.3 - Password hashing
- `zod` ^3.22.4 - Request validation schemas
- `multer` ^2.0.2 - File upload handling (driver/patchclass uploads)

**Critical (Frontend):**
- `zustand` ^4.5.0 - State management (5 stores: auth, host, ws, notification, serverConfig)
- `axios` ^1.6.7 - HTTP client for API calls (`containers/web/frontend/src/api/client.ts`)
- `@xterm/xterm` ^6.0.0 - Web terminal emulator
- `@xterm/addon-fit` ^0.11.0 - Terminal auto-sizing
- `@edulution-io/ui-kit` ^0.0.1 - Shared UI component library (GitHub Packages registry)

**Infrastructure (API):**
- `express` ^4.18.2 - HTTP framework
- `helmet` ^7.1.0 - Security headers
- `cors` ^2.8.5 - CORS middleware
- `morgan` ^1.10.0 - HTTP request logging
- `dotenv` ^16.3.1 - Environment variable loading
- `uuid` ^9.0.0 - UUID generation for sessions/operations

**Frontend UI:**
- `tailwindcss` ^3.4.1 - Utility-first CSS framework
- `@headlessui/react` ^1.7.18 - Unstyled accessible UI components
- `lucide-react` ^0.563.0 - Icon library
- `clsx` ^2.1.1 + `tailwind-merge` ^3.4.0 - Conditional class utilities

**Linting:**
- `eslint` ^8.56.0 - Linting (both API and frontend)
- `@typescript-eslint/eslint-plugin` ^6.21.0 - TypeScript ESLint rules (frontend)
- `@typescript-eslint/parser` ^6.21.0 - TypeScript parser for ESLint (frontend)

## Configuration

**Environment:**
- `.env` file at project root (never committed, never overwritten on deploy)
- `.env.example` serves as template with all configurable variables
- Runtime settings stored in Redis via settings service (`containers/api/src/services/settings.service.js`)
- Settings cascade: Redis → env var → default value
- Required env vars for production:
  - `LINBO_SERVER_IP` - Docker host IP visible to PXE clients
  - `JWT_SECRET` - Authentication token signing key
  - `INTERNAL_API_KEY` - Container-to-container auth
  - `GITHUB_TOKEN` - Required for `@edulution-io/ui-kit` npm package (frontend build)

**Build:**
- `containers/api/Dockerfile` - Multi-stage: Prisma generate → production
- `containers/web/Dockerfile` - Multi-stage: Node build → Nginx serve
- `containers/web/frontend/vite.config.ts` - Vite build config with `@` path alias
- `containers/web/frontend/tsconfig.json` - TypeScript config (strict mode, ES2020 target)
- `containers/web/frontend/tailwind.config.js` - Tailwind with edulution preset
- `containers/web/frontend/.npmrc` - GitHub Packages registry for `@edulution-io` scope
- `containers/web/nginx.conf` - Nginx reverse proxy (API, WebSocket, boot files, SPA fallback)

**Docker Volumes (6 named):**
- `linbo_srv_data` - Boot files, images, GRUB configs (`/srv/linbo`)
- `linbo_config` - SSH keys, LINBO config (`/etc/linuxmuster/linbo`)
- `linbo_log` - Log files (`/var/log/linuxmuster/linbo`)
- `linbo_redis_data` - Redis persistence (`/data`)
- `linbo_kernel_data` - Kernel variants (`/var/lib/linuxmuster/linbo`)
- `linbo_driver_data` - Patchclass drivers (`/var/lib/linbo/drivers`)

## Platform Requirements

**Development:**
- Docker + Docker Compose
- Linux host (tested on Ubuntu/Debian)
- `GITHUB_TOKEN` for frontend npm package access
- Make (optional, convenience wrapper)

**Production:**
- Docker host on same network as PXE clients
- Network mode: TFTP uses `network_mode: host` (UDP 69)
- DHCP container (optional profile) uses `network_mode: host` + `NET_ADMIN` + `NET_RAW` capabilities
- Ports exposed: 3000 (API), 8080 (Web), 873 (rsync), 2222 (SSH), 69/udp (TFTP)
- Host bind mount: `/lib/firmware:/lib/firmware:ro` (for linbofs kernel firmware)
- Deployment target: bare-metal Linux servers running linuxmuster.net 7.x

## Container Architecture

| Container | Base Image | Purpose | Port |
|-----------|-----------|---------|------|
| `linbo-init` | alpine:3.19 | Downloads boot files from APT repo (run-once) | - |
| `linbo-tftp` | ubuntu:24.04 | PXE TFTP server (tftpd-hpa) | 69/udp (host) |
| `linbo-rsync` | ubuntu:24.04 | Image sync via rsync daemon | 873 |
| `linbo-ssh` | ubuntu:24.04 | SSH server + remote commands (openssh, tmux) | 2222 |
| `linbo-cache` | redis:7-alpine | Redis cache/pub-sub/streams | 6379 |
| `linbo-api` | node:20-alpine | Express REST API + WebSocket | 3000 |
| `linbo-web` | nginx:alpine | React SPA + reverse proxy | 8080 |
| `linbo-dhcp` | alpine:3.19 | dnsmasq DHCP proxy (optional profile) | 67/udp (host) |

**Startup Order:**
init → (cache, ssh) → api → (tftp, web)

**Process Manager:**
- API uses `tini` as PID 1 init system for signal handling (`containers/api/Dockerfile`)
- Graceful shutdown with 10s timeout (`containers/api/src/index.js`)

---

*Stack analysis: 2026-03-06*
