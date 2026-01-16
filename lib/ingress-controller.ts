import * as cdk from 'aws-cdk-lib';
import { CustomIngressController } from '../packages/custom-ingress-controller';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// define custom props to accept VPC
export interface MyIngressControllerStackProps extends cdk.StackProps {
    readonly vpc?: ec2.IVpc;
    readonly config: any;
}

export class MyIngressControllerStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: MyIngressControllerStackProps) {

     super(scope, id, props);

     const ingress = new CustomIngressController(this, 'MyIngressController', {
         vpc: props.vpc,
         vpcEndpointServiceId: props.config.vpcEndpointServiceId,
         vpcEndpointServiceRegion: props.config.vpcEndpointServiceRegion,
         allowedRegion: props.config.allowedRegion
     });


    console.log(`Adding routes to Ingress Controller`);
    /*
    ** Add routing rules to the Ingress Controller
    */
    for (const route of props.config.routes ?? []) {
        console.log(`Adding route: ${route.path} -> ${route.target_arn}`);
        ingress.addRoute(route.path, route.target_arn);
    }
  }
 }