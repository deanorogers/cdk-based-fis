#!/usr/bin/env bash
# Update the image tag inside a CodeDeploy/CodePipeline deployment artifact zip
# - Downloads s3://$BUCKET/$KEY
# - Updates artifacts/imageDetail.json (and taskdef.json image fields when concrete URIs present)
# - Re-zips and uploads back to the same S3 location
#
# Requirements: awscli v2, jq, unzip, zip
#
# Usage:
#   ./updateImageDetail.sh <new-tag> [--bucket customer-portal-pipeline-artifacts] [--key deployment-artifacts.zip] [--profile default] [--region us-east-1]
#
# Examples:
#   ./updateImageDetail.sh 1.2.3
#   ./updateImageDetail.sh latest --profile prod --region us-east-1
#   ./updateImageDetail.sh 2025-11-18 --bucket customer-portal-pipeline-artifacts --key deployment-artifacts.zip
set -euo pipefail

# Defaults
BUCKET="customer-portal-pipeline-artifacts"
KEY="deployment-artifacts.zip"
AWS_PROFILE=""
AWS_REGION=""

usage() {
  echo "Usage: $0 <new-tag> [--bucket <bucket>] [--key <object-key>] [--profile <aws-profile>] [--region <aws-region>]" 1>&2
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" || $# -lt 1 ]]; then
  usage
  exit 1
fi

NEW_TAG="$1"; shift || true

# Parse optional flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)
      BUCKET="$2"; shift 2;;
    --key)
      KEY="$2"; shift 2;;
    --profile)
      AWS_PROFILE="$2"; shift 2;;
    --region)
      AWS_REGION="$2"; shift 2;;
    *)
      echo "Unknown argument: $1" 1>&2
      usage
      exit 1;;
  esac
done

# Ensure tools exist
for cmd in aws jq unzip zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command not found: $cmd" 1>&2
    exit 2
  fi
done

AWS_ARGS=()
[[ -n "$AWS_PROFILE" ]] && AWS_ARGS+=("--profile" "$AWS_PROFILE")
[[ -n "$AWS_REGION" ]] && AWS_ARGS+=("--region" "$AWS_REGION")

WORKDIR="$(mktemp -d)"
ZIP_PATH="$WORKDIR/$(basename "$KEY")"
UNPACK_DIR="$WORKDIR/unpacked"
mkdir -p "$UNPACK_DIR"

S3_URI="s3://$BUCKET/$KEY"
echo "Downloading $S3_URI ..."
aws s3 cp "$S3_URI" "$ZIP_PATH" "${AWS_ARGS[@]}"

# Unzip into working folder
unzip -o -q "$ZIP_PATH" -d "$UNPACK_DIR"

# Locate files (support both root and nested layouts)
IMG_DETAIL=""
TASKDEF=""

if [[ -f "$UNPACK_DIR/imageDetail.json" ]]; then
  IMG_DETAIL="$UNPACK_DIR/imageDetail.json"
else
  IMG_DETAIL="$(find "$UNPACK_DIR" -maxdepth 3 -type f -name 'imageDetail.json' | head -n 1 || true)"
fi

if [[ -f "$UNPACK_DIR/taskdef.json" ]]; then
  TASKDEF="$UNPACK_DIR/taskdef.json"
else
  TASKDEF="$(find "$UNPACK_DIR" -maxdepth 3 -type f -name 'taskdef.json' | head -n 1 || true)"
fi

if [[ -z "$IMG_DETAIL" || ! -f "$IMG_DETAIL" ]]; then
  echo "Error: imageDetail.json not found inside the artifact" 1>&2
  exit 3
fi

echo "Updating imageDetail.json tag to: $NEW_TAG"

# Read current ImageURI and compute new one by replacing the last :tag
CURRENT_URI="$(jq -r '.ImageURI' "$IMG_DETAIL")"
if [[ -z "$CURRENT_URI" || "$CURRENT_URI" == "null" ]]; then
  echo "Error: .ImageURI not found in $IMG_DETAIL" 1>&2
  exit 4
fi

# Remove trailing tag (after last colon) and append new tag
# Handles URIs like 123456789012.dkr.ecr.us-east-1.amazonaws.com/repo:oldtag
BASE_URI="${CURRENT_URI%:*}"
NEW_URI="$BASE_URI:$NEW_TAG"

# Write back
TMP_IMG_DETAIL="$IMG_DETAIL.tmp"
jq --arg uri "$NEW_URI" '.ImageURI = $uri' "$IMG_DETAIL" > "$TMP_IMG_DETAIL"
mv "$TMP_IMG_DETAIL" "$IMG_DETAIL"

# Re-pack: keep the original flat structure by zipping contents of UNPACK_DIR root
pushd "$UNPACK_DIR" >/dev/null
zip -q -r -X "$ZIP_PATH" .
popd >/dev/null

echo "Uploading updated artifact back to $S3_URI ..."
aws s3 cp "$ZIP_PATH" "$S3_URI" "${AWS_ARGS[@]}"

echo "Done. Updated ImageURI: $NEW_URI"

