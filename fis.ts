import * as cdk from 'aws-cdk-lib';
import {aws_logs, RemovalPolicy} from 'aws-cdk-lib';
import {aws_fis as fis} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import { CustomS3Bucket } from './custom-s3-bucket';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

// define custom props
// export interface FaultInjectionStackProps extends cdk.StackProps {
//   fisParametersJson?: string; // JSON-encoded parameters for FIS actions, e.g. `{"duration":"PT10M","percent":"90"}`
//
// }

export class FaultInjectionStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const account = cdk.Stack.of(this).account;
    console.log("Account: ", account);
    const region = cdk.Stack.of(this).region;

    // Read trust policy from file
    const trustPolicy = JSON.parse(
      fs.readFileSync('./fis-role-trust-policy.json', 'utf8')
    );

    // Create the FIS role with a default principal
    const fisRole = new iam.Role(this, 'FISRole', {
      assumedBy: new iam.ServicePrincipal('fis.amazonaws.com'),
    });

    // Override the assumeRolePolicy with the custom trust policy
    (fisRole.node.defaultChild as iam.CfnRole).assumeRolePolicyDocument = trustPolicy;

    // create a Cloudwatch log group for FIS experiment
    const fisLogGroup = new aws_logs.LogGroup(this, 'FISLogGroup', {
      logGroupName: `/aws/fis/ecs-cpu-stress-exp`,
      retention: aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // create s3 bucket to hold experiment report
    const bucket = new CustomS3Bucket(this, 'FISExperimentReportBucket', {
        bucketName: `fis-experiment-report-bucket-${account}-${region}`,
        versioned: false
    });

    // define cloudwatch dashboard for FIS experiment but only with 1 widget to show
    // EC2 CPU utilization
    const fisDashboard = new cloudwatch.Dashboard(this, 'FISDashboard', {
      dashboardName: 'FIS-ECS-CPU-Stress-Dashboard',
    });

    // Add a widget to monitor ECS CPU utilization
    const cpuUtilizationWidget = new cloudwatch.GraphWidget({
      title: 'ECS CPU Utilization',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            ClusterName: 'service-cluster',
            ServiceName: 'ECSServiceStack-amazonecssampleService537E3215-jFW4el163OIQ', // replace with your service name
          },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
      ],
    });

    fisDashboard.addWidgets(cpuUtilizationWidget);

    // define cfnExperimentTemplate for ECS CPU Stress test
    const experimentTemplate = new fis.CfnExperimentTemplate(this, 'ECSCPUStressTest', {
      description: 'ECS CPU Stress Test',
      roleArn: fisRole.roleArn,
      stopConditions: [
        {
          source: 'none',
        },
      ],
      targets: {
        "myTasks": {
          resourceType: "aws:ecs:task",
          selectionMode: "ALL",
          resourceTags: {
            FIS_ENABLED: "true"
          }
        }
      },
      actions: {
        'cpu-stress': {
          actionId: 'aws:ecs:task-cpu-stress',
          description: 'Inject CPU stress into ECS tasks',
          parameters: {
            duration: 'PT5M', // 5 minutes
            percent: '80', // target 80% CPU utilization
          },
          targets: {
            Tasks: 'myTasks'
          },
        },
      },
      experimentReportConfiguration:
      {
          outputs: {
            experimentReportS3Configuration: {
              bucketName: bucket.bucketName,

              // the properties below are optional
              prefix: 'ecs-cpu-stress-test-reports',
            },
          },
          // the properties below are optional
          dataSources: {
            cloudWatchDashboards: [{
              dashboardIdentifier: fisDashboard.dashboardArn,
            }],
          },
          postExperimentDuration: 'PT15M',
          preExperimentDuration: 'PT15M'
      },
      tags: {
        Name: 'my-ecs-cpu-stress-exp'
      },
      logConfiguration: {
        logSchemaVersion: 1,
        cloudWatchLogsConfiguration: {
          LogGroupArn: fisLogGroup.logGroupArn
        }
      }
    });

    // Attach AWSFaultInjectionSimulatorECSAccess managed policy to FIS role
    fisRole.addManagedPolicy(
      iam.ManagedPolicy.fromManagedPolicyArn(
        this,
        'FISECSAccessPolicy',
        'arn:aws:iam::aws:policy/service-role/AWSFaultInjectionSimulatorECSAccess'
      )
    );

    // Add inline policy for CloudWatch Logs actions
    fisRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "logs:CreateLogDelivery",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:CreateLogGroup",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "CloudWatch:GetDashboard"
      ],
      resources: ["*"]
    }));

    fisRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "logs:PutResourcePolicy",
        "logs:DescribeResourcePolicies"
      ],
      resources: ["*"]
    }));

    // Add ECS and SSM permissions
    fisRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "ecs:DescribeTasks",
        "ssm:SendCommand",
        "ssm:ListCommands",
        "ssm:CancelCommand"
      ],
      resources: ["*"]
    }));

    // Report permission to s3
    fisRole.addToPolicy(new iam.PolicyStatement({
        actions: [
            "s3:PutObject",
            "s3:GetObject",
            "s3:GetBucketLocation",
            "s3:ListBucket"
        ],
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`]
    }));

    // Report permission to get dashboard
    fisRole.addToPolicy(new iam.PolicyStatement({
        actions: [
            "cloudwatch:GetDashboard"
        ],
        resources: [fisDashboard.dashboardArn]
    }));

    // Report permission to Get widgets from dashboard
    fisRole.addToPolicy(new iam.PolicyStatement({
        actions: [
            "cloudwatch:GetMetricWidgetImage"
        ],
        resources: ["*"]
    }));

  }
}
