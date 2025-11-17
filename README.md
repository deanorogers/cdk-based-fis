# ECS Blue/Green Deployment with CDK
This repository demonstrates how to implement Blue/Green deployments for Amazon ECS using AWS CDK. The setup includes two separate environments (Blue and Green) that allow for seamless switching between versions of your application with minimal downtime.

## Approach
IaC will provision the following resources:

- An ECS Cluster with two services (Blue and Green)
- An Application Load Balancer (ALB) to route traffic between the two services
- Auto Scaling Groups for both services
- A CodeDeploy application and deployment group to manage the Blue/Green deployments
- A sample Dockerized application to be deployed
- An S3 bucket to store deployment artifacts
- Template files for CodeDeploy to manage the deployment process

Thereafter, you can deploy new versions of your application by:

- build the Docker image
- upload to ECR
- update imageDetail.json in S3 asset bucket to refer to the new image
- trigger a new deployment in CodePipeline

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