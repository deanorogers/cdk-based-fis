import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

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

    // Create the pipeline
    const pipeline = new codepipeline.Pipeline(this, 'EcsBlueGreenPipeline', {
      pipelineName: 'ecs-blue-green-pipeline',
      // artifactBucket: props.artifactBucket
    });

    // Source stage - triggered by ECR image push
    const s3SourceOutput = new codepipeline.Artifact('S3SourceOutput');
    const ecrSourceOutput = new codepipeline.Artifact('EcrSourceOutput');

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: 'S3_Source',
          bucket: props.artifactBucket,
          bucketKey: 'api',
          output: s3SourceOutput,
          trigger: codepipeline_actions.S3Trigger.NONE, // Don't trigger on S3 changes
        }),
        new codepipeline_actions.EcrSourceAction({
          actionName: 'ECR_Source',
          repository: props.ecrRepository,
          output: ecrSourceOutput
        }),
      ],
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
          // taskDefinitionTemplateInput: s3SourceOutput,
          taskDefinitionTemplateFile: s3SourceOutput.atPath('taskdef.json'),
          containerImageInputs: [
            {
              input: ecrSourceOutput,
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
