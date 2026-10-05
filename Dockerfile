# The browser-facing frontend image: static files plus the nginx reverse proxy.
# nginx serves pages itself and sends /api requests to the backend service, so the
# browser uses one origin for the entire application (decisions 0003 and 0034).
FROM nginx:1.31-alpine3.24

# Replace the image's root-owned default server with the project configuration.
# The static folders keep their repository paths, which makes browser URLs match
# imports and links used during development.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY pages /usr/share/nginx/html/pages
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

# nginx listens on an unprivileged port and writes temporary files under /tmp, so
# its master process and workers can both run as this ordinary account.
USER nginx

# Compose publishes container port 8080 as localhost:8080 by default.
EXPOSE 8080

# Check the same page a browser opens. BusyBox wget is included in the Alpine image.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/pages/sign-in.html"]

CMD ["nginx", "-g", "daemon off;"]
