# LINBO Boot Files Init Container
# Downloads boot files on first start

# Pinned 2026-03-06 — update periodically
FROM alpine:3.19.9

RUN apk add --no-cache \
    curl \
    tar \
    gzip \
    xz \
    zstd \
    dpkg \
    ca-certificates

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
