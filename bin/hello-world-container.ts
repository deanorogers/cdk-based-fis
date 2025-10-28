#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsFoundationStack } from '../lib/foundation';
import { EcsBlueGreenStack } from '../lib/service';
import { FaultInjectionStack } from '../fis';

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
    vpc: ecsFoundationStack.vpc
});

// // pass in cluster arn to be used in the experiment
// const fisStack = new FaultInjectionStack(app, 'FaultInjectionStack', {
//     env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
// });
