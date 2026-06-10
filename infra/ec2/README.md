# EC2 deployment (cheapest track)

Runs the stack — API + Postgres in Docker — on an EC2 box you already pay
for. AWS adds only DNS, Cognito (free), and an optional S3 bucket:
**≈ $0/mo of new spend**. A t3a.medium (2 vCPU / 4 GB) is plenty.

Two front-door modes (check with `sudo ss -tlnp '( sport = :80 or sport = :443 )'`):

- **Mode A — host nginx already owns 80/443** (typical when the box
  serves an existing website): nginx serves the SPA and proxies
  `/api/` → the API container on `127.0.0.1:4000`; certbot adds TLS.
- **Mode B — ports free:** the bundled Caddy container does TLS + SPA +
  proxy (`--profile caddy`).

```
Mode A:  Browser ── https://agentic.zvzsolutions.com ──▶ host nginx (TLS)
                                                          ├── /api/ ──▶ 127.0.0.1:4000 (api container)
                                                          └── /*    ──▶ /var/www/agentic (SPA files)
                          api container ──▶ postgres container (never exposed)
```

Same containers, approval gates, and audit trail as the managed track
(`infra/terraform`). Requires terraform >= 1.5 locally.

## 1. AWS pieces (laptop, ~2 min)

```bash
cd infra/ec2/terraform
cp terraform.tfvars.example terraform.tfvars   # confirm ec2_public_ip
terraform init && terraform plan && terraform apply
terraform output                               # keep these values handy
```

Creates the `agentic.zvzsolutions.com` A record → your box, the Cognito
pool/client/groups, and (optional) a documents/backups bucket + IAM policy.

> Confirm the box has an **Elastic IP** (EC2 console → Elastic IPs). The
> auto-assigned public IP changes on stop/start and would break this record.

## 2. On the box — containers

```bash
git clone https://github.com/vonzink/agentic-dashboard.git
cd agentic-dashboard/infra/ec2
cp .env.example .env
nano .env       # POSTGRES_PASSWORD (openssl rand -hex 24), ACME_EMAIL,
                # the four (tf) cognito values, LLM key + MODEL_PROVIDER

docker compose --env-file .env up -d --build      # postgres + api (Mode A)
docker compose run --rm api node dist/db/migrate.js
docker compose run --rm api node dist/db/seed.js
curl -s http://127.0.0.1:4000/api/ai/health        # expect {"status":"ok",...}
```

(Mode B instead: append `--profile caddy` to the `up` command and skip §3.)

## 3. On the box — nginx front door (Mode A)

```bash
./build-spa.sh                                     # SPA → ./spa (containerized build)
sudo mkdir -p /var/www/agentic
sudo rsync -a --delete spa/ /var/www/agentic/

sudo cp nginx-agentic.conf /etc/nginx/sites-available/agentic.zvzsolutions.com
sudo ln -s /etc/nginx/sites-available/agentic.zvzsolutions.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS (after the DNS record from §1 has propagated — a few minutes):
sudo apt install -y certbot python3-certbot-nginx   # if not present
sudo certbot --nginx -d agentic.zvzsolutions.com
```

Your existing MSFG site is untouched — this is a separate `server_name`
vhost. `https://agentic.zvzsolutions.com` should now answer.

## 4. Users (laptop)

```bash
POOL=$(cd infra/ec2/terraform && terraform output -raw cognito_user_pool_id)
aws cognito-idp admin-create-user --user-pool-id "$POOL" \
  --username you@zvzsolutions.com --user-attributes Name=email,Value=you@zvzsolutions.com
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" \
  --username you@zvzsolutions.com --group-name admin
# repeat per staff member with operator / reviewer / viewer
```

## 5. Backups (do not skip — the audit trail lives on this box)

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
docker compose --env-file .env up -d --build api
docker compose run --rm api node dist/db/migrate.js
# UI changed? rebuild + redeploy the SPA:
./build-spa.sh && sudo rsync -a --delete spa/ /var/www/agentic/
```

## Ops crib sheet

```bash
docker compose ps                      # status
docker compose logs -f api             # structured JSON logs (request ids)
sudo tail -f /var/log/nginx/access.log # front-door traffic
docker compose down                    # stop (volumes/data persist)
```

## Trade-offs vs the managed track (infra/terraform)

You're accepting: single box (host down = dashboard down), self-managed
Postgres (cron backups instead of RDS point-in-time recovery), and OS/
Docker/nginx patching is on you. Reasonable for a solo-operator pilot;
when MSFG staff depend on it daily, the managed track is one
`terraform apply` away and the database moves with one dump/restore.
