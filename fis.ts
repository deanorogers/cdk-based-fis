import * as cdk from 'aws-cdk-lib';
import {aws_fis as fis} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';

export class FaultInjectionStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props);

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
      tags: {
        Name: 'my-ecs-cpu-stress-exp'
      }
    });

  }
}
