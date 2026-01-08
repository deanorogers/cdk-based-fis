#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ECSServiceStack } from '../main';
import { MyFaultInjectionStack } from '../lib/fault-injection';

const app = new cdk.App();

const ecsServiceStack = new ECSServiceStack(app, 'ECSServiceStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

// pass in cluster arn to be used in the experiment
const fisStack = new MyFaultInjectionStack(app, 'FaultInjectionStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});
