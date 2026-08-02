# Base SSM Parameters for Application Runtime Secrets (Placeholder definitions)
resource "aws_ssm_parameter" "db_service_key" {
  name        = "/itms/${var.environment}/SUPABASE_SERVICE_ROLE_KEY"
  description = "Supabase Service Role Secret Key"
  type        = "SecureString"
  value       = "CHANGE_ME_IN_PRODUCTION"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "signing_secret" {
  name        = "/itms/${var.environment}/SIGNING_SECRET_KEY"
  description = "JWT & Token Signing Secret"
  type        = "SecureString"
  value       = "CHANGE_ME_IN_PRODUCTION"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "encryption_secret" {
  name        = "/itms/${var.environment}/ENCRYPTION_SECRET_KEY"
  description = "AES-256 Field Level Encryption Secret"
  type        = "SecureString"
  value       = "CHANGE_ME_IN_PRODUCTION"

  lifecycle {
    ignore_changes = [value]
  }
}
