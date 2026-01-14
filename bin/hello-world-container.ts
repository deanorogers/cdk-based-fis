#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ECSServiceStack } from '../main';
import { MyFaultInjectionStack } from '../lib/fault-injection';
import { MyIngressControllerStack } from '../lib/ingress-controller';

const app = new cdk.App();

const ecsServiceStack = new ECSServiceStack(app, 'ECSServiceStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

// pass in cluster arn to be used in the experiment
const fisStack = new MyFaultInjectionStack(app, 'FaultInjectionStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

// obtain value of vpcEndpointService from input
const allowedRegion = app.node.tryGetContext('allowedRegion');

if (!allowedRegion) {
    throw new Error('allowedRegion must be provided via -c allowedRegion=<region>');
}

const ingressStack = new MyIngressControllerStack(app, 'IngressControllerStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    vpc: ecsServiceStack.vpc,
    vpcEndpointServiceId: app.node.tryGetContext('vpcEndpointServiceId'),
    vpcEndpointServiceRegion: app.node.tryGetContext('vpcEndpointServiceRegion'),
    allowedRegion: allowedRegion
});