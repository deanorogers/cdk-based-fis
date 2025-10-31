#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsFoundationStack } from '../lib/foundation';
import { EcsBlueGreenStack } from '../lib/service';
import { FaultInjectionStack } from '../fis';
import { EcsBlueGreenPipelineStack } from '../lib/pipeline';

const app = new cdk.App();

const name = 'customer-portal';
const portRange = 80;
const testPort = 8080;
const serviceName = 'api';

const ecsFoundationStack = new EcsFoundationStack(app, 'EcsFoundationStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    name: name,
    portRange: portRange,
    serviceName: serviceName
});

const ecsServiceStack = new EcsBlueGreenStack(app, 'EcsBlueGreenStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    taskRoleName: ecsFoundationStack.taskDefRoleName,
    taskExecRoleName: ecsFoundationStack.taskExecRoleName,
    serviceRoleArn: ecsFoundationStack.serviceRoleArn,
    portRange: portRange,
    testPort: testPort,
    name: name,
    serviceName: serviceName,
    vpc: ecsFoundationStack.vpc,
    ecrRepository: ecsFoundationStack.ecrRepository,
    imageTag: app.node.tryGetContext('imageTag') || 'latest',
    bucket: ecsFoundationStack.artifactBucket
});

// Create the pipeline stack
// CDK will automatically infer dependencies based on resource references
const pipelineStack = new EcsBlueGreenPipelineStack(app, 'EcsBlueGreenPipelineStack', {
  ecrRepository: ecsFoundationStack.ecrRepository,
  deploymentGroupName: ecsServiceStack.deploymentGroup.deploymentGroupName,
  clusterName: ecsServiceStack.cluster.clusterName,
  serviceName: ecsServiceStack.service.serviceName,
  taskDefinitionFamily: ecsServiceStack.taskDefinition.family,
  applicationName: ecsServiceStack.applicationName,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  artifactBucket: ecsFoundationStack.artifactBucket
});

// No need for explicit addDependency - CDK will handle it automatically
