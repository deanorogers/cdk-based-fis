import {CustomFisEcsCpuStress} from '../custom-fis-ecs-cpu-stress';
import {readFileSync} from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as fis from 'aws-cdk-lib/aws-fis';
import {join} from 'path';
import {Template} from 'aws-cdk-lib/assertions';

describe('CustomFisEcsCpuStress', () => {
    const contextFile = JSON.parse(readFileSync(join(__dirname, '../cdk.context.json'), 'utf8'));
    const app = new cdk.App({context: contextFile});

    const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
    });


    // write test for CustomFisEcsCpuStress
    test('should create a FIS Experiment Template with ECS CPU Stress action', () => {
        const fisExperiment = new CustomFisEcsCpuStress(stack, 'TestFisExperiment', {
            roleArn: 'arn:aws:iam::123456789012:role/FISRole',
            description: 'Test ECS CPU Stress Experiment',
            targets: {
                'ecsTaskTarget': {
                    resourceType: 'aws:ecs:task',
                    resourceArns: ['arn:aws:ecs:us-west-2:123456789012:task/test-cluster/test-task'],
                    selectionMode: 'ALL'
                }
            },
            actions: {
                'ecsCpuStressAction': {
//                     actionId: 'aws:ecs:task-cpu-stress',
//                     description: 'Stress CPU on ECS tasks',
                    parameters: {
                        duration: 'PT5M',
                        percent: '80'
                    },
                    targets: {
                        'EcsTaskTarget': 'ecsTaskTarget'
                    }
                }
            },
            stopConditions: [
                {
                    source: 'none'
                }
            ]
        });

        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::FIS::ExperimentTemplate', 1);
        // Verify the properties of the FIS Experiment Template
        template.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
            Description: 'Test ECS CPU Stress Experiment',
            RoleArn: 'arn:aws:iam::123456789012:role/FISRole',
            Targets: {
                'ecsTaskTarget': {
                    ResourceType: 'aws:ecs:task',
                    ResourceArns: ['arn:aws:ecs:us-west-2:123456789012:task/test-cluster/test-task'],
                    SelectionMode: 'ALL'
                }
            },
            Actions: {
                'ecsCpuStressAction': {
                    ActionId: 'aws:ecs:task-cpu-stress',
                    Description: 'Stress CPU on ECS tasks',
                    Parameters: {
                        duration: 'PT5M',
                        percent: '80'
                    },
                    Targets: {
                        'EcsTaskTarget': 'ecsTaskTarget'
                    }
                }
            },
            StopConditions: [
                {
                    Source: 'none'
                }
            ]
        });

    });
});