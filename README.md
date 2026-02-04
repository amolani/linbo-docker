# LINBO Docker

**Standalone Docker-based Network Boot & Imaging Solution**

[![Update Boot Files](https://github.com/amolani/linbo-docker/actions/workflows/update-boot-files.yml/badge.svg)](https://github.com/amolani/linbo-docker/actions/workflows/update-boot-files.yml)

LINBO Docker is a containerized version of [LINBO](https://github.com/linuxmuster/linuxmuster-linbo7) (Linux Network Boot) that runs independently without requiring a full linuxmuster.net installation.

## Features

- **PXE Network Boot** - Boot clients over the network
- **Image Management** - Create, sync, and deploy disk images (qcow2)
- **Remote Control** - Execute commands on clients via SSH
- **REST API** - Modern API for integration and automation
- **Web Interface** - Browser-based management (coming soon)
- **Standalone** - No linuxmuster.net server required
- **Auto-Updates** - Boot files automatically updated via GitHub Actions

## Quick Start

### Prerequisites

- Docker Engine 24.0+
- Docker Compose v2.20+
- 4 GB RAM minimum
- 50 GB disk space (more for images)

### Installation

```bash
# Clone the repository
git clone https://github.com/amolani/linbo-docker.git
cd linbo-docker

# Copy and configure environment
cp .env.example .env
nano .env  # Set your SERVER_IP and passwords

# Start all services
docker compose up -d

# Check status
docker compose ps
```

On first start, the init container automatically downloads the LINBO boot files (~70 MB) from GitHub Releases.

### Verify Installation

```bash
# Health check
curl http://localhost:3000/health

# Login (default: admin/admin)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Host                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │   TFTP   │  │  RSYNC   │  │   SSH    │  │   API    │        │
│  │  :69/udp │  │  :873    │  │  :2222   │  │  :3000   │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│       └─────────────┴─────────────┴─────────────┘               │
│                           │                                      │
│                    ┌──────┴──────┐                              │
│                    │ linbo_srv   │  Boot files, Images          │
│                    │   Volume    │  Configurations              │
│                    └─────────────┘                              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐                                     │
│  │ PostgreSQL│  │  Redis   │                                     │
│  │  Database │  │  Cache   │                                     │
│  └──────────┘  └──────────┘                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Init | - | Downloads boot files on first start |
| TFTP | 69/udp | PXE boot file server |
| RSYNC | 873 | Image synchronization |
| SSH | 2222 | Remote command execution |
| API | 3000 | REST API backend |
| PostgreSQL | 5432 (internal) | Database |
| Redis | 6379 (internal) | Cache |

## Configuration

### Environment Variables

Key variables in `.env`:

```bash
# Server IP (clients connect to this)
LINBO_SERVER_IP=10.0.0.1

# Database password (auto-generated on install)
DB_PASSWORD=your_secure_password

# JWT secret for API authentication
JWT_SECRET=your_jwt_secret

# API port
API_PORT=3000
```

See `.env.example` for all options.

### DHCP Configuration

LINBO Docker does not include a DHCP server. Configure your existing DHCP server:

```
# Example for ISC DHCP
next-server 10.0.0.1;         # Your LINBO Docker server IP
filename "boot/grub/grub.cfg";
```

## API Documentation

### Authentication

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r '.data.token')

# Use token
curl http://localhost:3000/api/v1/hosts \
  -H "Authorization: Bearer $TOKEN"
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /api/v1/auth/login` | Authentication |
| `GET /api/v1/hosts` | List hosts |
| `POST /api/v1/hosts/:id/sync` | Sync host |
| `POST /api/v1/hosts/:id/wake-on-lan` | Wake host |
| `GET /api/v1/configs` | List configurations |
| `GET /api/v1/images` | List images |

Full API documentation: `GET /api/v1`

## Boot Files

Boot files are automatically downloaded from GitHub Releases on first start. A GitHub Actions workflow checks weekly for new linuxmuster-linbo7 releases and creates updated boot file packages.

### Manual Update

```bash
# Force re-download of boot files
FORCE_BOOT_UPDATE=true docker compose up init

# Or delete volume and restart
docker compose down
docker volume rm linbo_srv_data
docker compose up -d
```

### Custom Boot Files

To use custom boot files, place them in the volume before starting:

```bash
docker volume create linbo_srv_data
docker run --rm -v linbo_srv_data:/srv/linbo -v /path/to/files:/src alpine \
  cp -r /src/* /srv/linbo/
docker compose up -d
```

## Development

```bash
# Build containers
docker compose build

# Start with logs
docker compose up

# Run API tests
docker exec linbo-api npm test

# Enter container shell
docker exec -it linbo-api sh
```

## Project Structure

```
linbo-docker/
├── docker-compose.yml          # Container orchestration
├── .env.example                 # Environment template
├── containers/
│   ├── init/                   # Boot files downloader
│   ├── tftp/                   # TFTP server
│   ├── rsync/                  # RSYNC daemon
│   ├── ssh/                    # SSH server
│   ├── api/                    # Node.js REST API
│   └── web/                    # Web frontend (Phase 5)
├── config/
│   ├── init.sql                # Database schema
│   └── rsyncd.conf             # RSYNC config
├── scripts/server/             # LINBO server scripts
├── docs/plan/                  # Project documentation
└── .github/workflows/          # CI/CD workflows
```

## Troubleshooting

### Init container fails

```bash
# Check init logs
docker compose logs init

# Manual download test
curl -I https://github.com/amolani/linbo-docker/releases/latest/download/linbo-boot-files.tar.gz
```

### Database connection error

```bash
# Check database logs
docker compose logs db

# Verify database is healthy
docker compose ps db
```

### PXE boot not working

1. Verify DHCP configuration points to correct server
2. Check TFTP container: `docker compose logs tftp`
3. Test TFTP: `tftp localhost -c get linbo64`

## License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file.

Based on [linuxmuster-linbo7](https://github.com/linuxmuster/linuxmuster-linbo7) by the linuxmuster.net team.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/amolani/linbo-docker/issues)
- Documentation: [docs/plan/](docs/plan/)

---

Made with :heart: for the education community
