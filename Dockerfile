FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_FILE=/app/data/listings.json
ENV PROVIDERS_FILE=/app/config/providers.json

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY app.js index.html styles.css ./
COPY scripts ./scripts
COPY src ./src
COPY config ./config
COPY data ./data

RUN node --check server.js \
  && node --check scripts/ingest.js \
  && node --check src/ingestion/pipeline.js \
  && node --check src/ingestion/adapters/websiteCrawler.js \
  && node --check app.js

EXPOSE 8080

CMD ["node", "server.js"]
