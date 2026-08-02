# CloudWatch Log Group for Application & SRE Logs
resource "aws_cloudwatch_log_group" "itms" {
  name              = "/aws/itms/${var.environment}"
  retention_in_days = 30

  tags = {
    Name = "itms-logs-${var.environment}"
  }
}

# SNS Topic for SRE Alerting
resource "aws_sns_topic" "alerts" {
  name = "itms-sre-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# CloudWatch Alarm: EC2 High CPU Utilization (> 80% for 5 mins)
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  count               = length(var.instance_ids)
  alarm_name          = "itms-high-cpu-node-${count.index + 1}-${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Node CPU utilization exceeded 80% threshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = var.instance_ids[count.index]
  }
}

# CloudWatch Alarm: ALB 5xx HTTP Error Rate (> 10 errors in 1 min)
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "itms-alb-high-5xx-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ALB Target 5xx error rate spike detected"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }
}
