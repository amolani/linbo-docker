# LINBO Boot Files Init Container
# Downloads boot files on first start

FROM alpine:3.19

RUN apk add --no-cache \
    curl \
    tar \
    gzip \
    xz \
    ca-certificates

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
