# ---------- stage 1: build the React client ----------
FROM node:20-bookworm-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY client client
COPY shared shared
RUN npm run build -w client

# ---------- stage 2: runtime (Node server + Python scraper worker) ----------
FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Python (scraper only) and Tesseract (CAPTCHA OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    # Playwright's own installer pulls Chromium + every OS library it needs
    && playwright install --with-deps chromium

# Node production dependencies (server only)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server

COPY server server
COPY scraper scraper
COPY shared shared
COPY --from=client-build /app/client/dist client/dist

# Accounts and search history live here; mount a volume at /data to keep them across container restarts.
RUN mkdir -p /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    SCRAPER_HEADLESS=true \
    PYTHON_BIN=python3 \
    TRUST_PROXY=true \
    DATABASE_PATH=/data/iudicium.db

VOLUME /data

EXPOSE 8000
CMD ["node", "server/src/index.js"]
