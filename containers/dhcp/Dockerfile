FROM alpine:3.19

RUN apk add --no-cache dnsmasq curl

COPY entrypoint.sh /entrypoint.sh
COPY reload.sh /reload.sh
RUN chmod +x /entrypoint.sh /reload.sh

EXPOSE 67/udp 4011/udp

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD pgrep dnsmasq || exit 1

ENTRYPOINT ["/entrypoint.sh"]
