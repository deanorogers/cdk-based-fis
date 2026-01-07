import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as assetPath from 'path';
import * as elasticloadbalancingv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';

export interface CustomIngressControllerProps extends cdk.ResourceProps {
    readonly vpc?: ec2.IVpc;
}

export class CustomIngressController extends cdk.Resource {
  public readonly vpc: ec2.IVpc;
  private alb: cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  private localTargetGroup : cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup;
  private listener : cdk.aws_elasticloadbalancingv2.ApplicationListener;

  constructor(scope: Construct, id: string, props?: CustomIngressControllerProps) {
    super(scope, id, {
      ...props
    });

    // lookup default VPC if not provided
    this.vpc = props?.vpc ?? ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // define a security group for the ALB that allows inbound HTTP port 80 from anywhere and egress to anywhere on port 80
    const controllerSg = new ec2.SecurityGroup(this, 'IngressControllerALBSG', {
      vpc: this.vpc,
      description: 'Security group for Ingress Controller ALB',
      allowAllOutbound: true,
    });
    controllerSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound from anywhere');

    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, 'ALB', {
      loadBalancerName: 'CustomIngressControllerALB',
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: controllerSg,
    });
    this.alb = alb;

    this.listener = alb.addListener('Listener', {
        port: 80,
        open: true,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
            contentType: 'text/plain',
            messageBody: 'Resource Not Found'
        })
    });

  } // end of constructor

  /* for route provision the following resources
  ** - create local & remote target groups
  ** - create path-based listener rule
  ** - provision lambda function to update target groups (not implemented here)
  ** - input params:
  ** -- path, e.g. /accounts
  ** -- target, the service ALB
  */
  public addRoute(path: string, destinationAlbArn: string) {

    // remove leading slash and convert first letter to uppercase, e.g. /accounts -> Accounts
    // can then be used for resource naming
    const rawName: string = path.replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '-');
    const pathBasedName: string = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1)) : rawName;

    // define target group name using sanitized & capitalized pathBasedName
    const targetGroupNameLocal = `TGLocalFor${pathBasedName}`;
    const targetGroupNameRemote = `TGRemoteFor${pathBasedName}`;

    const localTargetGroup = new elbv2.ApplicationTargetGroup(this, targetGroupNameLocal, {
            vpc: this.vpc,
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP
    });

    const remoteTargetGroup = new elbv2.ApplicationTargetGroup(this, targetGroupNameRemote, {
            vpc: this.vpc,
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP
    });

    // add weighted rule to listener for path, e.g. 90% local, 10% remote. keep the leading slash
    const rulePriority = Math.floor(Math.random() * 10000);
    this.listener.addAction(`RuleFor${pathBasedName}`, {
         priority: rulePriority,
         conditions: [
             elbv2.ListenerCondition.pathPatterns([path])
         ],
         action: elbv2.ListenerAction.weightedForward([
             {
                 targetGroup: localTargetGroup,
                 weight: 90
             },
             {
                 targetGroup: remoteTargetGroup,
                 weight: 10
             }
         ]),
     });

    // create an internal NLB to target the service's ALB
    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(this, `NLBFor${pathBasedName}`, {
      vpc: this.vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const nlbTargetGroup = new elbv2.NetworkTargetGroup(this, `NLBTargetFor${pathBasedName}`, {
      vpc: this.vpc,
      port: 80,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.ALB,
    });

    // the NLB needs a listener on port 80 and attach the network target group as its default
    const nlbListener = nlb.addListener(`NLBListenerFor${pathBasedName}`, {
      port: 80,
      defaultTargetGroups: [nlbTargetGroup],
    });

    const albArnTarget = new elasticloadbalancingv2_targets.AlbArnTarget(destinationAlbArn, 80);
    nlbTargetGroup.addTarget(albArnTarget);

    const fnName = `IngressControllerUpdateTargetsFor${pathBasedName}`;

    // create a security group for the Lambda so it runs in the VPC with outbound access
    const lambdaSg = new ec2.SecurityGroup(this, `LambdaSGFor${pathBasedName}`, {
      vpc: this.vpc,
      description: `Security group for lambda updating target group for ${path}`,
      allowAllOutbound: true,
    });

    // define a python lambda function to lookup the target NLB DNS and update the localTargetGroup with the resolved IPs
    // for real this would package the source code and be triggered periodically
    const alb_registration_function = new cdk.aws_lambda.Function(this, `UpdateTargetGroupFunctionFor${pathBasedName}`, {
        functionName: fnName,
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_9,
        handler: 'index.handler',
        code: cdk.aws_lambda.Code.fromAsset(assetPath.join(__dirname, '..', 'lambda', 'update_targets')),
        timeout: cdk.Duration.minutes(1),
        // run the Lambda inside the stack VPC so DNS resolves to private IPs when the ALB is internal
        vpc: this.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [lambdaSg],
      });

    // invoke alb_registration_function with an event containing the target group ARN and destination NLB DNS
    new cdk.aws_lambda.CfnPermission(this, `InvokePermissionFor${pathBasedName}`, {
        action: 'lambda:InvokeFunction',
        functionName: alb_registration_function.functionName,
        principal: 'events.amazonaws.com',
    });

    const rule = new cdk.aws_events.Rule(this, `ScheduleRuleFor${pathBasedName}`, {
        schedule: cdk.aws_events.Schedule.rate(cdk.Duration.minutes(5)),
    });

    // schedule the Lambda to register the (private) IPs of the destination ALB into the NLB Network Target Group
    // Pass the DestinationAlbArn (and NLB DNS as fallback) so the lambda can describe the ALB and resolve its DNS
    rule.addTarget(new cdk.aws_events_targets.LambdaFunction(alb_registration_function, {
        event: cdk.aws_events.RuleTargetInput.fromObject({
            TargetGroupArn: localTargetGroup.targetGroupArn,
            TargetNlbDns: nlb.loadBalancerDnsName
        })
    }));

    // allow the Lambda to describe the destination ALB so it can obtain the DNSName
    alb_registration_function.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['elasticloadbalancing:DescribeLoadBalancers'],
      resources: [destinationAlbArn],
    }));

    // permissions so the Lambda can register/deregister IP targets into the NLB Network Target Group
    alb_registration_function.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets'
      ],
      resources: [localTargetGroup.targetGroupArn]
    }));

    // keep a narrow policy for RegisterTargets specifically (redundant but explicit)
    alb_registration_function.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['elasticloadbalancing:RegisterTargets'],
        resources: [localTargetGroup.targetGroupArn]
    }));

    // create the log group that StartQuery will target
    new logs.LogGroup(this, `LogGroupFor${fnName}`, {
      logGroupName: `/aws/lambda/${fnName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

  } // end addRoute

}
