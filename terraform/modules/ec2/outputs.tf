output "instance_ids" {
  value = aws_instance.nodes[*].id
}

output "public_ips" {
  value = aws_instance.nodes[*].public_ip
}
