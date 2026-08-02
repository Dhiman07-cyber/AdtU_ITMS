# ==============================================================================
# ITMS AWS PRODUCTION PLATFORM ARCHITECTURE (PROGRAM 008A Baseline -> 008B/008C Path)
# Modular Terraform Configuration
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "itms-terraform-state-prod"
    key            = "production/platform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "itms-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ITMS"
      Environment = var.environment
      Phase       = var.deployment_phase
      ManagedBy   = "Terraform"
      Owner       = "ADTU-Platform-Engineering"
    }
  }
}

# ------------------------------------------------------------------------------
# 1. VPC & Networking Infrastructure
# ------------------------------------------------------------------------------
module "vpc" {
  source = "./modules/vpc"

  vpc_cidr             = var.vpc_cidr
  environment          = var.environment
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
}

# ------------------------------------------------------------------------------
# 2. Security Groups & IAM Roles
# ------------------------------------------------------------------------------
module "security" {
  source = "./modules/security"

  vpc_id      = module.vpc.vpc_id
  environment = var.environment
  enable_alb  = var.enable_alb
}

# ------------------------------------------------------------------------------
# 3. AWS Elastic Container Registry (ECR)
# ------------------------------------------------------------------------------
module "ecr" {
  source = "./modules/ecr"

  environment = var.environment
}

# ------------------------------------------------------------------------------
# 4. Optional ALB (Program 008B+)
# ------------------------------------------------------------------------------
module "alb" {
  count  = var.enable_alb ? 1 : 0
  source = "./modules/alb"

  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  security_group_id = module.security.alb_security_group_id
  domain_name       = var.domain_name
  environment       = var.environment
  target_ec2_ids    = module.ec2.instance_ids
}

# ------------------------------------------------------------------------------
# 5. EC2 Compute Fleet (1 Node for 008A, Expandable to N for 008B)
# ------------------------------------------------------------------------------
module "ec2" {
  source = "./modules/ec2"

  vpc_id               = module.vpc.vpc_id
  public_subnet_ids    = module.vpc.public_subnet_ids
  security_group_id    = module.security.ec2_security_group_id
  iam_instance_profile = module.security.ec2_iam_instance_profile_name
  instance_type        = var.ec2_instance_type
  node_count           = var.node_count
  key_name             = var.ec2_key_name
  environment          = var.environment
  ebs_volume_size      = var.ebs_volume_size
  allocate_eip         = !var.enable_alb
}

# ------------------------------------------------------------------------------
# 6. SSM Parameter Store Secrets
# ------------------------------------------------------------------------------
module "ssm" {
  source = "./modules/ssm"

  environment = var.environment
}

# ------------------------------------------------------------------------------
# 7. CloudWatch Observability & Alarms
# ------------------------------------------------------------------------------
module "cloudwatch" {
  source = "./modules/cloudwatch"

  environment    = var.environment
  instance_ids   = module.ec2.instance_ids
  alb_arn_suffix = var.enable_alb ? module.alb[0].alb_arn_suffix : ""
  alarm_email    = var.alert_email
}
