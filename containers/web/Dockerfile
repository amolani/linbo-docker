# =============================================================================
# LINBO Docker - Web Frontend
# React + Nginx (Placeholder - to be built)
# =============================================================================
FROM nginx:alpine

LABEL maintainer="LINBO Docker Project"
LABEL description="Web Frontend for LINBO"

# Copy placeholder page
COPY index.html /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
