# Deployment

AuctionHub is packaged as a single Node container that serves the API and frontend.

Rendered crawling needs Chromium. The starter Docker image installs the Node package; for heavier scraping in production, run ingestion as a separate worker/container with Playwright browser dependencies installed and keep the web/API service lightweight.

## Docker

```powershell
docker compose up --build
```

Open `http://localhost:4173`.

## GCP Cloud Run

```powershell
gcloud artifacts repositories create auctionhub --repository-format=docker --location=us-central1
gcloud builds submit --config cloudbuild.yaml --substitutions _REGION=us-central1,_REPOSITORY=auctionhub
```

For scheduled ingestion, use Cloud Scheduler to call:

```text
POST https://<service-url>/api/ingest
Authorization: Bearer <INGEST_TOKEN>
```

## AWS

Build and push the Docker image to ECR, then deploy with App Runner or ECS Fargate. `deploy/aws-apprunner.json` contains a starter App Runner service definition.

For scheduled ingestion, use EventBridge Scheduler to call `/api/ingest`, or run `node scripts/ingest.js` as a scheduled ECS task.

## Azure

Build and push the Docker image to Azure Container Registry, then deploy to Azure Container Apps using `deploy/azure-container-app.yaml`.

For scheduled ingestion, use Azure Functions Timer Trigger or Container Apps Jobs.

## Production Checklist

- Set a strong `INGEST_TOKEN`.
- Store secrets in Secret Manager, AWS Secrets Manager, or Azure Key Vault.
- Put listing data in a managed database for scale: Cloud SQL/Postgres, RDS, Azure Database for PostgreSQL, or Firestore/DynamoDB/Cosmos DB.
- Add CDN caching for images and static assets.
- Add monitoring on provider failures and rejected records.
- Add a scheduler for ingestion refreshes.
- Add per-provider rate limits and backoff policies.
