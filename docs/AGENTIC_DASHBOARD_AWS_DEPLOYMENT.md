# MSFG Agentic AI Dashboard — AWS Deployment Plan

**Status: plan only. Nothing in this document is deployed yet.**

Covers environments, hosting, database, S3, Cognito, secrets, logging, security, deployment steps, rollback, and cost estimates for the dashboard (`apps/web` SPA + `apps/api` Express/LangGraph.js service + Postgres + S3 + Cognito).

---

## 1. Environments

| Env | Purpose | Data policy | Auth mode | AWS account / tagging |
|---|---|---|---|---|
| **local** | Day-to-day dev (Docker Postgres, mock model provider) | Synthetic only — never borrower data | Dev-mode header auth | None (local machine) |
| **dev** | Shared integration testing in AWS | Synthetic only | Cognito (dev user pool) | Non-prod account or `env=dev` tags |
| **staging** | Pre-prod validation, migration rehearsal | Synthetic preferred; sanitized realistic data only with ops sign-off | Cognito (mirrors prod pool config) | Same account as prod acceptable, `env=staging` tags |
| **prod** | Live internal use (~10–30 users) | Real operational data; borrower PII handled per MSFG policy | Cognito (prod user pool, MFA recommended) | Dedicated account if possible; `env=prod`, `app=agentic-dashboard`, `owner=ops` tags |

Two AWS accounts (non-prod / prod) is the recommended minimum split; if MSFG runs a single account today, strict tagging + separate IAM roles per env is the fallback.

## 2. Hosting Options

| Option | Ops burden | Cost | Long-running LangGraph runs | MSFG familiarity fit |
|---|---|---|---|---|
| (a) S3+CloudFront SPA + API on EC2/ECS | Low (SPA is static) + medium (API host) | Low | Good — persistent process | Good |
| (b) Full EC2 (SPA + API on instances) | High (patching, web server, scaling by hand) | Low–medium | Good | OK, but unnecessary ops for a static SPA |
| (c) ECS/Fargate for API | Low–medium (no host patching, managed scaling) | Low–medium | Good — long-lived containers | Good if Docker is already in use locally (it is) |
| (d) Lambda + API Gateway | Low | Lowest at low traffic | **Poor** — 15-min hard cap, cold starts, in-process LangGraph state and streaming fit badly | Weak fit for this API |

**Recommendation:**
- **Frontend:** S3 + CloudFront. The SPA is static files; this is the cheapest, lowest-ops option with trivial rollback.
- **API:** a **single ECS Fargate service** (1 task to start, 2 for prod availability) behind an ALB. The API is already a Dockerized long-lived Node process with LangGraph embedded in-process — Fargate runs that as-is with no instance management. **Alternative:** one EC2 instance running the same Docker image is acceptable if that matches existing MSFG ops habits; trade managed infra for familiarity.
- **Lambda:** reserve for future inbound **webhook receivers** (Monday.com, GHL) that just validate and enqueue — not for the core API.

## 3. Database — RDS Postgres

- **dev/staging:** RDS Postgres, single-AZ, `db.t4g.micro`.
- **prod:** RDS Postgres, **multi-AZ**, `db.t4g.small` (resize as needed), automated backups on, deletion protection on.
- Plain SQL migrations (already the project convention); see deployment steps §9.

Why a relational database, not flat files / S3 alone:
1. **Transactions:** audit events must commit atomically with state changes; impossible with S3 object writes.
2. **FK integrity for approval gating:** the execute path depends on a verifiable `ai_integration_actions → ai_approvals` link enforced by the database, not application convention.
3. **Audit queries:** compliance review needs filtered, joined queries across runs/outputs/approvals/events.
4. **Concurrent writes:** multiple staff updating queue/review state simultaneously needs row-level locking and consistent reads.

S3 remains the right store for **documents** (large binaries); Postgres holds metadata, text chunks, and all state.

## 4. S3 Usage

One bucket per environment, e.g. `msfg-agentic-dashboard-{env}`:

| Prefix | Contents | Lifecycle |
|---|---|---|
| `source-documents/` | Uploaded borrower/SOP/guideline docs (keys recorded in `ai_source_documents`) | Transition to S3 Standard-IA after 90 days; no expiry (retention per MSFG policy) |
| `extracted-text/` | Extraction/OCR outputs | IA after 90 days |
| `exports/` | Generated exports (audit CSVs, reports) | **Expire after 30 days** |

