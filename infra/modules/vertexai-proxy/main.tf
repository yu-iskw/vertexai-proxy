resource "google_cloud_run_v2_service" "proxy" {
  name                 = var.service_name
  location             = var.location
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true
  deletion_protection  = false

  template {
    service_account = var.runtime_service_account_email
    timeout         = "300s"

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "PROXY_HOST"
        value = "0.0.0.0"
      }

      env {
        name  = "IMPERSONATE_SERVICE_ACCOUNT"
        value = var.vertex_service_account_email
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      dynamic "env" {
        for_each = var.vertex_location == "" ? [] : [var.vertex_location]
        content {
          name  = "VERTEX_LOCATION"
          value = env.value
        }
      }

      env {
        name = "PROXY_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.proxy_api_key_secret
            version = var.proxy_api_key_secret_version
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
    ]

    precondition {
      condition     = var.runtime_service_account_email != var.vertex_service_account_email
      error_message = "Runtime and Vertex service accounts must be different emails."
    }
  }
}

locals {
  vertex_service_account_project = split(".", split("@", var.vertex_service_account_email)[1])[0]
}

resource "google_service_account_iam_member" "runtime_token_creator" {
  service_account_id = "projects/${local.vertex_service_account_project}/serviceAccounts/${var.vertex_service_account_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.runtime_service_account_email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_secret_accessor" {
  secret_id = var.proxy_api_key_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.runtime_service_account_email}"
}
