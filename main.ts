import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { CustomApplicationLoadBalancedFargateService } from './custom-ecs-pattern';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fis from './fis';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { CustomS3Bucket } from './packages/custom-s3-bucket';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';

export class ECSServiceStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly bucket: s3.Bucket;
  public readonly vpc: ec2.IVpc;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC with 9x subnets divided over 3 AZ's
    const vpc = new ec2.Vpc(this, 'SkeletonVpc', {
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
    this.vpc = vpc;

    // Create an ECS cluster
    this.cluster = new ecs.Cluster(this, 'service-cluster', {
      clusterName: 'service-cluster',
      containerInsights: true,
      vpc: vpc,
    });

    // Create the ECS Task Execution Role and attach the AmazonECSTaskExecutionRolePolicy
    const executionRole = new iam.Role(this, 'ECSTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create the Task IAM Role
    const taskRole = new iam.Role(this, 'ECSTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Create a Fargate Task Definition with a sidecar SSM Agent container
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: executionRole,
      taskRole: taskRole,
      enableFaultInjection: true
    });

    // Main application container
    taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
      containerName: 'app',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: id,
        logRetention: 1,
      }),
      portMappings: [{ containerPort: 80 }],
    });

    /*************************************************************
    ** Create the Fargate service with an Application Load Balancer
    ** Use a custom (extended) construct that provisions a sidecar having SSM Agent
    ** this is required for FIS to be able to connect to the ECS tasks and, for example, spin the container's CPU
    *************************************************************/
    const loadBalancedFargateService = new CustomApplicationLoadBalancedFargateService(this, 'amazon-ecs-sample', {
      cluster: this.cluster,
      circuitBreaker: {
        rollback: true,
      },
      desiredCount: 1,
      taskDefinition: taskDef,
      propagateTags: ecs.PropagatedTagSource.SERVICE, // propagate service tags to tasks
    });

    // Add tag to the ECS service for FIS targeting
   cdk.Tags.of(this).add('FIS_ENABLED', 'true');

    // Create an S3 bucket
   this.bucket = new CustomS3Bucket(this, 'SimpleBucket', {
     versioned: false
   });

   // allow to scale for FIS experiments
    const scalableTarget = loadBalancedFargateService.service.autoScaleTaskCount({
        minCapacity: 1,
        maxCapacity: 3,
    });

    // Scale out when CPU > 80% sustained for a 30s period.
    // Use a 30s-period metric and a step-scaling policy that increments/decrements the desired count.
    const cpuMetric30s = loadBalancedFargateService.service.metricCpuUtilization({
      period: cdk.Duration.seconds(30),
    });

    scalableTarget.scaleOnMetric('CpuStepScaling', {
      metric: cpuMetric30s,
      scalingSteps: [
        // scale in when CPU is low (<= 50%)
        { upper: 50, change: -1 },
        // scale out when CPU >= 80%
        { lower: 80, change: +1 },
      ],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      // cooldown to avoid rapid fluctuations
      cooldown: cdk.Duration.seconds(60),
    });

  } // constructor
} // stack
