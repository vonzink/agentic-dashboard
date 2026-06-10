# EC2 deployment (cheapest track)

Runs the whole stack — API, Postgres, and Caddy (automatic Let's Encrypt
TLS) — in Docker on an EC2 box you already pay for. AWS adds only DNS,
Cognito (free), and an optional S3 bucket: **≈ $0/mo of new spend**.
A t3a.medium (2 vCPU / 4 GB) is more than enough.

```
Browser ── https://agentic.zvzsolutions.com ──▶ Caddy (TLS, :443)
                                                 ├── /api/* ──▶ api container :4000
                                                 └── /*     ──▶ SPA static files
                                                 api ──▶ postgres container (not exposed)
```

One hostname, one cert, no ALB/Fargate/RDS. Same container, same approval
gates, same audit trail as the managed track.

## 0. Pre-flight (once, on the box)

```bash
ssh -i <your-key.pem> ubuntu@<EC2_IP>

# Docker present?
docker --version || (curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu && exit)
# (log out/in after usermod so 'ubuntu' can run docker)

# Are ports 80/443 free? MUST print nothing:
sudo ss -tlnp '( sport = :80 or sport = :443 )'
```

**If 80/443 are taken** (an existing nginx/apache site lives here), don't
fight it — two options: (a) terminate TLS in the existing nginx instead of
Caddy: proxy `agentic.zvzsolutions.com` → `127.0.0.1:8443`, change the
caddy ports in docker-compose.yml to `"8080:80"`/`"8443:443"`, and use
certbot on the host nginx; or (b) put the dashboard on a different small
instance. Ask before improvising — TLS routing mistakes look like login
bugs.

**EC2 security group:** inbound 80 + 443 from 0.0.0.0/0 (Let's Encrypt
needs 80), SSH restricted to your IP. **Static IP:** if the box doesn't
have an Elastic IP, allocate + associate one (free while attached) so DNS
doesn't break on a stop/start.

## 1. AWS pieces (from your laptop)

```bash
cd infra/ec2/terraform
cp terraform.tfvars.example terraform.tfvars   # confirm ec2_public_ip
terraform init && terraform plan && terraform apply
terraform output                               # keep these handy
```

Creates: the `agentic.zvzsolutions.com` A record → your box, the Cognito
pool/client/groups, and (optional) the documents/backups bucket + an IAM
policy you can attach to the instance role.

## 2. On the box

```bash
git clone https://github.com/vonzink/agentic-dashboard.git
cd agentic-dashboard/infra/ec2
cp .env.example .env
nano .env       # POSTGRES_PASSWORD (openssl rand -hex 24), ACME_EMAIL,
                # the three (tf) cognito values, and your LLM key + MODEL_PROVIDER

docker compose --env-file .env up -d --build postgres api
docker compose run --rm api node dist/db/migrate.js
docker compose run --rm api node dist/db/seed.js

./build-spa.sh                                  # builds SPA into ./spa
docker compose --env-file .env up -d            # starts caddy (gets the cert)
```

DNS + cert need the A record live (step 1) — give it a few minutes, then
`https://agentic.zvzsolutions.com` should answer.

## 3. Users (from your laptop)

```bash
POOL=$(cd infra/ec2/terraform && terraform output -raw cognito_user_pool_id)
aws cognito-idp admin-create-user --user-pool-id "$POOL" \
  --username you@zvzsolutions.com --user-attributes Name=email,Value=you@zvzsolutions.com
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" \
  --username you@zvzsolutions.com --group-name admin
# repeat per staff member with operator / reviewer / viewer
```

## 4. Backups (do not skip — the audit trail lives on this box)

```bash
crontab -e
# 15 8 * * * cd /home/ubuntu/agentic-dashboard/infra/ec2 && ./backup.sh >> backups/backup.log 2>&1
```

Nightly `pg_dump`, 14 local copies; with `S3_BUCKET` set in .env (and the
terraform `documents_bucket_policy_arn` attached to the instance role) it
also copies to S3 with a 30-day lifecycle. Restore:
`gunzip -c backups/<file>.sql.gz | docker compose exec -T postgres psql -U agentic agentic_dashboard`.

## Releases

```bash
cd ~/agentic-dashboard && git pull
cd infra/ec2
docker compose --env-file .env up -d --build api   # rebuild + restart API
docker compose run --rm api node dist/db/migrate.js
./build-spa.sh                                      # only when the UI changed
```

## Ops crib sheet

```bash
docker compose ps                      # status
docker compose logs -f api             # structured JSON logs (request ids)
docker compose restart caddy           # after editing Caddyfile / spa
docker compose down                    # stop (volumes/data persist)
```

## Trade-offs vs the managed track (infra/terraform)

You're accepting: single box (host down = dashboard down), self-managed
Postgres (cron backups instead of RDS point-in-time recovery), and OS/
Docker patching is on you (`sudo apt update && sudo apt upgrade`,
`docker compose pull`). For a solo-operator pilot that's reasonable; when
MSFG staff depend on it daily, the managed track is one `terraform apply`
away and the database moves with one dump/restore.
