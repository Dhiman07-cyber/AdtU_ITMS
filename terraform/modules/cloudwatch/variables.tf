variable "environment" {
  type = string
}

variable "instance_ids" {
  type = list(string)
}

variable "alb_arn_suffix" {
  type = string
}

variable "alarm_email" {
  type = string
}
