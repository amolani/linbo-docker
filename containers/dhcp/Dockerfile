FROM alpine:3.19

RUN apk add --no-cache dnsmasq curl inotify-tools

COPY entrypoint.sh /entrypoint.sh
COPY reload.sh /reload.sh
COPY watch-config.sh /watch-config.sh
RUN chmod +x /entrypoint.sh /reload.sh /watch-config.sh

EXPOSE 67/udp 4011/udp

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD pgrep dnsmasq || exit 1

ENTRYPOINT ["/entrypoint.sh"]
