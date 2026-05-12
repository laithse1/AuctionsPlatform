# Security Policy

## Secrets

Never commit `.env` files, access tokens, API keys, or provider credentials. Use `.env.example` for documentation only.

Production secrets should live in:

- GCP Secret Manager
- AWS Secrets Manager
- Azure Key Vault
- Kubernetes Secrets

## Ingestion Endpoint

`POST /api/ingest` requires:

```text
Authorization: Bearer <INGEST_TOKEN>
```

Use a strong random token in production and rotate it regularly.

## Reporting Issues

This is currently a private project scaffold. Handle security issues privately until a public disclosure process is added.
