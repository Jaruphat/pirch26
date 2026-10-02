# PIRCH26 — LAN server image (Node 22, no npm dependencies)
FROM node:22-alpine
WORKDIR /app
COPY public ./public
COPY server ./server
RUN chmod -R a+rX /app/public /app/server && mkdir -p /app/data && chown node:node /app/data
ENV PORT=8080 DATA_DIR=/app/data NODE_NO_WARNINGS=1
EXPOSE 8080
VOLUME ["/app/data"]
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/config.js >/dev/null || exit 1
CMD ["node", "server/server.js"]
