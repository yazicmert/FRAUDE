# FRAUDE web API — çok aşamalı Docker imajı.
#
# Derleme bağlamı REPO KÖKÜDÜR (fraude-core path bağımlılığı nedeniyle):
#   fly deploy -c server/fly.toml     # repo kökünden çalıştırılır
#   docker build -f server/Dockerfile .

# ---- derleme ----
FROM rust:1-slim AS build
WORKDIR /app

COPY core ./core
COPY server ./server

WORKDIR /app/server
RUN cargo build --release

# ---- çalışma zamanı ----
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/server/target/release/fraude-server /usr/local/bin/fraude-server

ENV PORT=8080
ENV RUST_LOG=info
EXPOSE 8080
CMD ["fraude-server"]
