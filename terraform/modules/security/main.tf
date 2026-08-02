# ALB Security Group (Program 008B+)
resource "aws_security_group" "alb" {
  count       = var.enable_alb ? 1 : 0
  name        = "itms-alb-sg-${var.environment}"
  description = "Security Group for ITMS Public Load Balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS public ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP public ingress"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow outbound to EC2 nodes"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "itms-alb-sg-${var.environment}"
  }
}

# EC2 Security Group (008A: Direct HTTP/HTTPS public ingress; 008B: Ingress from ALB)
resource "aws_security_group" "ec2" {
  name        = "itms-ec2-sg-${var.environment}"
  description = "Security Group for ITMS EC2 Compute Instances"
  vpc_id      = var.vpc_id

  # Inbound HTTP (Public in 008A, ALB-only in 008B)
  ingress {
    description     = "HTTP traffic"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    cidr_blocks     = var.enable_alb ? null : ["0.0.0.0/0"]
    security_groups = var.enable_alb ? [aws_security_group.alb[0].id] : null
  }

  # Inbound HTTPS (Public in 008A, ALB-only in 008B)
  ingress {
    description     = "HTTPS traffic"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    cidr_blocks     = var.enable_alb ? null : ["0.0.0.0/0"]
    security_groups = var.enable_alb ? [aws_security_group.alb[0].id] : null
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "itms-ec2-sg-${var.environment}"
  }
}

# IAM Role for EC2 Instances (SSM Session Manager & ECR Access)
resource "aws_iam_role" "ec2_role" {
  name = "itms-ec2-instance-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecr_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "itms-ec2-instance-profile-${var.environment}"
  role = aws_iam_role.ec2_role.name
}
