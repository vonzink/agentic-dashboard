# Infrastructure (Terraform)

Provisions everything in docs/AGENTIC_DASHBOARD_AWS_DEPLOYMENT.md: VPC,
ALB + ECS Fargate API, RDS Postgres 16, private documents bucket,
SPA bucket + CloudFront, Cognito user pool (+ viewer/operator/reviewer/
admin groups), Secrets Manager, CloudWatch logs, least-privilege IAM.

> Authored and `terraform validate`d, but **not yet applied to a real AWS
> account** — review the plan output carefully on first apply.

## First bring-up

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # edit: region, CIDRs, domain prefix
terraform init
terraform plan
terraform apply
```

Then, in order:

```bash
# 1. Real Anthropic key (placeholder was created by terraform)
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw anthropic_api_key_secret)" \
  --secret-string 'sk-ant-...'

# 2. Build & push the API image
aws ecr get-login-password | docker login --username AWS \
  --password-stdin "$(terraform output -raw ecr_repository_url | cut -d/ -f1)"
docker build -t "$(terraform output -raw ecr_repository_url):latest" apps/api
docker push "$(terraform output -raw ecr_repository_url):latest"

# 3. Run migrations (one-off Fargate task; additive-only migrations)
aws ecs run-task \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --task-definition "$(terraform output -raw migrate_task_definition)" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json public_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw api_security_group_id)],assignPublicIp=ENABLED}"
# seeds: same command with --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/db/seed.js"]}]}'

# 4. Roll the API service
aws ecs update-service --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service api --force-new-deployment

# 5. Build & publish the SPA
cat > apps/web/.env.production <<EOF
VITE_ENV=dev
VITE_AUTH_MODE=cognito
VITE_COGNITO_DOMAIN=https://$(terraform output -raw cognito_hosted_domain).auth.$(terraform output -raw cognito_user_pool_id | cut -d_ -f1).amazoncognito.com
VITE_COGNITO_CLIENT_ID=$(terraform output -raw cognito_client_id)
VITE_COGNITO_REDIRECT_URI=$(terraform output -raw app_url)
EOF
(cd apps/web && npm run build)
aws s3 sync apps/web/dist "s3://$(terraform output -raw spa_bucket)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform output -raw cloudfront_distribution_id)" --paths '/*'

# 6. Create staff users + assign groups
aws cognito-idp admin-create-user --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --username someone@msfg.com --user-attributes Name=email,Value=someone@msfg.com
aws cognito-idp admin-add-user-to-group --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --username someone@msfg.com --group-name operator
```

With the custom domain enabled, `https://agentic.zvzsolutions.com` is
already in `cognito_callback_urls` via terraform.tfvars — nothing to add
after the fact. (Without a domain, add the `cloudfront_domain` output to
the callback/logout lists and re-apply.)

**Custom domain (default: zvzsolutions.com).** With `route53_zone_name`
set, terraform creates ACM certs (DNS-validated automatically), A-aliases
for `app_hostname` → CloudFront and `api_hostname` → ALB, and a CloudFront
`/api/*` behavior that forwards to the ALB — so the SPA and API share one
origin (`https://agentic.zvzsolutions.com`) with no CORS and no API base
URL to configure. Set `route53_zone_name = ""` to fall back to the bare
CloudFront/ALB hostnames.

## Releases

1. Build + push image with a new tag, `terraform apply -var api_image_tag=<tag>`
   (or update the service with a new task definition revision via CI).
2. Run the migrate task (step 3 above). Migrations are additive within a
   release — see docs/AGENTIC_DASHBOARD_DATABASE.md.
3. `aws ecs update-service ... --force-new-deployment`.
4. SPA: build, `s3 sync`, invalidate.

Rollback: previous image tag + previous task definition revision; SPA by
re-syncing the previous build. RDS keeps 7 days of automated backups;
snapshot before any migration you're unsure about.

## Costs (small internal use)

ALB ~$16/mo + Fargate 0.5 vCPU ~$18/mo + RDS t4g.micro ~$13/mo + storage/
logs/CloudFront a few dollars ≈ **$50–70/mo** infra. LLM API spend is
usage-based on top (tracked on the dashboard's usage panel).