- **Encryption:** SSE-S3 minimum; **SSE-KMS with a customer-managed key for prod** (borrower PII), key access limited to the API task role.
- **Access:** Block Public Access on; bucket policy denies non-TLS; all client access via **time-limited signed URLs** issued by the API after auth/role checks. No direct browser-to-bucket access.
- Versioning enabled on `source-documents/` to protect against accidental overwrite.

## 5. Cognito

- One **user pool per environment**; one **app client** for the SPA (no client secret, **Authorization Code + PKCE**). Hosted UI is the low-effort default; a custom-branded SPA login via the same PKCE flow is an acceptable later upgrade.
- **Groups:** `admin`, `reviewer`, `operator`, `viewer` — mapped 1:1 to app roles.
- **Token → role mapping:** API verifies the JWT (issuer, audience, expiry) and reads `cognito:groups`; highest group wins (`viewer < operator < reviewer < admin`). Identity stored in rows as the Cognito `sub`/email text (no users table in MVP).
- Local dev keeps header-based auth; that code path is **disabled unless `NODE_ENV` is local/dev-mode flagged**, and never enabled in AWS.

## 6. Secrets & Configuration

| Item | Where |
|---|---|
| DB credentials | **Secrets Manager** (use RDS-managed rotation where possible) |
| Anthropic API key | **Secrets Manager** |
| Future integration tokens (Monday.com, GHL, Gmail) | Secrets Manager, one secret per integration |
| Non-secret config (bucket names, Cognito pool/client IDs, feature flags, `MODEL_PROVIDER`) | **SSM Parameter Store** |
| Local dev | `.env` (gitignored); see `.env.example` (created separately by the main build) |

Rules: **never in the repo**, never in Docker images, never in CloudWatch logs. ECS task definitions reference secrets by ARN; the task role gets `GetSecretValue` on exactly those ARNs.

## 7. Logging & Monitoring

- **CloudWatch Logs** for API containers: structured JSON lines with request IDs, user sub, route, latency, status. **No prompt/output bodies or borrower PII in logs** — the audit trail lives in Postgres (`ai_audit_events`), not CloudWatch. CloudWatch is operational telemetry only.
- Log retention: 30 days dev, 90 days prod.
- **Alarms:**
  - ALB 5xx rate above threshold (5 min)
  - RDS connection count / CPU / free storage
  - ECS task restarts / failed deployments
  - AI run failure rate (custom metric emitted on `run.failed`)
- **AI cost monitoring:** `ai_task_runs` stores input/output token counts per run. A monthly report query (tokens × provider pricing, grouped by workflow and user) feeds a simple cost summary; Phase 3 adds a dashboard. Set a CloudWatch billing alarm as a backstop.

## 8. Security

- **IAM least privilege per service:** API task role gets only its bucket prefixes, its secret ARNs, its SSM path; CI deploy role gets only ECR push + ECS update + S3 sync + CloudFront invalidation.
- S3 private, signed URLs only (§4).
- **Encryption at rest:** RDS storage encryption (KMS), S3 SSE-KMS (prod), Secrets Manager (KMS by default).
- **TLS everywhere:** ACM certificates on CloudFront and ALB; HTTP→HTTPS redirect; RDS connections with `sslmode=require`.
- API in private subnets; RDS in private subnets, security group allowing only the API service; no public DB endpoint.
- **RDS automated backups** (7 days dev, 30 days prod) + manual snapshot before every migration and before any destructive ops work.
- Restore runbook: see **Backup/restore checklist** below (treat as the runbook pointer until a dedicated runbook doc exists).

## 9. Deployment Steps

**Frontend (SPA)**
1. `npm run build` in `apps/web` (env-specific config baked via Vite env vars).
2. `aws s3 sync dist/ s3://msfg-agentic-dashboard-web-{env}/ --delete` (keep prior build artifact versioned/archived for rollback).
3. CloudFront invalidation (`/*` or hashed-asset-aware `/index.html`).

**Backend (API + LangGraph)**
1. Docker build `apps/api` (LangGraph.js is in-process — **it deploys with the API image; there is no separate workflow service**).
2. Tag with git SHA, push to ECR.
3. Register new ECS task definition pointing at the new image tag.
4. **Run the DB migration job first** (one-off ECS task or CI step running the SQL migrations) — see below.
5. Update the ECS service to the new task definition; wait for healthy targets on the ALB.

