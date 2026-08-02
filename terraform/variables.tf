variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment stage"
  type        = string
  default     = "production"
}

variable "deployment_phase" {
  description = "Program milestone phase (008A, 008B, 008C)"
  type        = string
  default     = "008A"
}

variable "node_count" {
  description = "Number of EC2 compute nodes (1 for 008A, 2+ for 008B)"
  type        = number
  default     = 1
}

variable "enable_alb" {
  description = "Toggle Application Load Balancer (false for 008A EIP, true for 008B multi-node ALB)"
  type        = bool
  default     = false
}

variable "vpc_cidr" {
  description = "VPC IP range CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AWS Availability Zones list"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "public_subnet_cidrs" {
  description = "Public Subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private Subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.20.0/24"]
}

variable "domain_name" {
  description = "Primary domain name for ITMS application (e.g. bus.adtu.edu.in)"
  type        = string
  default     = "itms.example.com"
}

variable "ec2_instance_type" {
  description = "EC2 instance size (ARM64 Graviton recommended t4g.medium)"
  type        = string
  default     = "t4g.medium"
}

variable "ec2_key_name" {
  description = "Optional SSH key pair name (SSM Session Manager preferred)"
  type        = string
  default     = ""
}

variable "ebs_volume_size" {
  description = "Root EBS storage volume size in GB"
  type        = number
  default     = 30
}

variable "alert_email" {
  description = "Operations SRE alert notifications email address"
  type        = string
  default     = "sre-alerts@adtu.edu.in"
}
