import * as cdk from 'aws-cdk-lib';
import { Bucket, BucketProps, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CustomS3BucketProps extends BucketProps {}

export class CustomS3Bucket extends Bucket {
  constructor(scope: Construct, id: string, props?: CustomS3BucketProps) {
    super(scope, id, {
      ...props,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: undefined, // explicitly no encryption
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
  }
}
