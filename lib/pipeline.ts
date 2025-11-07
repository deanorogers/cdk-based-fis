import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface EcsBlueGreenPipelineProps extends cdk.StackProps {
  ecrRepository: ecr.IRepository;
  deploymentGroupName: string;
  clusterName: string;
  serviceName: string;
  taskDefinitionFamily: string;
  applicationName: string;
  artifactBucket: s3.IBucket;
}

export class EcsBlueGreenPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsBlueGreenPipelineProps) {
    super(scope, id, props);

    // Create the pipeline WITHOUT reusing the foundation artifact bucket (avoid creating bucket-policy cycles)
    const pipeline = new codepipeline.Pipeline(this, 'EcsBlueGreenPipeline', {
      pipelineName: 'ecs-blue-green-pipeline',
    });

    // Grant the pipeline IAM role permissions to read the specific object and list the bucket.
    // Do NOT use bucket.grantRead(...) because that would add a bucket policy into the foundation stack
    // referencing the pipeline role (creating foundation -> pipeline dependency and a cycle).
    pipeline.role.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      // produce a CloudFormation string by joining bucketArn + '/' + deployedObjectKey (the latter may be a Token)
      resources: [cdk.Fn.join('', [props.artifactBucket.bucketArn, '/', cdk.Fn.importValue(`${props.serviceName}-appspec-s3-key`)])],
      effect: iam.Effect.ALLOW
    }));
    pipeline.role.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket', 's3:GetBucketLocation'],
      resources: [props.artifactBucket.bucketArn],
      effect: iam.Effect.ALLOW
    }));

    // Source stage - triggered by ECR image push
    const s3SourceOutput = new codepipeline.Artifact('S3SourceOutput');
    const ecrSourceOutput = new codepipeline.Artifact('EcrSourceOutput');

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: 'S3_Source',
          bucket: props.artifactBucket,
          // use the deployedObjectKey from the ECS service stack (it already references the full key)
          bucketKey: cdk.Fn.importValue(`${props.serviceName}-appspec-s3-key`), // Import the exported value
          output: s3SourceOutput,
          trigger: codepipeline_actions.S3Trigger.NONE // Don't trigger on S3 changes
        })
      ]
    });

    // Reference the existing CodeDeploy deployment group
    const deploymentGroup = codedeploy.EcsDeploymentGroup.fromEcsDeploymentGroupAttributes(
      this,
      'DeploymentGroup',
      {
        application: codedeploy.EcsApplication.fromEcsApplicationName(
          this,
          'EcsApp',
            props.applicationName
        ),
        deploymentGroupName: props.deploymentGroupName,
      }
    );

    // Deploy stage using CodeDeploy
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.CodeDeployEcsDeployAction({
          actionName: 'BlueGreenDeploy',
          deploymentGroup: deploymentGroup,
          // appSpecTemplateInput: s3SourceOutput,
          appSpecTemplateFile: s3SourceOutput.atPath('appspec.yaml'),
          taskDefinitionTemplateFile: s3SourceOutput.atPath('taskdef.json'),
          containerImageInputs: [
            {
              input: s3SourceOutput,
              taskDefinitionPlaceholder: 'IMAGE1_NAME'
            },
          ]
        }),
      ],
    });

    // Grant ECR permissions to CodePipeline
    props.ecrRepository.grantPull(pipeline.role);

    // Outputs
    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'ECS Blue/Green Pipeline Name',
    });

    new cdk.CfnOutput(this, 'PipelineArn', {
      value: pipeline.pipelineArn,
      description: 'ECS Blue/Green Pipeline ARN',
    });
  }
}
