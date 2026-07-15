# FRAUDE web API — çok aşamalı Docker imajı.
# Fly.io / Render / herhangi bir konteyner hostunda çalışır.

# ---- derleme ----
FROM rust:1-slim AS build
WORKDIR /app

# Önce manifest'i kopyalayıp bağımlılıkları önbelleğe al (katman cache).
COPY Cargo.toml ./
COPY Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release || true
RUN rm -rf src

# Gerçek kaynak.
COPY src ./src
RUN cargo build --release

# ---- çalışma zamanı ----
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/fraude-server /usr/local/bin/fraude-server

ENV PORT=8080
ENV RUST_LOG=info
EXPOSE 8080
CMD ["fraude-server"]
