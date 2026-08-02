#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="doc-ops-smoke"

usage() {
  cat <<'EOF'
Usage: entrypoint.sh <command>

Commands:
  init-profile              Securely enter App ID and App Secret inside the container
  auth-login                Start docs/drive/base user authorization and return JSON
  auth-complete <code>      Complete a previously initiated device authorization
  status                    Verify isolated profile authentication state
  profile-show              Show isolated profile configuration with masked secret
  qrcode <url>              Generate /state/auth-qr.png for the opaque URL
  smoke-corpus              Validate the synthetic corpus
  smoke-simulate <run-id>   Run the hermetic stateful fake tenant
  lark <args...>            Run an explicit lark-cli command inside the sandbox
EOF
}

command_name="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command_name" in
  init-profile)
    printf 'App ID: '
    IFS= read -r DOC_OPS_APP_ID
    printf 'App Secret: '
    IFS= read -r -s DOC_OPS_APP_SECRET
    printf '\n'
    if [[ -z "$DOC_OPS_APP_ID" || -z "$DOC_OPS_APP_SECRET" ]]; then
      unset DOC_OPS_APP_ID DOC_OPS_APP_SECRET
      printf 'App ID and App Secret are required.\n' >&2
      exit 2
    fi
    trap 'unset DOC_OPS_APP_ID DOC_OPS_APP_SECRET' EXIT HUP INT TERM
    printf '%s' "$DOC_OPS_APP_SECRET" | lark-cli config init \
      --app-id "$DOC_OPS_APP_ID" \
      --app-secret-stdin \
      --brand feishu \
      --name doc-ops-smoke
    unset DOC_OPS_APP_ID DOC_OPS_APP_SECRET
    trap - EXIT HUP INT TERM
    ;;
  auth-login)
    exec lark-cli auth login \
      --domain docs \
      --domain drive \
      --domain base \
      --no-wait \
      --json \
      --profile "$PROFILE_NAME"
    ;;
  auth-complete)
    if [[ $# -ne 1 || -z "$1" ]]; then
      printf 'auth-complete requires one device code.\n' >&2
      exit 2
    fi
    exec lark-cli auth login --device-code "$1" --profile "$PROFILE_NAME"
    ;;
  status)
    exec lark-cli auth status --json --verify --profile "$PROFILE_NAME"
    ;;
  profile-show)
    exec lark-cli config show --profile "$PROFILE_NAME"
    ;;
  qrcode)
    if [[ $# -ne 1 || -z "$1" ]]; then
      printf 'qrcode requires one opaque URL.\n' >&2
      exit 2
    fi
    cd /state
    exec lark-cli --profile "$PROFILE_NAME" auth qrcode "$1" --output auth-qr.png
    ;;
  smoke-corpus)
    exec npm run smoke:corpus
    ;;
  smoke-simulate)
    if [[ $# -ne 1 || -z "$1" ]]; then
      printf 'smoke-simulate requires one run id.\n' >&2
      exit 2
    fi
    exec npm run smoke:simulate -- --run-id "$1"
    ;;
  lark)
    exec lark-cli --profile "$PROFILE_NAME" "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    printf 'Unknown command: %s\n' "$command_name" >&2
    usage >&2
    exit 2
    ;;
esac
