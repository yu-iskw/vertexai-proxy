output "uri" {
  description = "Cloud Run service URI."
  value       = module.vertexai_proxy.uri
}

output "cursor_base_url" {
  description = "OpenAI-compatible base URL for Cursor."
  value       = module.vertexai_proxy.cursor_base_url
}
