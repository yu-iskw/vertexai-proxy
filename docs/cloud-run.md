# Host the proxy on Cloud Run

Use this when Cursor should call the proxy on a public HTTPS URL.

Your Google Cloud project already has these APIs enabled.

- Cloud Run
- Artifact Registry
- Secret Manager
- IAM Credentials
- Vertex AI

Your project already has a deployer service account, a runtime service account, a Vertex service account, and a Secret Manager secret. The secret value is the proxy bearer. Use a bearer of at least 16 characters.

The Terraform stack does not create service accounts. The stack does not enable APIs.

## Build and push the image

Build from the repository root and push the image to Artifact Registry.

```bash
docker build -t REGION-docker.pkg.dev/PROJECT/REPO/vertexai-proxy:TAG .
docker push REGION-docker.pkg.dev/PROJECT/REPO/vertexai-proxy:TAG
```

Set `image` in the variables file to that URL.

## Apply the stack

Copy the example variables and replace the placeholders.

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
terraform -chdir=infra init
terraform -chdir=infra apply
```

The Google provider impersonates `deployer_service_account_email`. The source credentials are the caller's Application Default Credentials.

Apply grants the runtime service account `roles/iam.serviceAccountTokenCreator` on the Vertex service account and `roles/secretmanager.secretAccessor` on the secret. The token-creator resource id is `projects/PROJECT/serviceAccounts/EMAIL`. Terraform takes PROJECT from the Vertex account email, so that account can live in another project. The service sets `PROXY_HOST` to `0.0.0.0` and leaves `PROXY_PORT` unset. Cloud Run sets `PORT` to 8080, which the proxy then uses as the listen port.

`deletion_protection` is false on the Cloud Run service.

## Configure Cursor

Use the `cursor_base_url` output as Cursor's base URL. Use the secret value as the API key. Terraform does not store that value.

`GET /healthz` is unauthenticated.
