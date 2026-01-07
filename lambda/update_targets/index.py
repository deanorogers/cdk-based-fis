import json
import boto3
import socket
import logging
import ipaddress

logger = logging.getLogger()
logger.setLevel(logging.INFO)

RFC6598 = ipaddress.ip_network('100.64.0.0/10')

# allow RFC1918 private ranges and RFC6598
def is_allowed_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return ip.is_private or (ip in RFC6598)


def resolve_alb_dns_from_arn(elbv2_client, alb_arn):
    # describe_load_balancers returns LoadBalancers with DNSName
    resp = elbv2_client.describe_load_balancers(LoadBalancerArns=[alb_arn])
    lbs = resp.get('LoadBalancers', [])
    if not lbs:
        raise RuntimeError(f'No load balancer found for ARN {alb_arn}')
    return lbs[0].get('DNSName')


def handler(event, context):
    elbv2 = boto3.client('elbv2')
    target_group_arn = event.get('TargetGroupArn')
    target_nlb_dns = event.get('TargetNlbDns')
    destination_alb_arn = event.get('DestinationAlbArn')

    logger.info("event: %s", json.dumps(event))
    logger.info("target_group_arn: %s", target_group_arn)
    logger.info("target_nlb_dns: %s", target_nlb_dns)
    logger.info("destination_alb_arn: %s", destination_alb_arn)

    if not target_group_arn:
        logger.error("Missing TargetGroupArn")
        return {'statusCode': 400, 'body': json.dumps('Missing TargetGroupArn')}

    # prefer explicit DestinationAlbArn if provided; otherwise fall back to resolving a provided NLB DNS
    if destination_alb_arn:
        try:
            alb_dns = resolve_alb_dns_from_arn(elbv2, destination_alb_arn)
        except Exception as e:
            logger.exception("Failed to describe ALB %s", destination_alb_arn)
            return {'statusCode': 500, 'body': json.dumps(f'Failed to describe ALB: {e}')}
    elif target_nlb_dns:
        # if caller passed NLB DNS that resolves to ALB IPs via private routing (less common), use that
        alb_dns = target_nlb_dns
    else:
        logger.error("Missing DestinationAlbArn or TargetNlbDns")
        return {'statusCode': 400, 'body': json.dumps('Missing DestinationAlbArn or TargetNlbDns')}

    try:
        resolved_ips = socket.gethostbyname_ex(alb_dns)[2]
    except Exception as e:
        logger.exception("DNS resolution failed for %s", alb_dns)
        return {'statusCode': 500, 'body': json.dumps(f'DNS resolution failed: {e}')}

    # filter out public/unallowed IPs
    allowed_ips = [ip for ip in resolved_ips if is_allowed_ip(ip)]
    skipped_ips = [ip for ip in resolved_ips if ip not in allowed_ips]

    if skipped_ips:
        logger.warning("Skipped public/unallowed IPs: %s", skipped_ips)

    if not allowed_ips:
        logger.error("No allowed IPs to register for %s", alb_dns)
        return {'statusCode': 400, 'body': json.dumps('No allowed IPs to register (targets must be in VPC/RFC1918/RFC6598)')}

    targets = [{'Id': ip, 'Port': 80} for ip in allowed_ips]

    try:
        elbv2.register_targets(TargetGroupArn=target_group_arn, Targets=targets)
    except Exception as e:
        logger.exception("Failed to register targets")
        return {'statusCode': 500, 'body': json.dumps(f'RegisterTargets failed: {e}')}

    return {'statusCode': 200, 'body': json.dumps({'message': 'Targets updated successfully', 'registered': allowed_ips, 'skipped': skipped_ips})}
