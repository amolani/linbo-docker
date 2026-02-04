#!/bin/bash
# =============================================================================
# LINBO Docker - SSH Container Entrypoint
# =============================================================================

set -e

# Create required directories
mkdir -p /var/run/sshd
mkdir -p /var/log/linuxmuster/linbo
mkdir -p /root/.ssh

# Generate SSH host keys if they don't exist
if [ ! -f /etc/linuxmuster/linbo/ssh_host_rsa_key ]; then
    echo "Generating SSH host keys..."
    ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/ssh_host_rsa_key -N ""
    ssh-keygen -t ed25519 -f /etc/linuxmuster/linbo/ssh_host_ed25519_key -N ""
fi

# Link SSH host keys to sshd config location
ln -sf /etc/linuxmuster/linbo/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key
ln -sf /etc/linuxmuster/linbo/ssh_host_rsa_key.pub /etc/ssh/ssh_host_rsa_key.pub

if [ -f /etc/linuxmuster/linbo/ssh_host_ed25519_key ]; then
    ln -sf /etc/linuxmuster/linbo/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key
    ln -sf /etc/linuxmuster/linbo/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub
fi

# Set correct permissions
chmod 600 /etc/ssh/ssh_host_*_key 2>/dev/null || true
chmod 644 /etc/ssh/ssh_host_*_key.pub 2>/dev/null || true

# Copy SSH config if exists
if [ -f /etc/linuxmuster/linbo/ssh_config ]; then
    cp /etc/linuxmuster/linbo/ssh_config /root/.ssh/config
    chmod 600 /root/.ssh/config
fi

# Make scripts executable
chmod +x /usr/share/linuxmuster/linbo/*.sh 2>/dev/null || true
chmod +x /usr/share/linuxmuster/helperfunctions.sh 2>/dev/null || true

# Link linbo-remote to sbin if exists
if [ -f /usr/share/linuxmuster/linbo/linbo-remote ]; then
    ln -sf /usr/share/linuxmuster/linbo/linbo-remote /usr/sbin/linbo-remote
    chmod +x /usr/sbin/linbo-remote
fi

# Create symlinks for linbo-ssh and linbo-scp
if [ -f /usr/share/linuxmuster/linbo/linbo-ssh.sh ]; then
    ln -sf /usr/share/linuxmuster/linbo/linbo-ssh.sh /usr/sbin/linbo-ssh
fi
if [ -f /usr/share/linuxmuster/linbo/linbo-scp.sh ]; then
    ln -sf /usr/share/linuxmuster/linbo/linbo-scp.sh /usr/sbin/linbo-scp
fi

echo "LINBO SSH Server starting..."
echo "Server IP: ${LINBO_SERVER_IP:-not set}"

# Execute the main command
exec "$@"
