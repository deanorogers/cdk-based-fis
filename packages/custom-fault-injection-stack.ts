import {aws_logs, RemovalPolicy} from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import {aws_fis as fis} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as fs from 'fs';

import { CustomS3Bucket } from './custom-s3-bucket';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';


/*
** Provision AWS Fault Injection Simulator (FIS) resources common to all experiments
*/
export class FaultInjectionStack extends cdk.Stack {

  public readonly fisRole: iam.IRole;
  public readonly bucket: CustomS3Bucket;

  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    const trustPolicy = JSON.parse(
      fs.readFileSync(`${__dirname}/fis-role-trust-policy.json`, 'utf8')
    );

    // Create the FIS role with a default principal
    const fisRole = new iam.Role(this, 'FISRole', {
      assumedBy: new iam.ServicePrincipal('fis.amazonaws.com'),
    });

    // Override the assumeRolePolicy with the custom trust policy
    (fisRole.node.defaultChild as iam.CfnRole).assumeRolePolicyDocument = trustPolicy;

    // create s3 bucket to hold experiment report
    const bucket = new CustomS3Bucket(this, 'FISExperimentReportBucket', {
        bucketName: `fis-experiment-report-bucket-${account}-${region}`,
        versioned: false
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

    this.fisRole = fisRole;
    this.bucket = bucket;

  }
}