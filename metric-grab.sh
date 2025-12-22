REGION=us-east-1
CLUSTER=service-cluster
SERVICE=ECSServiceStack-amazonecssampleService537E3215-jFW4el163OIQ

# compute times (end = now, start = 5 minutes ago)
END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
START=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow()-timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%SZ'))")

# Option A: single metric snapshot (Average over 5 minutes)
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --start-time "$START" \
  --end-time "$END" \
  --period 300 \
  --statistics Average \
  --dimensions Name=ClusterName,Value="$CLUSTER" \
  --region "$REGION" \
  --output table
