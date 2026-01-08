import {CustomFisEcsCpuStress} from '../packages/custom-fis-ecs-cpu-stress';
import {readFileSync} from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as fis from 'aws-cdk-lib/aws-fis';
import {join} from 'path';
import {Template} from 'aws-cdk-lib/assertions';
import { FaultInjectionStack } from '../packages/custom-fault-injection-stack';
import { Match } from 'aws-cdk-lib/assertions';

/*
** this is testing the core components: stack & experiment
*/
describe('CustomFisEcsCpuStress', () => {
    const contextFile = JSON.parse(readFileSync(join(__dirname, '../cdk.context.json'), 'utf8'));
    let app = new cdk.App({context: contextFile});
    let myFaultInjectionStack: FaultInjectionStack;

    /*
    ** Given
    ** - Fault Injection Stack
    */
    beforeEach(() => {
        app = new cdk.App({context: contextFile});
        myFaultInjectionStack = new FaultInjectionStack(app, 'MyFaultInjectionStack', {
            env: { account: '123456789012', region: 'us-west-2' }
        });
    });

    test('should create a FIS Experiment Template with ECS CPU Stress action & targets', () => {

        /*
        ** When
        ** - provisions ECS CPU Stress Test
        ** - without report configuration
        */
        const fisExperiment = new CustomFisEcsCpuStress(myFaultInjectionStack, 'TestFisExperiment', {
//             roleArn: fisRole.roleArn,
            targets: {
                'ecsTaskTarget': {
                    resourceType: 'aws:ecs:task',
                    resourceArns: ['arn:aws:ecs:us-west-2:123456789012:task/test-cluster/test-task'],
                    selectionMode: 'ALL'
                }
            },
            actions: {
                'ecsCpuStressAction': {
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

        /*
        ** Then
        ** - Experiment template is created
        ** - ActionId is default
        ** - Description is default
        ** - Action duration is PT5M
        ** - Action percent is 80
        ** - experiment report config has output and duration values but no dashboard
        */
        const template = Template.fromStack(myFaultInjectionStack);
        template.resourceCountIs('AWS::FIS::ExperimentTemplate', 1);
        // Verify the properties of the FIS Experiment Template
        template.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
            Description: 'ECS CPU Stress Test Experiment Template',
//             RoleArn: 'arn:aws:iam::123456789012:role/FISRole', // RoleArn is dynamic across stacks, so we can't assert its exact value
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

    test('should create a FIS Experiment Template with ECS CPU Stress action and overridden report config', () => {

        // Given a CloudWatch dashboard is created in the stack
        const fisDashboard = new cdk.aws_cloudwatch.Dashboard(myFaultInjectionStack, 'FISDashboard', {
          dashboardName: 'FIS-ECS-CPU-Stress-Dashboard',
        });

        /*
        ** When
        ** - provisions ECS CPU Stress Test
        ** - with report configuration values to override defaults
        */
        const fisExperiment = new CustomFisEcsCpuStress(myFaultInjectionStack, 'TestFisExperiment', {
            targets: {
                'ecsTaskTarget': {
                    resourceType: 'aws:ecs:task',
                    resourceArns: ['arn:aws:ecs:us-west-2:123456789012:task/test-cluster/test-task'],
                    selectionMode: 'ALL'
                }
            },
            actions: {
                'ecsCpuStressAction': {
                    parameters: {
                        duration: 'PT5M',
                        percent: '80'
                    },
                    targets: {
                        'EcsTaskTarget': 'ecsTaskTarget'
                    }
                }
            },
            experimentReportConfiguration: {
                dataSources: {
                    cloudWatchDashboards: [
                        {
                            dashboardIdentifier: fisDashboard.dashboardArn
                        }
                    ]
                },
                preExperimentDuration: 'PT20M',
                postExperimentDuration: 'PT25M'
            },
            stopConditions: [
                {
                    source: 'none'
                }
            ]
        });

        /*
        ** Then
        ** - Experiment template is created and report config has:
        ** - Pre experiment duration is overridden to PT20M
        ** - Post experiment duration is overridden to PT25M
        ** - bucket name is correct
        ** - data source includes Cloudwatch dashboard
        */
        const template = Template.fromStack(myFaultInjectionStack);
        template.resourceCountIs('AWS::FIS::ExperimentTemplate', 1);
        // Verify the properties of the FIS Experiment Template
        template.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
            ExperimentReportConfiguration: {
                Outputs: {
                    ExperimentReportS3Configuration: {
                        BucketName: Match.objectLike({ Ref: Match.anyValue() })
                    },
                },
                PostExperimentDuration: 'PT25M',
                PreExperimentDuration: 'PT20M',
                DataSources: {
                    CloudWatchDashboards: [
                        {
                            DashboardIdentifier: Match.anyValue()
                        }
                    ]
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