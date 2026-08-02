output "alb_security_group_id" {
  value = length(aws_security_group.alb) > 0 ? aws_security_group.alb[0].id : ""
}

output "ec2_security_group_id" {
  value = aws_security_group.ec2.id
}

output "ec2_iam_instance_profile_name" {
  value = aws_iam_instance_profile.ec2_profile.name
}
