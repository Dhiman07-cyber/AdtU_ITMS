output "repository_urls" {
  value = {
    app = aws_ecr_repository.app.repository_url
    ws  = aws_ecr_repository.ws.repository_url
  }
}
