# ---- Builder Stage ----
FROM rust:1.86-bookworm AS builder

WORKDIR /app

# Copy all source files
COPY . .

# Build the application in release mode
RUN cargo build --release

# ---- Runtime Stage ----
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /app/target/release/shift ./shift

# Copy config file
COPY config.yaml ./config.yaml

# Expose the application port
EXPOSE 8080

# Run the binary with CLI args to ensure correct Docker networking
# --listen 0.0.0.0 binds to all interfaces so the container is reachable
# --database-url uses the Docker service name "postgres" for DNS resolution
CMD ["./shift", "serve", "--listen", "0.0.0.0", "--database-url", "postgresql://postgres:postgres@postgres:5432/shift"]
