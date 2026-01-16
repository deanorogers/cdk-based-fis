#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ECSServiceStack } from '../main';
import { MyFaultInjectionStack } from '../lib/fault-injection';
import { MyIngressControllerStack } from '../lib/ingress-controller';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as fs from 'fs';
import * as path from 'path';

const app = new cdk.App();

const stage = app.node.tryGetContext('stage') || 'dev';
const region = app.node.tryGetContext('region') || 'us-east-1';

if (!stage) {
    throw new Error('stage must be provided via -c stage=<stage>');
}
if (!region) {
    throw new Error('region must be provided via -c region=<region>');
}

const filename = `${stage}.${region}.context.json`;
const configPath = path.join(__dirname, '..', 'config', filename);

if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
}

const configFile = fs.readFileSync(configPath, 'utf-8');
const config = JSON.parse(configFile);

// Create ECS Service Stack

const ecsServiceStack = new ECSServiceStack(app, 'ECSServiceStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

// pass in cluster arn to be used in the experiment
const fisStack = new MyFaultInjectionStack(app, 'FaultInjectionStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

// // obtain value of vpcEndpointService from input
// const allowedRegion = app.node.tryGetContext('allowedRegion');
//
// if (!allowedRegion) {
//     throw new Error('allowedRegion must be provided via -c allowedRegion=<region>');
// }

const ingressStack = new MyIngressControllerStack(app, 'IngressControllerStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    vpc: ecsServiceStack.vpc,
    config: config
});
