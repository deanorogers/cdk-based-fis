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


def handler(event, context):
    elbv2 = boto3.client('elbv2')
    target_group_arn = event.get('TargetGroupArn')
    target_nlb_dns = event.get('TargetNlbDns')

    logger.info("event: %s", json.dumps(event))
    logger.info("target_group_arn: %s", target_group_arn)
    logger.info("target_nlb_dns: %s", target_nlb_dns)

    if not target_group_arn or not target_nlb_dns:
        logger.error("Missing TargetGroupArn or TargetNlbDns")
        return {'statusCode': 400, 'body': json.dumps('Missing parameters')}

    try:
        # resolve DNS name to IPs
        resolved_ips = socket.gethostbyname_ex(target_nlb_dns)[2]
    except Exception as e:
        logger.exception("DNS resolution failed for %s", target_nlb_dns)
        return {'statusCode': 500, 'body': json.dumps(f'DNS resolution failed: {e}')}

    # filter out public/unallowed IPs
    allowed_ips = [ip for ip in resolved_ips if is_allowed_ip(ip)]
    skipped_ips = [ip for ip in resolved_ips if ip not in allowed_ips]

    if skipped_ips:
        logger.warning("Skipped public/unallowed IPs: %s", skipped_ips)

    if not allowed_ips:
        logger.error("No allowed IPs to register for %s", target_nlb_dns)
        return {'statusCode': 400, 'body': json.dumps('No allowed IPs to register (targets must be in VPC/RFC1918/RFC6598)')}

    targets = [{'Id': ip, 'Port': 80} for ip in allowed_ips]

    try:
        elbv2.register_targets(TargetGroupArn=target_group_arn, Targets=targets)
    except Exception as e:
        logger.exception("Failed to register targets")
        return {'statusCode': 500, 'body': json.dumps(f'RegisterTargets failed: {e}')}

    return {'statusCode': 200, 'body': json.dumps({'message': 'Targets updated successfully', 'registered': allowed_ips, 'skipped': skipped_ips})}

