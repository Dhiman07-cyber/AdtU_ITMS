output "vpc_id" {
  description = "The ID of the ITMS VPC"
  value       = module.vpc.vpc_id
}

output "alb_dns_name" {
  description = "Public DNS name of the AWS Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "ecr_repository_urls" {
  description = "URLs of the ECR container repositories"
  value       = module.ecr.repository_urls
}

output "ec2_instance_public_ips" {
  description = "Public IP addresses of the compute EC2 instances"
  value       = module.ec2.public_ips
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix path for runtime configuration"
  value       = module.ssm.parameter_prefix
}
