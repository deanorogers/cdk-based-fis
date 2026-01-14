# Instructions

This will provision a VPC Endpoint to the secondary region and vice-versa. To avoid the _chicken-and-egg_ problem, resource provision is a multi-step process.
```
-- step 1 : create VPC Endpoint Service in primary region us-east-1
$ cdk deploy IngressControllerStack -c allowedRegion=us-west-2  

-- step 2 : create VPC Endpoint Service in secondary region us-west-2
$ cdk deploy IngressControllerStack -c allowedRegion=us-east-1  

-- step 3 : create VPC Endpoint in primary region us-east-1 that connects to the service in us-west-2
$ cdk deploy IngressControllerStack -c vpcEndpointServiceId=vpce-svc-XXXXXXXXXXXXfaa -c vpcEndpointServiceRegion=us-west-2 -c allowedRegion=us-west-2  

-- step 4 : create VPC Endpoint in secondary region us-west-2 that connects to the service in us-east-1
$ cdk deploy IngressControllerStack -c vpcEndpointServiceId=vpce-svc-XXXXXXXXXXXXfaa -c vpcEndpointServiceRegion=us-east-1 -c allowedRegion=us-east-1
```