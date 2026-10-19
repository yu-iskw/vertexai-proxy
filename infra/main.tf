module "vertexai_proxy" {
  source = "./modules/vertexai-proxy"

  project_id                    = var.project_id
  location                      = var.location
  service_name                  = var.service_name
  image                         = var.image
  runtime_service_account_email = var.runtime_service_account_email
  vertex_service_account_email  = var.vertex_service_account_email
  proxy_api_key_secret          = var.proxy_api_key_secret
  proxy_api_key_secret_version  = var.proxy_api_key_secret_version
  vertex_location               = var.vertex_location
}
