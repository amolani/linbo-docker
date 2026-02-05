#!/usr/bin/env python3
"""
LINBO Docker - Machine Account Worker

This worker runs on the AD DC and consumes machine account repair jobs
from a Redis Stream. It has direct access to sam.ldb and executes
repair_macct.py locally.

Architecture:
- Connects to Redis Stream (linbo:jobs) via consumer group (dc-workers)
- Uses XREADGROUP for reliable job delivery
- Executes repair_macct.py with --only-hosts flag
- Reports status back to LINBO API
- XACK after successful processing
- Retry logic with exponential backoff
- Dead Letter Queue for permanently failed jobs

Requirements:
    pip install redis requests

Configuration via environment variables or config file:
    REDIS_HOST     - Redis server hostname
    REDIS_PORT     - Redis server port (default: 6379)
    REDIS_PASSWORD - Redis password (optional)
    API_URL        - LINBO API base URL
    API_KEY        - Internal API key for authentication
    CONSUMER_NAME  - Unique name for this consumer (default: hostname)
    LOG_DIR        - Directory for job logs (default: /var/log/macct)

Usage:
    python3 macct-worker.py [--config /path/to/config.conf]
"""

import os
import sys
import json
import time
import socket
import signal
import logging
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple

try:
    import redis
    import requests
except ImportError:
    print("Missing required packages. Install with: pip install redis requests")
    sys.exit(1)


# =============================================================================
# Configuration
# =============================================================================

class Config:
    """Worker configuration from environment or file"""

    def __init__(self, config_file: Optional[str] = None):
        self.redis_host = os.getenv('REDIS_HOST', 'localhost')
        self.redis_port = int(os.getenv('REDIS_PORT', '6379'))
        self.redis_password = os.getenv('REDIS_PASSWORD', None)
        self.redis_db = int(os.getenv('REDIS_DB', '0'))

        self.api_url = os.getenv('API_URL', 'http://localhost:3000/api/v1')
        self.api_key = os.getenv('API_KEY', 'linbo-internal-secret')

        self.consumer_name = os.getenv('CONSUMER_NAME', socket.gethostname())
        self.log_dir = Path(os.getenv('LOG_DIR', '/var/log/macct'))

        self.stream_name = 'linbo:jobs'
        self.consumer_group = 'dc-workers'
        self.dlq_stream = 'linbo:jobs:dlq'

        self.max_retries = 3
        self.block_timeout = 5000  # ms
        self.batch_size = 10
        self.min_idle_time = 300000  # 5 minutes - for claiming stuck jobs

        self.repair_script = '/usr/share/linuxmuster/linbo/repair_macct.py'

        if config_file:
            self._load_config_file(config_file)

        # Ensure log directory exists
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _load_config_file(self, path: str):
        """Load configuration from file"""
        config_path = Path(path)
        if not config_path.exists():
            logging.warning(f"Config file not found: {path}")
            return

        with open(config_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip().lower()
                    value = value.strip().strip('"\'')

                    if key == 'redis_host':
                        self.redis_host = value
                    elif key == 'redis_port':
                        self.redis_port = int(value)
                    elif key == 'redis_password':
                        self.redis_password = value if value else None
                    elif key == 'api_url':
                        self.api_url = value
                    elif key == 'api_key':
                        self.api_key = value
                    elif key == 'consumer_name':
                        self.consumer_name = value
                    elif key == 'log_dir':
                        self.log_dir = Path(value)
                    elif key == 'repair_script':
                        self.repair_script = value


# =============================================================================
# Logging
# =============================================================================

def setup_logging(log_dir: Path):
    """Configure logging to console and file"""
    log_file = log_dir / 'macct-worker.log'

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(log_file)
        ]
    )
    return logging.getLogger(__name__)


# =============================================================================
# Redis Client
# =============================================================================

