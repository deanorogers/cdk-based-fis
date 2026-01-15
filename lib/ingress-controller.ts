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
    readonly destinationAlb?: elbv2.IApplicationLoadBalancer;  // Optional ALB for routing
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
    ** this should be an iteration for contents of the json file
    */
//     ingress.addRoute('/accounts', "arn:aws:elasticloadbalancing:us-east-1:107404535822:loadbalancer/app/ECSSer-amazo-EEPPmj25r9Vg/620932af2ae4a228");
    ingress.addRoute('/accounts', "arn:aws:elasticloadbalancing:us-west-2:107404535822:loadbalancer/app/ECSSer-amazo-IN9Z4JM7Xnve/2ee56278d126f8ed");
  }
 }