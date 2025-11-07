import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { EcsDeploymentGroup, EcsDeploymentConfig } from 'aws-cdk-lib/aws-codedeploy';
import { ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { EcsApplication } from 'aws-cdk-lib/aws-codedeploy';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as JSZip from 'jszip';
import * as yaml from 'js-yaml';

export interface EcsBlueGreenStackProps extends cdk.StackProps {

    taskRoleName: string;
    taskExecRoleName: string;
    serviceRoleArn: string;
    portRange: number;
    testPort: number;
    name: string;
    serviceName: string;
    vpc: IVpc;
    ecrRepository: ecr.IRepository;
    imageTag: string; // the tag of the image to be deployed, if run as part of GitLab CI/CD this would be the commit SHA or branch name
    bucket: cdk.aws_s3.IBucket;
}

export class EcsBlueGreenStack extends cdk.Stack {

  public albSecurityGroup: ec2.ISecurityGroup;
  public taskDefinition: ecs.TaskDefinition;
  public deploymentGroup: EcsDeploymentGroup;
  public cluster: ecs.Cluster;
  public service: ecs.FargateService;
  public applicationName: string;
  public deployedObjectKey: string; // expose the deployed object key token

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

    // define ALB and place into routable subnets
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc: vpc,
      internetFacing: true,
      vpcSubnets: {
            subnetType: ec2.SubnetType.PUBLIC
      },
      loadBalancerName: `${props.name}-alb`
    });


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

    // create explicitly (rather than as part of deploymentGroup)
    // then export for reference in the code pipeline stack
    const application = new EcsApplication(this, 'CodeDeployApp', {
        applicationName: `${props.serviceName}-app`
    });
    this.applicationName = application.applicationName;



    /***************************
     ** now create the code deploy assets and store in S3
    ****************************/

    // Create AppSpec content inline
    const appSpecContent = {
      Resources: [
        {
          TargetService: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: '<TASK_DEFINITION>',
              LoadBalancerInfo: {
                ContainerName: 'customer-portal',
                ContainerPort: 80,
              },
              PlatformVersion: '1.4.0',
            },
          },
        },
      ],
    };

    // Define imageDetail.json
    const imageDetailContent = {
      // ImageURI: `${props.ecrRepository.repositoryUri}:${props.imageTag}`
      ImageURI: '107404535822.dkr.ecr.us-east-1.amazonaws.com/customer-portal-repository:1.0.1'
    };

    const executionRole = iam.Role.fromRoleName(this, 'ImportedExecutionRoleForTaskDef', props.taskExecRoleName);
    const taskRole = iam.Role.fromRoleName(this, 'ImportedTaskRoleForTaskDef', props.taskRoleName);

    // Create a Fargate Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      executionRole: executionRole,
      taskRole: taskRole,
      enableFaultInjection: false
    });

    // this is needed to allow CodeDeploy to thereafter update the task definition
    const appContainer = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry(
        `${props.ecrRepository.repositoryUri}:${props.imageTag}`
      ),
      containerName: 'customer-portal',
      portMappings: [{ containerPort: 80, hostPort: 80 }]
    });

    // Create task definition JSON (with roles added dynamically)
    const taskDefContent = {
      family: taskDef.family,
      executionRoleArn: executionRole.roleArn,
      taskRoleArn: taskRole.roleArn,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: 256,
      memory: 512,
      containerDefinitions: [
        {
          name: 'customer-portal',
          image: '<IMAGE1_NAME>',
          essential: true,
          portMappings: [
            {
              containerPort: 80,
              protocol: 'tcp'
            }
          ]
        }
      ]
    };

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

    // allow traffic from ALB to ECS
    service.connections.allowFrom(alb, ec2.Port.tcp(props.portRange), 'Allow traffic from ALB to ECS Service');

   service.attachToApplicationTargetGroup(blueTargetGroup as ApplicationTargetGroup);
    const deploymentGroup = new EcsDeploymentGroup(this, 'BlueGreenDG', {
        application: application,
        service,
        blueGreenDeploymentConfig: {
            blueTargetGroup: blueTargetGroup,
            greenTargetGroup: greenTargetGroup,
            listener: listener,
            testListener: testListener,
        },
        deploymentConfig: EcsDeploymentConfig.ALL_AT_ONCE,
    });

    this.deploymentGroup = deploymentGroup;

    const cfnService = service.node.defaultChild as ecs.CfnService;

    const configDir = path.join(__dirname, '../cdk.out/config-files');
    const fs = require('fs');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Build Resources section separately
    const resourcesYaml = yaml.dump({ Resources: appSpecContent.Resources }, {
      lineWidth: -1,
      noCompatMode: true
    });

    // Manually prepend version to avoid number normalization
    // ensure version is a STRING in the AppSpec (quote it) to avoid NUMBER -> STRING conversion errors
    const appSpecYaml = `version: "0.0"\n${resourcesYaml}`;

    fs.writeFileSync(path.join(configDir, 'appspec.yaml'), appSpecYaml);

    // fs.writeFileSync(path.join(configDir, 'appspec.yaml'), yaml.dump(appSpecContent, {lineWidth: -1, noCompatMode: true}));
    fs.writeFileSync(path.join(configDir, 'imageDetail.json'), JSON.stringify(imageDetailContent, null, 2));
    fs.writeFileSync(path.join(configDir, 'taskdef.json'), JSON.stringify(taskDefContent, null, 2));

    // Upload zip file to S3
    // the zip file will be named with a generated hash
    // therefore, need to obtain for use in code pipleine stack
    // destinationKeyPrefix: `${props.serviceName}/`,
    const deployment = new s3deploy.BucketDeployment(this, 'DeployAppSpecV2', {
      sources: [s3deploy.Source.asset(configDir)],
      destinationBucket: props.bucket,
      extract: false, // do not extract, we want the ZIP as is
      prune: true
    });
    const deployedObjectKey = cdk.Fn.select(0, deployment.objectKeys); // to be passed to the pipeline stack

    // output the deployedObjectKey
    new cdk.CfnOutput(this, 'AppSpecS3Key', {
      // ensure the CfnOutput.Value is rendered as a string by joining the token
      value: deployedObjectKey,
      exportName: `${props.serviceName}-appspec-s3-key`
    });

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

    // Store references for pipeline
    this.cluster = cluster;
    this.service = service;
    this.taskDefinition = taskDef;

    new cdk.CfnOutput(this, 'DeploymentGroupName', {
      value: deploymentGroup.deploymentGroupName,
      exportName: `${props.serviceName}-dg-name`
    });

    new cdk.CfnOutput(this, 'TaskDefinitionFamily', {
      value: taskDef.family,
      exportName: `${props.serviceName}-taskdef-family`
    });
  }
}