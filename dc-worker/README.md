# LINBO Docker - Machine Account Worker

This directory contains the worker component that runs on the AD DC (Active Directory Domain Controller) to process machine account password repair jobs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ LINBO Docker                                                        │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────────┐ │
│  │ API         │───→│ PostgreSQL  │    │ Redis                    │ │
│  │ (Producer)  │    │ operations  │───→│ Stream: linbo:jobs       │ │
│  └─────────────┘    └─────────────┘    └────────────┬─────────────┘ │
└─────────────────────────────────────────────────────┼───────────────┘
                                                      │ XREADGROUP
                                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ AD DC (linuxmuster.net server)                                      │
│  ┌─────────────────────────────────┐    ┌───────────────────┐       │
│  │ macct-worker.service            │───→│ sam.ldb           │       │
│  │ - Reads jobs from Redis Stream  │    │ (via ldbmodify)   │       │
│  │ - Runs repair_macct.py locally  │    └───────────────────┘       │
│  │ - Reports status to API         │                                │
│  └─────────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```

## Why a Separate Worker?

The machine account password repair requires direct access to the Samba AD database (`sam.ldb`). This database:

- Can only be safely modified using `ldbmodify` on the DC
- Requires root privileges on the DC
- Cannot be accessed remotely or from a container

The worker architecture solves this by:
1. LINBO Docker creates "intent" jobs in a Redis Stream
2. The worker on the DC consumes these jobs
3. The worker executes `repair_macct.py` locally with full `sam.ldb` access
4. Results are reported back to the API

## Installation

### Prerequisites

- linuxmuster.net 7.3 server (AD DC)
- Python 3.8+
- Network access from DC to LINBO Docker Redis (port 6379)
- Network access from DC to LINBO Docker API (port 3000)

### Quick Install

```bash
# On the AD DC
sudo ./install.sh 10.0.0.1  # Replace with LINBO Docker IP
```

### Manual Install

```bash
# Install dependencies
sudo apt-get install python3-pip python3-redis python3-requests

# Create directories
sudo mkdir -p /var/log/macct

# Copy files
sudo cp macct-worker.py /usr/local/bin/
sudo chmod +x /usr/local/bin/macct-worker.py

# Configure
sudo cp macct-worker.conf.example /etc/macct-worker.conf
sudo nano /etc/macct-worker.conf  # Adjust settings

# Install service
sudo cp macct-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable macct-worker
```

## Configuration

Edit `/etc/macct-worker.conf`:

```bash
# Redis connection (LINBO Docker)
REDIS_HOST=10.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# API connection (LINBO Docker)
API_URL=http://10.0.0.1:3000/api/v1
API_KEY=linbo-internal-secret

# Worker identification
CONSUMER_NAME=dc-01

# Log directory
LOG_DIR=/var/log/macct

# Repair script path
REPAIR_SCRIPT=/usr/share/linuxmuster/linbo/repair_macct.py
```

## Usage

```bash
# Start worker
sudo systemctl start macct-worker

# Check status
sudo systemctl status macct-worker

# View logs
journalctl -u macct-worker -f

# Stop worker
sudo systemctl stop macct-worker
```

## Network Requirements

Open these ports from DC to LINBO Docker host:

| Port | Protocol | Service |
|------|----------|---------|
| 6379 | TCP | Redis |
| 3000 | TCP | API |

### Firewall Example (on DC)

```bash
# Allow outbound connections (usually already allowed)
iptables -A OUTPUT -p tcp -d 10.0.0.1 --dport 6379 -j ACCEPT
iptables -A OUTPUT -p tcp -d 10.0.0.1 --dport 3000 -j ACCEPT
```

### Firewall Example (on LINBO Docker host)

```bash
# Allow DC to connect to Redis and API
iptables -A INPUT -p tcp -s 10.0.0.11 --dport 6379 -j ACCEPT
iptables -A INPUT -p tcp -s 10.0.0.11 --dport 3000 -j ACCEPT
```

## Verification

```bash
# Test Redis connection
redis-cli -h 10.0.0.1 ping

# Test API connection
curl http://10.0.0.1:3000/health

# Check worker status
systemctl status macct-worker

# View recent jobs
journalctl -u macct-worker --since "1 hour ago"
```

## Troubleshooting

### Worker not starting

```bash
# Check logs
journalctl -u macct-worker -n 50

# Verify Python dependencies
python3 -c "import redis; import requests; print('OK')"

# Test configuration
python3 /usr/local/bin/macct-worker.py --verbose
```

### Connection refused to Redis

1. Check if Redis port is exposed in docker-compose.yml
2. Check firewall rules
3. Verify REDIS_HOST and REDIS_PORT in config

### API errors

1. Check API_URL in config
2. Verify API_KEY matches INTERNAL_API_KEY in LINBO Docker
3. Test: `curl -H "X-Internal-Key: your-key" http://IP:3000/health`

## Files

| File | Description |
|------|-------------|
| `macct-worker.py` | Main worker script |
| `macct-worker.service` | Systemd unit file |
| `macct-worker.conf.example` | Configuration template |
| `install.sh` | Installation script |

## Security Notes

- The API_KEY should be changed from default in production
- Consider using a firewall to restrict Redis access to DC only
- Logs may contain hostnames - protect `/var/log/macct`
- The worker runs as root (required for `ldbmodify`)
