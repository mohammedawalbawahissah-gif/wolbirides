FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Blank = same-origin /api and /ws via this container's nginx (see nginx.conf).
ARG VITE_API_BASE_URL=""
ARG VITE_WS_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_WS_BASE_URL=$VITE_WS_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# nginx.conf is a template; the image fills in the ${...} values from these variables at start-up.
# Defaults suit docker compose. On Railway set BACKEND_ORIGIN and NGINX_RESOLVER (see deploy/RAILWAY.md).
ENV PORT=80 \
    BACKEND_ORIGIN=http://backend:8000 \
    NGINX_RESOLVER="127.0.0.11 ipv6=off"
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
