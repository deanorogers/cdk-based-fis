/*
** this will be the custom deployment of the Fargate service
*/

// define step func stack
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sf from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class ControllerStack extends cdk.Stack {

      constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // --- Lambda: generates random number ---
        const randomLambda = new lambda.Function(this, 'RandomLambda', {
          runtime: lambda.Runtime.NODEJS_18_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline(`
            exports.handler = async () => {
              return { value: Math.random() };
            };
          `),
        });

        // --- Step Function: invokes the Lambda ---
       const randomTask = new tasks.LambdaInvoke(this, 'Invoke Random Lambda', {
            lambdaFunction: randomLambda,
            outputPath: '$.Payload',
        });

        // define a Success state
        const successState = new sf.Succeed(this, 'Success');

        // define a state that loops back to the randomTask
        const retryLoop = new sf.Pass(this, 'RetryLoop');

       // --- Step Function: Check if random number > 0.5, if greater then Success, else retryLoop ---
       const checkRandomChoice = new sf.Choice(this, 'Is Random > 0.5?')
        .when(sf.Condition.numberGreaterThan('$.value', 0.5), new sf.Succeed(this, 'Success'))
        .otherwise(retryLoop);

        // define the state machine flow
        const definition = randomTask
          .next(checkRandomChoice)
          .next(retryLoop.next(randomTask)); // loop back to randomTask

        // create the state machine
        new sf.StateMachine(this, 'ControllerStateMachine', {
          definition,
          timeout: cdk.Duration.minutes(5),
        });

      }
  }


