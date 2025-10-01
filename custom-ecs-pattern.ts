import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { ApplicationLoadBalancedFargateServiceProps } from 'aws-cdk-lib/aws-ecs-patterns';

export class CustomApplicationLoadBalancedFargateService extends ecspatterns.ApplicationLoadBalancedFargateService {
      constructor(scope: Construct, id: string, props: ApplicationLoadBalancedFargateServiceProps) {
        super(scope, id, props);

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
                      MANAGED_INSTANCE_ROLE_NAME: ssmRole.roleName                    },
                    command: [
                      "/bin/bash",
                      "-c",
                      "set -e; dnf upgrade -y; dnf install jq procps awscli -y; term_handler() { echo \"Deleting SSM activation $ACTIVATION_ID\"; if ! aws ssm delete-activation --activation-id $ACTIVATION_ID --region $ECS_TASK_REGION; then echo \"SSM activation $ACTIVATION_ID failed to be deleted\" 1>&2; fi; MANAGED_INSTANCE_ID=$(jq -e -r .ManagedInstanceID /var/lib/amazon/ssm/registration); echo \"Deregistering SSM Managed Instance $MANAGED_INSTANCE_ID\"; if ! aws ssm deregister-managed-instance --instance-id $MANAGED_INSTANCE_ID --region $ECS_TASK_REGION; then echo \"SSM Managed Instance $MANAGED_INSTANCE_ID failed to be deregistered\" 1>&2; fi; kill -SIGTERM $SSM_AGENT_PID; }; trap term_handler SIGTERM SIGINT; if [[ -z $MANAGED_INSTANCE_ROLE_NAME ]]; then echo \"Environment variable MANAGED_INSTANCE_ROLE_NAME not set, exiting\" 1>&2; exit 1; fi; if ! ps ax | grep amazon-ssm-agent | grep -v grep > /dev/null; then if [[ -n $ECS_CONTAINER_METADATA_URI_V4 ]] ; then echo \"Found ECS Container Metadata, running activation with metadata\"; TASK_METADATA=$(curl \"${ECS_CONTAINER_METADATA_URI_V4}/task\"); ECS_TASK_AVAILABILITY_ZONE=$(echo $TASK_METADATA | jq -e -r '.AvailabilityZone'); ECS_TASK_ARN=$(echo $TASK_METADATA | jq -e -r '.TaskARN'); ECS_TASK_REGION=$(echo $ECS_TASK_AVAILABILITY_ZONE | sed 's/.$//'); ECS_TASK_AVAILABILITY_ZONE_REGEX='^(af|ap|ca|cn|eu|me|sa|us|us-gov)-(central|north|(north(east|west))|south|south(east|west)|east|west)-[0-9]{1}[a-z]{1}$'; if ! [[ $ECS_TASK_AVAILABILITY_ZONE =~ $ECS_TASK_AVAILABILITY_ZONE_REGEX ]]; then echo \"Error extracting Availability Zone from ECS Container Metadata, exiting\" 1>&2; exit 1; fi; ECS_TASK_ARN_REGEX='^arn:(aws|aws-cn|aws-us-gov):ecs:[a-z0-9-]+:[0-9]{12}:task/[a-zA-Z0-9_-]+/[a-zA-Z0-9]+$'; if ! [[ $ECS_TASK_ARN =~ $ECS_TASK_ARN_REGEX ]]; then echo \"Error extracting Task ARN from ECS Container Metadata, exiting\" 1>&2; exit 1; fi; CREATE_ACTIVATION_OUTPUT=$(aws ssm create-activation --iam-role $MANAGED_INSTANCE_ROLE_NAME --tags Key=ECS_TASK_AVAILABILITY_ZONE,Value=$ECS_TASK_AVAILABILITY_ZONE Key=ECS_TASK_ARN,Value=$ECS_TASK_ARN Key=FAULT_INJECTION_SIDECAR,Value=true --region $ECS_TASK_REGION); ACTIVATION_CODE=$(echo $CREATE_ACTIVATION_OUTPUT | jq -e -r .ActivationCode); ACTIVATION_ID=$(echo $CREATE_ACTIVATION_OUTPUT | jq -e -r .ActivationId); if ! amazon-ssm-agent -register -code $ACTIVATION_CODE -id $ACTIVATION_ID -region $ECS_TASK_REGION; then echo \"Failed to register with AWS Systems Manager (SSM), exiting\" 1>&2; exit 1; fi; amazon-ssm-agent & SSM_AGENT_PID=$!; wait $SSM_AGENT_PID; else echo \"ECS Container Metadata not found, exiting\" 1>&2; exit 1; fi; else echo \"SSM agent is already running, exiting\" 1>&2; exit 1; fi"
                    ]
                  });
            }
      }
}