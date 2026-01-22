for i in {1..15}; do
  resp=$(curl -s -w '\n%{time_total}' \
    http://CustomIngressControllerALB-709257546.us-west-2.elb.amazonaws.com/accounts)

  region=$(printf '%s\n' "$resp" | head -n1 | jq -r '.environment.AWS_REGION')
  time=$(printf '%s\n' "$resp" | tail -n1)

  printf '%s (%.0fms)\n' "$region" "$(echo "$time * 1000" | bc)"
done

