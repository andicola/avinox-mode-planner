# Pagina statica servita da nginx: nessun backend, il GPX resta nel browser.
FROM nginx:1.27-alpine

COPY index.html planner.js /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=60s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
