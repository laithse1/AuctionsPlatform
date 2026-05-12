# Production Readiness

AuctionHub is now production-shaped, not fully production-complete. This document tracks what must be true before a real public launch.

## Ready

- Containerized Node app.
- Playwright-capable Docker base image.
- API health endpoint.
- Provider health endpoint.
- Protected ingestion endpoint.
- Source adapter architecture.
- Rendered and static crawler adapters.
- Provider-level result reporting.
- Basic automated parser/intelligence tests.
- GitHub Actions CI starter.
- Cloud deployment starter files for GCP, AWS, Azure, and Kubernetes.

## Required Before Public Launch

| Area | Requirement |
| --- | --- |
| Storage | Replace `data/listings.json` with Postgres, Firestore, DynamoDB, or another managed store |
| Workers | Run ingestion separately from the web/API container |
| Scheduling | Add Cloud Scheduler, EventBridge Scheduler, Azure Jobs, or a queue-based scheduler |
| Observability | Add structured logs, provider metrics, alerting, dashboards, and failed-run notifications |
| Tests | Expand parser fixtures for every provider and add API/integration tests |
| Source hardening | Add source-specific selectors, network-response parsing, pagination, and detail-page crawling |
| Auth | Add user accounts for saved searches/watchlists and admin-only ingestion controls |
| Security | Move secrets to cloud secret managers; rotate `INGEST_TOKEN`; add rate limiting |
| Data quality | Add stale listing cleanup, duplicate merge rules, fee calculators, VIN decoding, and price history |
| Resilience | Add retries, exponential backoff, circuit breakers, and provider-specific throttles |

## Recommended Production Architecture

```text
Cloud Scheduler
      |
      v
Ingestion Worker ----> Provider pages / feeds
      |
      v
Database + object storage
      |
      v
API service ----> Web app / mobile app
      |
      v
Logs, metrics, alerts
```

The current single-container setup is appropriate for demos, prototypes, and early internal validation.
