# Claude Project Instructions for LINBO Docker

## CRITICAL: Workflow Requirements

### 1. Session Start - Always Explore First
At the beginning of EVERY new session, launch multiple parallel agents to understand the current project state:

```
1. Explore Agent: Project structure and recent changes (git log, git status)
2. Explore Agent: API architecture (containers/api/)
3. Explore Agent: Frontend architecture (containers/web/frontend/)
4. Explore Agent: Production LINBO setup (/srv/linbo/, /etc/linuxmuster/)
```

This ensures you always have current context before making any changes.

### 2. New Features/Requirements - ALWAYS Use Plan Mode
**NEVER start coding immediately when the user requests a new feature or change.**

Instead:
1. Enter Plan Mode (`EnterPlanMode`)
2. Explore the codebase to understand current implementation
3. Research how production linuxmuster.net handles it (if applicable)
4. Write a detailed plan with:
   - What needs to change
   - Which files will be affected
   - Potential risks or breaking changes
   - Testing approach
5. Discuss the plan with the user
6. Only after approval, exit plan mode and implement

### 3. Bug Fixes
For simple, obvious bugs: Fix directly with explanation.
For complex bugs or unclear root cause: Use Plan Mode first.

---

## Allowed Operations

### File System Access
- Full read access to `/srv/linbo/` (LINBO boot files, images, configs)
- Full read access to `/etc/linuxmuster/` (linuxmuster.net configuration)
- Full read access to `/var/lib/linuxmuster/` (sophomorix data)
- Full read access to `/var/log/linuxmuster/` (logs)

### Bash Commands - Always Allowed
```
# Git operations
git status, git diff, git add, git commit, git push, git pull, git log, git branch, git checkout, git merge, git rebase, git stash, git fetch, git remote

# File inspection
cat, head, tail, less, more, wc, file, stat, ls, tree, find, locate

# Text processing
grep, rg, awk, sed, cut, sort, uniq, tr, diff, comm

# Docker operations
docker, docker-compose, docker compose

# System inspection
ps, top, htop, free, df, du, mount, lsblk, ip, ss, netstat, curl, wget

# Package management
apt, apt-get, dpkg, npm, npx

# Process management
systemctl status, journalctl

# LINBO specific
linbo-remote, linbo-ssh, update-linbofs
```

### Search Patterns - Always Allowed
Search the entire server for:
- `linbo`, `LINBO`
- `linuxmuster`, `linuxmuster.net`
- `sophomorix`
- `start.conf`
- `grub.cfg`
- `.qcow2`, `.cloop`

## Project Context

This is a standalone LINBO Docker implementation. The production linuxmuster.net 7.3 server is available at 10.0.0.11 for reference.

### Key Paths on Production Server
| Path | Description |
|------|-------------|
| `/srv/linbo/` | Boot files, images, start.conf files |
| `/srv/linbo/boot/grub/` | GRUB configurations |
| `/srv/linbo/images/` | QCOW2 images |
| `/etc/linuxmuster/linbo/` | SSH keys, templates |
| `/var/lib/linuxmuster/` | Sophomorix user data |

### Key Paths in Docker Project
| Path | Description |
|------|-------------|
| `containers/api/` | Node.js REST API |
| `containers/web/frontend/` | React Frontend |
| `containers/api/prisma/schema.prisma` | Database schema |
| `scripts/server/` | LINBO server scripts |

## Test Environment
- Test VM: 10.0.0.13
- Production Server: 10.0.0.11
- Docker Host: localhost

## Coding Standards
- API: Express.js with Zod validation
- Frontend: React 18 + TypeScript + Tailwind
- Database: PostgreSQL with Prisma ORM
- Always run `npx prisma db push` after schema changes
- Always rebuild container after code changes: `docker compose up -d --build api`
