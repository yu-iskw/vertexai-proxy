terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.14.0, < 7.0.0"
    }
  }
}

provider "google" {
  impersonate_service_account = var.deployer_service_account_email
  project                     = var.project_id
  region                      = var.location
}
