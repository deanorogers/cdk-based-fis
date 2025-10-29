import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';

export interface EcsFoundationStackProps extends cdk.StackProps {
    portRange: number;
    name: string;
    serviceName: string;
}

export class EcsFoundationStack extends cdk.Stack {

  public taskDefRoleName: string;
  public taskExecRoleName: string;
  public serviceRoleArn: string;
  public vpc: IVpc;

  constructor(scope: cdk.App, id: string, props: EcsFoundationStackProps) {
    super(scope, id, props);

    const taskDefRole = new iam.Role(this, `${props.name}-ecs-task-role`, {
        roleName: `${props.name}-ecs-task-role`,
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        description: 'IAM Role for ECS Task Definition'
    });

    const taskExecRole = new iam.Role(this, `${props.name}-ecs-task-exec-role`, {
        roleName: `${props.name}-ecs-task-exec-role`,
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        description: 'IAM Role for ECS Task Execution'
    });

    // Add ECR permissions to task execution role
    taskExecRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    taskExecRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            'ecr:GetAuthorizationToken',
            'ecr:BatchCheckLayerAvailability',
            'ecr:GetDownloadUrlForLayer',
            'ecr:BatchGetImage'
        ],
        resources: ['*']
    }));

    const serviceRole = new iam.Role(this, `${props.name}-ecs-service-role`, {
        roleName: `${props.name}-ecs-service-role`,
        assumedBy: new iam.CompositePrincipal(new ServicePrincipal('ecs.amazonaws.com'),  new ServicePrincipal('codedeploy.amazonaws.com'))
    });

    // export role names and ARN as string to avoid circular stack references
    this.taskDefRoleName = taskDefRole.roleName;
    this.taskExecRoleName = taskExecRole.roleName;
    this.serviceRoleArn = serviceRole.roleArn;

    // use managed role to begin with
    // serviceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceRole'));

    // add policy to describe elbs
    serviceRole.addToPolicy(new iam.PolicyStatement({
        actions: [
            'elasticloadbalancing:DescribeListeners',
            'elasticloadbalancing:DescribeTargetGroups',
            'elasticloadbalancing:DescribeTargetHealth'
        ],
        resources: ['*']
    }));

    // define a specific policy for DescribeRules that restricts resources
    // to only application load balancers in the account and region
    serviceRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:DescribeRules'
      ],
      resources: ['*']
    }));

    // add policy to allow service to register with ALB target group
    serviceRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets'
      ],
        resources: [`arn:aws:elasticloadbalancing:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:targetgroup/*/*`]
    }));

    // add modify listener policy
    serviceRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:ModifyListener'
      ],
        resources: [`arn:aws:elasticloadbalancing:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:listener/app/*/*/*`]
    }));

    // add modify alb rules policy
    serviceRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:ModifyRule'
      ],
        resources: [`arn:aws:elasticloadbalancing:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:rule/app/*/*/*`]
    }));

    // add passrole to service role for task execution role and task role
    // use literals to avoid circular stack references
    // added a condition to pass only to ecs and codedeploy
    serviceRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'iam:PassRole'
      ],
      resources: [
        `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/${this.taskExecRoleName}`,
        `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/${this.taskDefRoleName}`
      ],
      conditions: {
        "StringEquals": {
            "iam:PassedToService": [
              "ecs.amazonaws.com",
              "codedeploy.amazonaws.com"
            ]
        }
      }
    }));

    // Create a VPC with 9x subnets divided over 3 AZ's
    this.vpc = new ec2.Vpc(this, 'SkeletonVpc', {
      cidr: '172.31.0.0/16',
      natGateways: 1,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 20,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 20,
          name: 'application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        }
      ],
    });
  }
}