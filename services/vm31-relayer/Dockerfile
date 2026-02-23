# ── Stage 1: Builder ──────────────────────────────────────────────────────
FROM rust:1.83-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy dependency manifests first for layer caching
COPY libs/stwo-ml/Cargo.toml libs/stwo-ml/Cargo.toml
COPY services/vm31-relayer/Cargo.toml services/vm31-relayer/Cargo.toml

# Copy source
COPY libs/stwo-ml/ libs/stwo-ml/
COPY services/vm31-relayer/ services/vm31-relayer/

# Build with redis feature
RUN cd services/vm31-relayer && cargo build --release --features redis

# ── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/services/vm31-relayer/target/release/vm31-relayer /usr/local/bin/vm31-relayer

# Create cache directory for TreeSync
RUN mkdir -p /var/lib/vm31

ENV VM31_TREE_CACHE_PATH=/var/lib/vm31/tree_cache.json
EXPOSE 3080

ENTRYPOINT ["vm31-relayer"]
