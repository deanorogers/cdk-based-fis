import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { EcsDeploymentGroup, EcsDeploymentConfig } from 'aws-cdk-lib/aws-codedeploy';
import { ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface EcsBlueGreenStackProps extends cdk.StackProps {

    taskRoleName: string;
    taskExecRoleName: string;
    serviceRoleArn: string;
    portRange: number;
    testPort: number;
    name: string;
    serviceName: string;
    vpc: IVpc;
}

export class EcsBlueGreenStack extends cdk.Stack {

  public albSecurityGroup: ec2.ISecurityGroup;
  public taskDefinition: ecs.TaskDefinition

  constructor(scope: cdk.App, id: string, props: EcsBlueGreenStackProps) {
    super(scope, id, props);

    // get ref to vpc using vpcId
    const vpc = props.vpc;

    // Create an ECS cluster
     const cluster = new ecs.Cluster(this, 'service-cluster', {
       clusterName: 'service-cluster',
       containerInsights: true,
       vpc: vpc,
     });

    // Create a Fargate Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: iam.Role.fromRoleName(this, 'ImportedExecutionRole', props.taskExecRoleName),
      taskRole: iam.Role.fromRoleName(this, 'ImportedTaskRole', props.taskRoleName),
      enableFaultInjection: true
    });

   // create ecr repo
   const registry = new ecr.Repository(this, 'EcrRepo', {
      repositoryName: `${props.name}-repository`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteImages: true,
    });

    // Main application container
    const appContainer = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
      containerName: 'customer-portal',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: id,
        logRetention: 1,
      }),
      // map 8080 to 80
      portMappings: [{ containerPort: 80, hostPort: 80 }],
    });

    // create a Fargate ECS service and place into the defined VPC and subnets
    const service = new ecs.FargateService(this, 'FargateService', {
      cluster: cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      assignPublicIp: false,
      serviceName: props.serviceName,
      vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      },
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY
      }
    });

    // define ALB and place into routable subnets
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc: vpc,
      internetFacing: true,
      vpcSubnets: {
            subnetType: ec2.SubnetType.PUBLIC
      },
      loadBalancerName: `${props.name}-alb`
    });

    // allow traffic from ALB to ECS
    service.connections.allowFrom(alb, ec2.Port.tcp(props.portRange), 'Allow traffic from ALB to ECS Service');

    const tg = {
        vpc: vpc,
        targetType: elbv2.TargetType.IP,
        port: props.portRange,
        healthCheck: {
            interval: cdk.Duration.seconds(15),
            timeout: cdk.Duration.seconds(5),
            path: '/',
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 5,
            port: '80',
            protocol: elbv2.Protocol.HTTP,
            healthyHttpCodes: '200-399'
        }
    };

    const blueTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BlueTargetGroup', tg);
    // const blueTargetGroup = new cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup(this, 'BlueTargetGroup', tg);
    const greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'GreenTargetGroup', tg);
    // const greenTargetGroup = new cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup(this, 'GreenTargetGroup', tg);

    const listener = alb.addListener('Listener', {
      port: props.portRange,
      open: true,
      defaultTargetGroups: [blueTargetGroup]
    });

    const testListener = alb.addListener('TestListener', {
      port: 8080,
      open: true,
      defaultTargetGroups: [greenTargetGroup]
    });

    service.attachToApplicationTargetGroup(blueTargetGroup as ApplicationTargetGroup);
    new EcsDeploymentGroup(this, 'BlueGreenDG', {
        service,
        blueGreenDeploymentConfig: {
            blueTargetGroup: blueTargetGroup,
            greenTargetGroup: greenTargetGroup,
            listener: listener,
            testListener: testListener,
        },
        deploymentConfig: EcsDeploymentConfig.ALL_AT_ONCE,
    });


//     const prodRule = new elbv2.ApplicationListenerRule(this, id + 'ProdRule', {
//         listener: listener,
//         priority: 1,
//         conditions: [
//             elbv2.ListenerCondition.pathPatterns(['/*'])
//         ],
//         action: elbv2.ListenerAction.weightedForward([
//             {
//                 targetGroup: blueTargetGroup, // use the target group object, not a string
//                 weight: 100
//             }
//         ])
//     });

//     const testRule = new elbv2.ApplicationListenerRule(this, id + 'TestRule', {
//         listener: testListener,
//         priority: 1,
//         conditions: [
//             elbv2.ListenerCondition.pathPatterns(['/*'])
//         ],
//         action: elbv2.ListenerAction.weightedForward([
//             {
//                 targetGroup: greenTargetGroup, // use the target group object, not a string
//                 weight: 100
//             }
//         ])
//     });


    const cfnService = service.node.defaultChild as ecs.CfnService;

//     cfnService.loadBalancers = [{
//         containerName: appContainer.containerName,
//         containerPort: 80,  // Use the actual container port, not the ALB port
//         targetGroupArn: blueTargetGroup.targetGroupArn
//     }];
//
//     // For CODE_DEPLOY, we need to set the deployment configuration properly
//     cfnService.deploymentConfiguration = {
//         deploymentCircuitBreaker: {
//             enable: true,
//             rollback: true
//         }
//     };

    // Output the values needed for CodeDeploy configuration
    new cdk.CfnOutput(this, 'BlueTargetGroupArn', {
      value: blueTargetGroup.targetGroupArn,
      exportName: `${props.serviceName}-blue-tg`
    });

    new cdk.CfnOutput(this, 'GreenTargetGroupArn', {
      value: greenTargetGroup.targetGroupArn,
      exportName: `${props.serviceName}-green-tg`
    });

    new cdk.CfnOutput(this, 'ProductionListenerArn', {
      value: listener.listenerArn,
      exportName: `${props.serviceName}-prod-listener`
    });

    new cdk.CfnOutput(this, 'TestListenerArn', {
      value: testListener.listenerArn,
      exportName: `${props.serviceName}-test-listener`
    });

    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: cluster.clusterName,
      exportName: `${props.serviceName}-cluster`
    });
  }
}