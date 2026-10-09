# Pagina statica servita da nginx: nessun backend, il GPX resta nel browser.
FROM nginx:1.27-alpine

COPY index.html planner.js surface-osm.js i18n.js app.js manifest.webmanifest sw.js og-image.png /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons

EXPOSE 80
HEALTHCHECK --interval=60s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
