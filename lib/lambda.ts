/*
** this only exists for the Remote TG to target in lieu of a VPC Endpoint
*/

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class HelloWorldLambdaStack extends cdk.Stack {

  public readonly helloWorldLambdaArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const fn = new lambda.Function(this, 'HelloWorldLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async () => {
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/plain" },
            body: "Request routed to VPC Endpoint (imagine)",
          };
        };
      `),
    });
    this.helloWorldLambdaArn = fn.functionArn;
  }
}
