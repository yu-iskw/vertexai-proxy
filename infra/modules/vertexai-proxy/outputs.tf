output "uri" {
  description = "Cloud Run service URI."
  value       = google_cloud_run_v2_service.proxy.uri
}

output "cursor_base_url" {
  description = "OpenAI-compatible base URL for Cursor."
  value       = "${google_cloud_run_v2_service.proxy.uri}/v1"
}