class RedisClient:
    """Redis client wrapper with connection handling"""

    def __init__(self, config: Config):
        self.config = config
        self.client: Optional[redis.Redis] = None

    def connect(self) -> redis.Redis:
        """Connect to Redis server"""
        self.client = redis.Redis(
            host=self.config.redis_host,
            port=self.config.redis_port,
            password=self.config.redis_password,
            db=self.config.redis_db,
            decode_responses=True,
            socket_timeout=10,
            socket_connect_timeout=10,
            retry_on_timeout=True
        )
        # Test connection
        self.client.ping()
        return self.client

    def ensure_consumer_group(self):
        """Ensure consumer group exists"""
        try:
            self.client.xgroup_create(
                self.config.stream_name,
                self.config.consumer_group,
                id='$',
                mkstream=True
            )
            logging.info(f"Created consumer group: {self.config.consumer_group}")
        except redis.ResponseError as e:
            if 'BUSYGROUP' in str(e):
                logging.debug(f"Consumer group already exists: {self.config.consumer_group}")
            else:
                raise

    def read_jobs(self) -> List[Tuple[str, str, Dict[str, str]]]:
        """Read jobs from stream using consumer group"""
        entries = self.client.xreadgroup(
            groupname=self.config.consumer_group,
            consumername=self.config.consumer_name,
            streams={self.config.stream_name: '>'},
            count=self.config.batch_size,
            block=self.config.block_timeout
        )

        jobs = []
        if entries:
            for stream_name, messages in entries:
                for msg_id, fields in messages:
                    jobs.append((stream_name, msg_id, fields))
        return jobs

    def ack_job(self, msg_id: str):
        """Acknowledge a processed job"""
        self.client.xack(
            self.config.stream_name,
            self.config.consumer_group,
            msg_id
        )

    def move_to_dlq(self, fields: Dict[str, str], error: str):
        """Move failed job to Dead Letter Queue"""
        dlq_fields = {
            **fields,
            'last_error': error,
            'failed_at': datetime.now().isoformat()
        }
        self.client.xadd(self.config.dlq_stream, dlq_fields)

    def claim_stuck_jobs(self) -> List[Tuple[str, Dict[str, str]]]:
        """Claim jobs stuck in other consumers"""
        try:
            result = self.client.xautoclaim(
                self.config.stream_name,
                self.config.consumer_group,
                self.config.consumer_name,
                self.config.min_idle_time,
                start_id='0-0',
                count=self.config.batch_size
            )
            # Result format: [next_start_id, [[id, {fields}], ...], [deleted_ids]]
            if result and len(result) > 1:
                return [(msg[0], msg[1]) for msg in result[1]]
        except Exception as e:
            logging.warning(f"Error claiming stuck jobs: {e}")
        return []


# =============================================================================
# API Client
# =============================================================================

class APIClient:
    """Client for LINBO API communication"""

    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            'X-Internal-Key': config.api_key,
            'Content-Type': 'application/json'
        })

    def update_status(self, operation_id: str, status: str,
                      result: Optional[Dict] = None,
                      error: Optional[str] = None,
                      attempt: Optional[int] = None) -> bool:
        """Update operation status via API"""
        url = f"{self.config.api_url}/internal/operations/{operation_id}/status"

        payload = {'status': status}
        if result is not None:
            payload['result'] = result
        if error is not None:
            payload['error'] = error
        if attempt is not None:
            payload['attempt'] = attempt

        try:
            response = self.session.patch(url, json=payload, timeout=10)
            if response.status_code == 200:
                logging.debug(f"Updated status for {operation_id}: {status}")
                return True
            else:
                logging.error(f"API error {response.status_code}: {response.text}")
                return False
        except requests.RequestException as e:
            logging.error(f"API request failed: {e}")
            return False

    def retry_job(self, operation_id: str) -> bool:
        """Request job retry via API"""
        url = f"{self.config.api_url}/internal/operations/{operation_id}/retry"

        try:
            response = self.session.post(url, timeout=10)
            return response.status_code == 200
        except requests.RequestException as e:
            logging.error(f"Retry request failed: {e}")
            return False


# =============================================================================
# Job Processor
# =============================================================================

