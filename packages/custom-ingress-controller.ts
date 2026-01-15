import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as assetPath from 'path';
import * as elasticloadbalancingv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as cr from 'aws-cdk-lib/custom-resources';

export interface CustomIngressControllerProps extends cdk.ResourceProps {
    readonly vpc?: ec2.IVpc;
    readonly vpcEndpointServiceId?: string;
    readonly vpcEndpointServiceRegion?: string;
    readonly allowedRegion: string;  // Required parameter
}

export class CustomIngressController extends cdk.Resource {
  public readonly vpc: ec2.IVpc;
  public alb: cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  private localTargetGroup : cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup;
  private remoteTargetGroup : cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup;
  private listener : cdk.aws_elasticloadbalancingv2.ApplicationListener;
  private internalListener : cdk.aws_elasticloadbalancingv2.ApplicationListener;

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

    // Create S3 bucket for ALB access logs
    const albLogsBucket = new cdk.aws_s3.Bucket(this, 'ALBLogsBucket', {
      bucketName: `alb-logs-osprey-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
    });

    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, 'ALB', {
      loadBalancerName: 'CustomIngressControllerALB',
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: controllerSg,
    });
    // Enable access logs after creating the ALB
    alb.logAccessLogs(albLogsBucket, 'alb-access-logs');
    this.alb = alb;

    cdk.Tags.of(alb).add('MANAGED', 'true');

    this.listener = alb.addListener('Listener', {
        port: 80,
        open: true,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
            contentType: 'text/plain',
            messageBody: 'Resource Not Found'
        })
    });

    this.internalListener = alb.addListener('InternalListener', {
        port: 8080,
        open: true,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
            contentType: 'text/plain',
            messageBody: 'Resource Not Found'
        })
    });

    // define remote target group but leave unattached for now
    this.remoteTargetGroup = new elbv2.ApplicationTargetGroup(this, 'IngressControllerRemoteTargetGroup', {
            vpc: this.vpc,
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targetGroupName: 'IngressControllerRemoteTG'
    });

    cdk.Tags.of(this.remoteTargetGroup).add('Name', 'IngressControllerRemoteTG');

   /*********************************************************************************
   ** provision NLB to terminate VPC Endpoint connections
   ** the NLB targets the internal listener of the ALB
   **********************************************************************************/
    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(this, 'IngressControllerNLB', {
        vpc: this.vpc,
        internetFacing: false,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const nlbTargetGroup = new elbv2.NetworkTargetGroup(this, 'IngressControllerNLBTargetGroup', {
      targetGroupName: 'CrossRegionNLBtg',
      vpc: this.vpc,
      port: 8080,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.ALB,
      healthCheck: {
          enabled: true,
          protocol: elbv2.Protocol.HTTP,
          port: '8080',
          path: '/',
          healthyHttpCodes: '404',
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(10),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
      },
    });

    const albTarget = new elasticloadbalancingv2_targets.AlbTarget(this.alb, 8080);
    nlbTargetGroup.addTarget(albTarget);

    // attach the target group to a listener on the NLB
    const nlbListener = nlb.addListener('IngressControllerNLBListener', {
      port: 80,
      defaultTargetGroups: [nlbTargetGroup],
    });

    // define VPC Endpoint Service for the NLB so other regions can connect
    if (!props) {
      throw new Error('Props must be provided to CustomIngressController');
    }

    const vpcEndpointService = new ec2.VpcEndpointService(this, 'IngressControllerVPCEndpointService', {
      vpcEndpointServiceLoadBalancers: [nlb],
      acceptanceRequired: false,
      allowedRegions: [props.allowedRegion],
      allowedPrincipals: [new iam.AccountPrincipal(cdk.Stack.of(this).account)]
    });

   /********************************************************************************/


    // the stack is created without establishing the VPC Endpoint connection
    if (props?.vpcEndpointServiceId) {

        const serviceName = `com.amazonaws.vpce.${props.vpcEndpointServiceRegion}.${props.vpcEndpointServiceId}`;

        // conditionally define the egress vpc endpoint if VpcEndpointService prop provided
        const endpoint = new ec2.InterfaceVpcEndpoint(this, 'CrossRegionEndpoint', {
            vpc: this.vpc,
            service: new ec2.InterfaceVpcEndpointService(serviceName, 80),
            serviceRegion: props.vpcEndpointServiceRegion,
            privateDnsEnabled: false,
            // subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        });

        // Select the subnets used by the endpoint so we can iterate over them
       const subnets = this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS });

       // Iterate through each subnet to handle its corresponding ENI
       subnets.subnetIds.forEach((subnetId, index) => {
           // 1. Retrieve the specific ENI ID for this index from the Endpoint construct
           const eniId = cdk.Fn.select(index, endpoint.vpcEndpointNetworkInterfaceIds);

           // 2. Create a Custom Resource to fetch the Private IP of that ENI at runtime
           const getEniIp = new cr.AwsCustomResource(this, `GetEndpointIp-${index}`, {
               onCreate: {
                   service: 'EC2',
                   action: 'describeNetworkInterfaces',
                   parameters: { NetworkInterfaceIds: [eniId] },
                   physicalResourceId: cr.PhysicalResourceId.of(`IpResolver-${index}`),
               },
               onUpdate: {
                   service: 'EC2',
                   action: 'describeNetworkInterfaces',
                   parameters: { NetworkInterfaceIds: [eniId] },
                   physicalResourceId: cr.PhysicalResourceId.of(`IpResolver-${index}`),
               },
               policy: cr.AwsCustomResourcePolicy.fromStatements([
                   new iam.PolicyStatement({
                       actions: ['ec2:DescribeNetworkInterfaces'],
                       resources: ['*'],
                   }),
               ]),
           });

           // 3. Extract the Private IP address from the API response
           const ip = getEniIp.getResponseField('NetworkInterfaces.0.PrivateIpAddress');

           // 4. Add the resolved IP as a target to the remote target group
           this.remoteTargetGroup.addTarget(
               new elbv2_targets.IpTarget(ip, 80)
           );
       });
    }

  } // end of constructor

  /* for route provision the following resources
  ** - provision a service-specific NLB
  ** - provision local target group
  ** - register IPs of service-specific NLB in local target group
  ** - configure external ALB
  **  |-- create path-based listener action to forward to local & remote target groups with weights
  ** - configure internal ALB
  **  |-- create path-based listener action to forward to local target group only
  */
  public addRoute(path: string, destinationAlbArn: string) {

    // remove leading slash and convert first letter to uppercase, e.g. /accounts -> Accounts
    // can then be used for resource naming
    const rawName: string = path.replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '-');
    const pathBasedName: string = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1)) : rawName;

    // define target group name using sanitized & capitalized pathBasedName
    const targetGroupNameLocal = `TGLocalFor${pathBasedName}`;

    const localTargetGroup = new elbv2.ApplicationTargetGroup(this, targetGroupNameLocal, {
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
                 targetGroup: this.remoteTargetGroup,
                 weight: 10
             }
         ]),
     });

    // add path based rule to internalListener to localTargetGroup
    this.internalListener.addAction(`InternalRuleFor${pathBasedName}`, {
         priority: rulePriority,
         conditions: [
             elbv2.ListenerCondition.pathPatterns([path])
         ],
         action: elbv2.ListenerAction.forward([localTargetGroup]),
     });

    // create an internal NLB to target the service's ALB
    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(this, `NLBFor${pathBasedName}`, {
      vpc: this.vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      loadBalancerName: `NLBFor${pathBasedName}`
    });

    const nlbTargetGroup = new elbv2.NetworkTargetGroup(this, `NLBTargetFor${pathBasedName}`, {
      vpc: this.vpc,
      port: 80,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.ALB
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
