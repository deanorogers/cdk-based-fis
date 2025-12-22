import * as cdk from 'aws-cdk-lib';
import { FaultInjectionStack} from '../packages/custom-fault-injection-stack';
import { CustomFisEcsCpuStress } from '../packages/custom-fis-ecs-cpu-stress';

export class MyFaultInjectionStack extends FaultInjectionStack {
  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
     super(scope, id, props);

     /*
     ** Provision FIS Experiment Template to stress CPU of ECS tasks
     */
     const fisExperiment = new CustomFisEcsCpuStress(this, 'EcsCpuStressFisExperiment', {
        targets: {
            'ecsTaskTarget': {
                resourceType: 'aws:ecs:task',
                resourceTags: {
                  FIS_ENABLED: "true"
                },
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
                    'Tasks': 'ecsTaskTarget'
                }
            }
        },
        stopConditions: [
            {
                source: 'none'
            }
        ]
     });
  }
}