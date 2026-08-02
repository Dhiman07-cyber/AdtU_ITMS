data "aws_ami" "amazon_linux_2023_arm64" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "nodes" {
  count                  = var.node_count
  ami                    = data.aws_ami.amazon_linux_2023_arm64.id
  instance_type          = var.instance_type
  subnet_id              = var.public_subnet_ids[count.index % length(var.public_subnet_ids)]
  vpc_security_group_ids = [var.security_group_id]
  iam_instance_profile   = var.iam_instance_profile
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size           = var.ebs_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = false
  }

  user_data = <<-EOF
              #!/bin/bash
              set -e
              dnf update -y
              dnf install -y docker git
              systemctl enable --now docker
              usermod -aG docker ec2-user

              mkdir -p /usr/local/lib/docker/cli-plugins
              curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose
              chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

              mkdir -p /opt/itms
              chown -R ec2-user:ec2-user /opt/itms

              echo "ITMS Node Initialized on $(date)" > /opt/itms/init.log
              EOF

  tags = {
    Name = "itms-node-${count.index + 1}-${var.environment}"
    Node = "node-${count.index + 1}"
  }
}

# Allocate Elastic IP for single-node deployment (Program 008A)
resource "aws_eip" "node_eip" {
  count    = var.allocate_eip ? var.node_count : 0
  instance = aws_instance.nodes[count.index].id
  domain   = "vpc"

  tags = {
    Name = "itms-node-eip-${count.index + 1}-${var.environment}"
  }
}
