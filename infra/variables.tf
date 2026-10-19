variable "project_id" {
  type        = string
  description = "Google Cloud project that hosts the Cloud Run service."
}

variable "location" {
  type        = string
  description = "Cloud Run region."
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name."
  default     = "vertexai-proxy"
}

variable "image" {
  type        = string
  description = "Container image URL for the proxy."
}

variable "deployer_service_account_email" {
  type        = string
  description = "Existing service account the Google provider impersonates."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.iam\\.gserviceaccount\\.com$", var.deployer_service_account_email))
    error_message = "deployer_service_account_email must be a service account email."
  }
}

variable "runtime_service_account_email" {
  type        = string
  description = "Existing service account the Cloud Run service runs as."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.iam\\.gserviceaccount\\.com$", var.runtime_service_account_email))
    error_message = "runtime_service_account_email must be a service account email."
  }
}

variable "vertex_service_account_email" {
  type        = string
  description = "Existing service account the proxy impersonates for Vertex AI."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.iam\\.gserviceaccount\\.com$", var.vertex_service_account_email))
    error_message = "vertex_service_account_email must be a service account email."
  }
}

variable "proxy_api_key_secret" {
  type        = string
  description = "Secret Manager resource name of the proxy bearer (projects/PROJECT/secrets/NAME)."

  validation {
    condition     = can(regex("^projects/[^/]+/secrets/[^/]+$", var.proxy_api_key_secret))
    error_message = "proxy_api_key_secret must be a Secret Manager resource name (projects/PROJECT/secrets/NAME)."
  }
}

variable "proxy_api_key_secret_version" {
  type        = string
  description = "Secret Manager version of the proxy bearer."
  default     = "latest"
}

variable "vertex_location" {
  type        = string
  description = "VERTEX_LOCATION value. Empty leaves the proxy default."
  default     = ""
}
