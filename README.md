# ECS Blue/Green Deployment with CDK
This repository demonstrates how to implement Blue/Green deployments for Amazon ECS using AWS CDK. The setup includes two separate environments (Blue and Green) that allow for seamless switching between versions of your application with minimal downtime.

## Push image to ECR
```
% aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 107404535822.dkr.ecr.us-east-1.amazonaws.com
% docker pull amazon/amazon-ecs-sample:latest
% docker tag amazon/amazon-ecs-sample:latest 107404535822.dkr.ecr.us-east-1.amazonaws.com/customer-portal-repository:1.0.0
% docker push 107404535822.dkr.ecr.us-east-1.amazonaws.com/customer-portal-repository:1.0.0

% docker build -t customer-portal-repository:latest .
% docker tag customer-portal-repository:latest 107404535822.dkr.ecr.us-east-1.amazonaws.com/customer-portal-repository:1.0.1
% docker push 107404535822.dkr.ecr.us-east-1.amazonaws.com/customer-portal-repository:1.0.1
```

## Resources
https://binaryheap.com/blue-green-with-ecs-and-cdk/