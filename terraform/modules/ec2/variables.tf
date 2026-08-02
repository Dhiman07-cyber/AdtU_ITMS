variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "iam_instance_profile" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "node_count" {
  type    = number
  default = 1
}

variable "key_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "ebs_volume_size" {
  type = number
}

variable "allocate_eip" {
  type    = bool
  default = true
}
