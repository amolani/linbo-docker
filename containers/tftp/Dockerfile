# =============================================================================
# LINBO Docker - TFTP Server
# Provides PXE boot files (kernel, initramfs, GRUB)
# =============================================================================
FROM ubuntu:24.04

LABEL maintainer="LINBO Docker Project"
LABEL description="TFTP Server for LINBO PXE Boot"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install TFTP server
RUN apt-get update && apt-get install -y --no-install-recommends \
    tftpd-hpa \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /srv/linbo

# Configure TFTP
COPY tftpd-hpa.conf /etc/default/tftpd-hpa

# TFTP uses UDP port 69
EXPOSE 69/udp

# Run TFTP in foreground
CMD ["in.tftpd", "-L", "-u", "tftp", "-a", "0.0.0.0:69", "-s", "/srv/linbo", "--verbosity", "3"]