class JobProcessor:
    """Processes macct repair jobs"""

    def __init__(self, config: Config, api: APIClient):
        self.config = config
        self.api = api

    def process(self, msg_id: str, fields: Dict[str, str]) -> bool:
        """
        Process a single macct repair job

        Returns True if job was processed successfully (XACK should be called)
        """
        job_type = fields.get('type')
        operation_id = fields.get('operation_id')
        host = fields.get('host')
        school = fields.get('school', 'default-school')
        attempt = int(fields.get('attempt', '0'))

        logging.info(f"Processing job: {operation_id} (type={job_type}, host={host}, attempt={attempt})")

        # Only process macct_repair jobs
        if job_type != 'macct_repair':
            logging.warning(f"Unknown job type: {job_type}, skipping")
            return True  # ACK to remove from queue

        # Update status to running
        self.api.update_status(operation_id, 'running', attempt=attempt)

        # Execute repair script
        log_file = self.config.log_dir / f"{operation_id}.log"
        result = self._execute_repair(host, school, log_file)

        if result['success']:
            # Success - update status and return True for ACK
            self.api.update_status(
                operation_id,
                'completed',
                result=result['data']
            )
            logging.info(f"Job completed successfully: {operation_id}")
            return True
        else:
            # Failure - check retry count
            if attempt >= self.config.max_retries:
                # Max retries exceeded - mark as failed
                self.api.update_status(
                    operation_id,
                    'failed',
                    error=f"Max retries ({self.config.max_retries}) exceeded: {result['error']}"
                )
                logging.error(f"Job permanently failed: {operation_id}")
                return True  # ACK to remove from queue (already in DLQ via API)
            else:
                # Request retry via API (will re-queue the job)
                self.api.update_status(
                    operation_id,
                    'retrying',
                    error=result['error'],
                    attempt=attempt + 1
                )
                # Don't ACK - let API re-queue with incremented attempt
                # Actually, we should ACK and let API handle re-queue
                self.api.retry_job(operation_id)
                logging.warning(f"Job failed, requested retry: {operation_id} (attempt {attempt + 1})")
                return True

    def _execute_repair(self, host: str, school: str, log_file: Path) -> Dict[str, Any]:
        """Execute repair_macct.py script"""
        script = self.config.repair_script

        if not Path(script).exists():
            return {
                'success': False,
                'error': f"Repair script not found: {script}"
            }

        cmd = [
            'python3', script,
            '--only-hosts', host,
            '-s', school,
            '--log-file', str(log_file)
        ]

        logging.debug(f"Executing: {' '.join(cmd)}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )

            if result.returncode == 0:
                # Parse output for result data
                data = self._parse_output(result.stdout)
                return {
                    'success': True,
                    'data': data
                }
            else:
                return {
                    'success': False,
                    'error': result.stderr or f"Script exited with code {result.returncode}"
                }

        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': "Script execution timed out after 5 minutes"
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def _parse_output(self, stdout: str) -> Dict[str, Any]:
        """Parse repair script output for result data"""
        data = {
            'processed': True,
            'stdout_lines': len(stdout.splitlines()) if stdout else 0
        }

        # Look for specific markers in output
        if 'unicodePwd' in stdout:
            data['unicodePwd_updated'] = True
        if 'pwdLastSet' in stdout:
            data['pwdLastSet_fixed'] = True
        if 'skipped' in stdout.lower():
            data['skipped'] = True
        if 'no changes' in stdout.lower():
            data['no_changes'] = True

        return data


# =============================================================================
# Worker Main Loop
# =============================================================================

class MacctWorker:
    """Main worker class"""

    def __init__(self, config: Config):
        self.config = config
        self.running = False
        self.redis = RedisClient(config)
        self.api = APIClient(config)
        self.processor = JobProcessor(config, self.api)

        # Setup signal handlers
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _handle_signal(self, signum, frame):
        """Handle shutdown signals"""
        logging.info(f"Received signal {signum}, shutting down...")
        self.running = False

    def run(self):
        """Main worker loop"""
        logging.info(f"Starting macct worker: {self.config.consumer_name}")
        logging.info(f"Redis: {self.config.redis_host}:{self.config.redis_port}")
        logging.info(f"API: {self.config.api_url}")

        # Connect to Redis
        try:
            self.redis.connect()
            logging.info("Connected to Redis")
        except Exception as e:
            logging.error(f"Failed to connect to Redis: {e}")
            sys.exit(1)

        # Ensure consumer group exists
        self.redis.ensure_consumer_group()

        self.running = True
        stuck_job_check_time = time.time()

        while self.running:
            try:
                # Periodically check for stuck jobs (every 5 minutes)
                if time.time() - stuck_job_check_time > 300:
                    self._process_stuck_jobs()
                    stuck_job_check_time = time.time()

                # Read new jobs
                jobs = self.redis.read_jobs()

                if not jobs:
                    continue

                for stream_name, msg_id, fields in jobs:
                    try:
                        should_ack = self.processor.process(msg_id, fields)
                        if should_ack:
                            self.redis.ack_job(msg_id)
                    except Exception as e:
                        logging.error(f"Error processing job {msg_id}: {e}")
                        # Don't ACK - job will be retried

            except redis.ConnectionError as e:
                logging.error(f"Redis connection lost: {e}")
                time.sleep(5)
                try:
                    self.redis.connect()
                    logging.info("Reconnected to Redis")
                except Exception:
                    pass

            except Exception as e:
                logging.error(f"Unexpected error: {e}")
                time.sleep(1)

        logging.info("Worker stopped")

    def _process_stuck_jobs(self):
        """Claim and process stuck jobs from other consumers"""
        stuck = self.redis.claim_stuck_jobs()
        if stuck:
            logging.info(f"Claimed {len(stuck)} stuck jobs")
            for msg_id, fields in stuck:
                try:
                    should_ack = self.processor.process(msg_id, fields)
                    if should_ack:
                        self.redis.ack_job(msg_id)
                except Exception as e:
                    logging.error(f"Error processing stuck job {msg_id}: {e}")


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='LINBO Docker Machine Account Worker')
    parser.add_argument(
        '--config', '-c',
        help='Path to configuration file',
        default='/etc/macct-worker.conf'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )

    args = parser.parse_args()

    # Load configuration
    config = Config(args.config if Path(args.config).exists() else None)

    # Setup logging
    logger = setup_logging(config.log_dir)

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Create and run worker
    worker = MacctWorker(config)
    worker.run()


if __name__ == '__main__':
    main()
