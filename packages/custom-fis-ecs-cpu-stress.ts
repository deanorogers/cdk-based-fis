import { aws_fis as fis } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Token } from 'aws-cdk-lib/core';
import * as aws_logs from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy } from 'aws-cdk-lib';


export interface CustomFisEcsCpuStressActionProperty extends Omit<fis.CfnExperimentTemplate.ExperimentTemplateActionProperty, 'actionId' | 'description'> {
    actionId?: 'aws:ecs:task-cpu-stress';
    description?: 'Stress CPU on ECS tasks';
}


/* redefine ExperimentTemplateExperimentReportConfigurationProperty in order to
** omit outputs (hard-coded in the class)
** the following 2 properties are already optional and default values are provided by the custom/child class:
** - postExperimentDuration
** - preExperimentDuration
*/
export interface CustomExperimentReportConfigurationProperty extends Omit<fis.CfnExperimentTemplate.ExperimentTemplateExperimentReportConfigurationProperty, 'outputs'> {
}


/*
** refine actions
** refine experimentReportConfiguration
** provide fixed values for:
** - tags
** - logConfiguration
*/
export interface CustomFisEcsCpuStressProps extends Omit<fis.CfnExperimentTemplateProps, 'roleArn' | 'description' | 'actions' | 'experimentReportConfiguration' | 'tags' | 'logConfiguration'> {
    actions: {
        [key: string]: CustomFisEcsCpuStressActionProperty;
    };
    experimentReportConfiguration?: CustomExperimentReportConfigurationProperty;
}


export class CustomFisEcsCpuStress extends fis.CfnExperimentTemplate {

    // call super with modified props
    constructor(scope: Construct, id: string, props: CustomFisEcsCpuStressProps) {

        // get fisRole from current stack
        const fisRole = (scope as any).fisRole;
        const bucket = (scope as any).bucket;

        const userReportConfig = props.experimentReportConfiguration;

        // Exclude experimentReportConfiguration from props spread to avoid type conflict
        const { experimentReportConfiguration: _excludedReportConfig, ...restProps } = props;

        // Create log group using parent scope BEFORE super()
        const fisLogGroup = new aws_logs.LogGroup(scope, `${id}-LogGroup`, {
            logGroupName: `/aws/fis/${id}`,
            retention: aws_logs.RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        if ( userReportConfig?.dataSources && !Token.isUnresolved(userReportConfig.dataSources) ) {
            const dataSources = userReportConfig.dataSources as fis.CfnExperimentTemplate.DataSourcesProperty;
            const dashboards = dataSources.cloudWatchDashboards as fis.CfnExperimentTemplate.CloudWatchDashboardProperty[];
            // ensure at least one dashboard is provided
            if (!dashboards || dashboards.length === 0) {
                throw new Error('experimentReportConfiguration.dataSources.cloudWatchDashboards is required - at least one Cloudwatch dashboard must be provided');
            }
            fisRole.addToPolicy(new iam.PolicyStatement({
                actions: [
                    "cloudwatch:GetDashboard"
                ],
                resources: [dashboards[0].dashboardIdentifier]
            }));
            fisRole.addToPolicy(new iam.PolicyStatement({
                actions: [
                    "cloudwatch:GetMetricWidgetImage"
                ],
                resources: ["*"]
            }));
        } else {
            // For now don't enforce a Cloudwatch dashboard
            // throw new Error('experimentReportConfiguration.dataSources is required - referencing a Cloudwatch dashboard');
        }

        let modifiedProps: Partial<fis.CfnExperimentTemplateProps> = {
            ...restProps,
            roleArn: fisRole.roleArn,
            description: 'ECS CPU Stress Test Experiment Template',
            actions: Object.fromEntries(
                Object.entries(props.actions).map(([key, action]) => [
                    key,
                    {
                        ...action,
                        actionId: action.actionId ?? 'aws:ecs:task-cpu-stress',
                        description: action.description ?? 'Stress CPU on ECS tasks',
                    },
                ])
            ),
            tags: {
              Name: 'my-ecs-cpu-stress-exp'
            },
            logConfiguration: {
              logSchemaVersion: 1,
              cloudWatchLogsConfiguration: {
                LogGroupArn: fisLogGroup.logGroupArn
              }
            }
        };

        if (userReportConfig) {
            const reportConfig = {
                dataSources: userReportConfig.dataSources,
                postExperimentDuration: userReportConfig.postExperimentDuration ?? 'PT15M',
                preExperimentDuration: userReportConfig.preExperimentDuration ?? 'PT15M',
                outputs: {
                    experimentReportS3Configuration: {
                        bucketName: bucket.bucketName,
                        prefix: 'ecs-cpu-stress-test-reports',
                    },
                },
            } as fis.CfnExperimentTemplate.ExperimentTemplateExperimentReportConfigurationProperty;

            // reassign the whole object (avoids writing to a readonly property)
            modifiedProps = { ...modifiedProps, experimentReportConfiguration: reportConfig };
        }
        super(scope, id, modifiedProps as fis.CfnExperimentTemplateProps);
    }

}
