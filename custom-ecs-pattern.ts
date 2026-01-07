import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { ApplicationLoadBalancedFargateServiceProps } from 'aws-cdk-lib/aws-ecs-patterns';
import * as cdk from 'aws-cdk-lib';

/*
* Custom ECS Fargate Service with SSM Agent Sidecar
* This class extends the ApplicationLoadBalancedFargateService from aws-ecs-patterns
* and adds a sidecar container running the AWS Systems Manager (SSM) Agent.
* The SSM Agent allows you to manage and interact with your ECS tasks using
* AWS Systems Manager capabilities such as the AWS Fault Injection Service.
*/
export class CustomApplicationLoadBalancedFargateService extends ecspatterns.ApplicationLoadBalancedFargateService {
      constructor(scope: Construct, id: string, props: ApplicationLoadBalancedFargateServiceProps) {
        // ensure the ALB is created as internal (not internet-facing)
        const mergedProps: ApplicationLoadBalancedFargateServiceProps = {
          ...props,
          // make the load balancer internal
          publicLoadBalancer: false,
        };

        super(scope, id, mergedProps);

            // Add Name tag to the Load Balancer so that it can be later identified by the ingress controller
            cdk.Tags.of(this.loadBalancer).add('Name', 'AccountServiceALB');

            if (props.taskDefinition) {

                  // create an IAM service role for Systems Manager
                  const ssmRole = new iam.Role(this, 'SSMManagedInstanceRole', {
                    assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
                    managedPolicies: [
                      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
                    ],
                  });

                  // Grant ssm:CreateActivation to the taskRole
                  props.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
                    actions: ['ssm:CreateActivation', 'ssm:AddTagsToResource'],
                    resources: ['*'],
                  }));

                  // Grant iam:PassRole to the taskRole for the ssmRole
                  props.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: [ssmRole.roleArn],
                  }));

                  // SSM Agent sidecar container
                  props.taskDefinition.addContainer('SSMAgent', {
                    image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazon-ssm-agent/amazon-ssm-agent:latest'),
                    containerName: 'amazon-ssm-agent',
                    essential: false,
                    cpu: 0,
                    entryPoint: [],
                    logging: ecs.LogDrivers.awsLogs({
                        streamPrefix: '${id}-ssm-agent',
                        logRetention: 1
                    }),
                    environment: {
                      MANAGED_INSTANCE_ROLE_NAME: ssmRole.roleName
                    },
                    command: [
                      "/bin/bash",
                      "-c",
                      // simplified, robust startup: if ECS metadata exists, start the SSM agent, otherwise log and exit
                      "set -e; if [[ -n $ECS_CONTAINER_METADATA_URI_V4 ]]; then echo 'Starting SSM agent'; amazon-ssm-agent & wait $!; else echo 'ECS metadata not found, skipping SSM agent'; fi"
                    ]
                     });
            }
      }
}