**DB migrations**
- Plain SQL, run via a migration job **before** the new task definition goes live.
- Migrations must be **additive/backward-compatible**: old code must run correctly against the new schema (add columns nullable/defaulted; never drop/rename in the same release as the code change).
- Take an RDS snapshot before running prod migrations.

## 10. Rollback Plan

| Layer | Rollback |
|---|---|
| Frontend | Re-sync the previous build artifact to S3 + CloudFront invalidation (keep last N builds archived) |
| Backend | Point the ECS service back at the previous task definition / image tag (one command; images are immutable in ECR) |
| Database | Migrations are additive, so previous app versions run on the new schema — **no schema rollback in the normal path**. Destructive cleanup ships in a later release after code no longer references the old shape. Catastrophic recovery: restore from the pre-migration snapshot (accepting data loss back to snapshot time — last resort only). |

## 11. Estimated Monthly Cost (small internal use, ~10–30 users)

| Item | Sizing assumption | Low | High |
|---|---|---|---|
| ECS Fargate (API) | 0.25–0.5 vCPU, 0.5–1 GB, 1–2 tasks, always on | $10 | $40 |
| ALB | 1 ALB, light traffic | $18 | $25 |
| RDS Postgres | t4g.micro single-AZ (dev) → t4g.small multi-AZ (prod) | $15 | $70 |
| S3 | <50 GB docs + requests | $2 | $10 |
| CloudFront | Internal traffic, low GB | $1 | $5 |
| Cognito | <50 MAU | $0 (free tier) | $0 |
| Secrets Manager | 3–6 secrets | $2 | $4 |
| CloudWatch | Logs + a few alarms + custom metrics | $5 | $20 |
| **AWS infra total** | | **~$55** | **~$175** |

> **LLM API spend is separate, usage-based, and will likely dominate** once real workloads run — track via token counts in `ai_task_runs` (§7) and review monthly. Even moderate daily use can exceed the entire AWS infra bill.

Numbers are planning estimates (us-east-1 class pricing, mid-2026); validate against current pricing before budgeting.

## 12. Deployment Checklist

- [ ] AWS account(s) selected; tags agreed (`app`, `env`, `owner`)
- [ ] VPC with public (ALB) and private (ECS, RDS) subnets
- [ ] ECR repo created; CI role can push
- [ ] RDS instance provisioned (encrypted, private, backups on); credentials in Secrets Manager
- [ ] S3 buckets created (web hosting bucket + documents bucket with prefixes, lifecycle, encryption, Block Public Access)
- [ ] Cognito user pool, app client (PKCE), groups `admin/reviewer/operator/viewer`; initial users assigned
- [ ] Secrets Manager: DB creds, Anthropic API key; SSM parameters for non-secret config
- [ ] ACM certificates issued; CloudFront distribution + ALB HTTPS listeners configured
- [ ] ECS cluster, task definition (secrets by ARN), service behind ALB; health check on `/api/ai/health`
- [ ] Migration job runs all SQL migrations successfully against the env DB
- [ ] Frontend built with env config, synced to S3, CloudFront invalidated
- [ ] Smoke test: login via Cognito, create task, run workflow in mock mode, approve, verify audit events
- [ ] CloudWatch alarms wired to a notification channel (email/Slack)
- [ ] Dev-mode header auth confirmed disabled in deployed envs
- [ ] Confirm no secrets in repo/images; `.env` gitignored; `.env.example` current

## 13. Backup/Restore Checklist

**Backups**
- [ ] RDS automated backups enabled (7 days dev, 30 days prod) and verified in console
- [ ] Manual snapshot taken before every prod migration (named `pre-migration-{date}-{sha}`)
- [ ] S3 versioning enabled on `source-documents/`
- [ ] Quarterly: restore latest prod snapshot into a scratch instance and verify row counts / recent audit events (restore drill)

**Restore (incident)**
1. [ ] Freeze writes: scale API service to 0 (or enable maintenance mode)
2. [ ] Identify target restore point (snapshot or point-in-time)
3. [ ] Restore to a **new** RDS instance; never overwrite the live one
4. [ ] Validate restored data (schema version, latest `ai_audit_events`, approval integrity spot checks)
5. [ ] Update the DB secret/endpoint config to the restored instance; restart API tasks
6. [ ] Smoke test the approval gating path before reopening to users
7. [ ] Record the incident and data-loss window; notify ops manager
