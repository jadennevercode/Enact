#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="$ROOT_DIR/deploy/helm/enact"

require_rendered_value() {
  local rendered=$1
  local expected=$2

  if ! grep -Fq "$expected" <<<"$rendered"; then
    echo "Missing expected Helm-rendered config value:"
    echo "  $expected"
    exit 1
  fi
}

reject_rendered_value() {
  local rendered=$1
  local forbidden=$2

  if grep -Fq "$forbidden" <<<"$rendered"; then
    echo "Forbidden Helm-rendered config value:"
    echo "  $forbidden"
    exit 1
  fi
}

helm lint "$CHART_DIR"

default_config="$(
  helm template enact "$CHART_DIR" \
    --show-only templates/configmap.yaml
)"
require_rendered_value "$default_config" 'ENACT_VCS_INTEGRATION_ENABLED: "true"'
require_rendered_value "$default_config" 'ENACT_ENTITLEMENT_POLICY_ENABLED: "false"'
require_rendered_value "$default_config" 'ENACT_ENTITLEMENT_POLICY_URL: ""'
require_rendered_value "$default_config" 'ENACT_DATABASE_STARTUP_TIMEOUT: "3m"'
require_rendered_value "$default_config" 'ENACT_DATABASE_CONNECT_TIMEOUT: "5s"'
reject_rendered_value "$default_config" 'ENACT_ENTITLEMENT_SERVICE_TOKEN'

default_backend="$(
  helm template enact "$CHART_DIR" \
    --show-only templates/backend.yaml
)"
require_rendered_value "$default_backend" 'failureThreshold: 60'
liveness_block="$(sed -n '/livenessProbe:/,/resources:/p' <<<"$default_backend")"
require_rendered_value "$liveness_block" 'path: /health'
reject_rendered_value "$liveness_block" 'path: /healthz'

disabled_config="$(
  helm template enact "$CHART_DIR" \
    --show-only templates/configmap.yaml \
    --set backend.config.vcsIntegrationEnabled=false
)"
require_rendered_value "$disabled_config" 'ENACT_VCS_INTEGRATION_ENABLED: "false"'

entitlement_config="$(
  helm template enact "$CHART_DIR" \
    --show-only templates/configmap.yaml \
    --set backend.config.entitlementPolicy.enabled=true \
    --set-string backend.config.entitlementPolicy.url=https://enact-cloud.internal \
    --set-string backend.config.entitlementPolicy.timeout=2s \
    --set-string backend.config.entitlementPolicy.staleGrace=10m \
    --set backend.config.entitlementPolicy.emergencyDisabled=false
)"
require_rendered_value "$entitlement_config" 'ENACT_ENTITLEMENT_POLICY_ENABLED: "true"'
require_rendered_value "$entitlement_config" 'ENACT_ENTITLEMENT_POLICY_URL: "https://enact-cloud.internal"'
require_rendered_value "$entitlement_config" 'ENACT_ENTITLEMENT_POLICY_TIMEOUT: "2s"'
require_rendered_value "$entitlement_config" 'ENACT_ENTITLEMENT_STALE_GRACE: "10m"'
require_rendered_value "$entitlement_config" 'ENACT_ENTITLEMENT_EMERGENCY_DISABLED: "false"'
reject_rendered_value "$entitlement_config" 'ENACT_ENTITLEMENT_SERVICE_TOKEN'

echo "helm config rendering ok"
