FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /tool
COPY scripts/account-bundle.mjs ./account-bundle.mjs
ENTRYPOINT ["node", "account-bundle.mjs", "import", "--bundle", "/bundle/demo.enc", "--key", "/run/secrets/demo_bundle_key", "--uploads", "/uploads", "--supplemental", "/supplemental"]
