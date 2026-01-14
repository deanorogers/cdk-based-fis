import * as cdk from 'aws-cdk-lib';
import { CustomIngressController } from '../packages/custom-ingress-controller';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// define custom props to accept VPC
export interface MyIngressControllerStackProps extends cdk.StackProps {
    readonly vpc?: ec2.IVpc;
    readonly vpcEndpointServiceId?: string;
    readonly vpcEndpointServiceRegion?: string;
    readonly allowedRegion: string;  // Required parameter
}

export class MyIngressControllerStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: MyIngressControllerStackProps) {
     super(scope, id, props);

     const ingress = new CustomIngressController(this, 'MyIngressController', {
         vpc: props.vpc,
         vpcEndpointServiceId: props.vpcEndpointServiceId,
         vpcEndpointServiceRegion: props.vpcEndpointServiceRegion,
         allowedRegion: props.allowedRegion
     });

    /*
    ** Add routing rules to the Ingress Controller
    ** Lookup your service ALB to be targeted by the URL path
    */
    const accountALB = elbv2.ApplicationLoadBalancer.fromLookup(this, 'AccountALB', {
        loadBalancerTags: {
               'Name':  'AccountServiceALB'
        } // have to be clever than this for real
    });
    // ingress.addRoute('/accounts', accountALB.loadBalancerArn);

  }
 }