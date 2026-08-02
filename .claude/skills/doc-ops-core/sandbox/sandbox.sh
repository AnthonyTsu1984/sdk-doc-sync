#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/compose.yaml"
export COMPOSE_PROJECT_NAME=doc-ops-smoke

compose() {
  docker compose --project-directory "$SCRIPT_DIR" --file "$COMPOSE_FILE" "$@"
}

usage() {
  cat <<'EOF'
Usage: sandbox.sh <command>

Commands:
  build                     Build the pinned lark-cli sandbox image
  init-profile              Securely configure the test app inside the volume
  auth-login                Start user authorization and print JSON
  auth-complete <code>      Complete the device authorization
  status                    Verify isolated authentication state
  profile-show              Show masked isolated profile configuration
  qrcode <url>              Generate and copy a PNG QR code into tmp/doc-ops-smoke/
  smoke-corpus              Validate the synthetic corpus in the container
  smoke-simulate <run-id>   Run the hermetic smoke lifecycle in the container
  lark <args...>            Run lark-cli with the isolated profile in the container
  reset                     Delete sandbox containers and all named volumes;
                            requires DOC_OPS_SMOKE_CONFIRM_RESET=YES
EOF
}

command_name="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command_name" in
  build)
    compose build lark-cli
    ;;
  init-profile)
    compose run --rm --no-deps lark-cli init-profile
    ;;
  auth-login)
    compose run --rm --no-deps -T lark-cli auth-login
    ;;
  auth-complete)
    if [[ $# -ne 1 || -z "$1" ]]; then
      printf 'auth-complete requires one device code.\n' >&2
      exit 2
    fi
    compose run --rm --no-deps -T lark-cli auth-complete "$1"
    ;;
  status)
    compose run --rm --no-deps -T lark-cli status
    ;;
  profile-show)
    compose run --rm --no-deps -T lark-cli profile-show
    ;;
  qrcode)
    if [[ $# -ne 1 || -z "$1" ]]; then
      printf 'qrcode requires one opaque URL.\n' >&2
      exit 2
    fi
    container_name="doc-ops-smoke-qr-$$"
    compose run --name "$container_name" --no-deps -T lark-cli qrcode "$1"
    mkdir -p "$REPO_ROOT/tmp/doc-ops-smoke"
    docker cp "$container_name:/state/auth-qr.png" "$REPO_ROOT/tmp/doc-ops-smoke/auth-qr.png"
    docker rm "$container_name" >/dev/null
    printf '%s\n' "$REPO_ROOT/tmp/doc-ops-smoke/auth-qr.png"
    ;;
  smoke-corpus)
    compose run --rm --no-deps -T lark-cli smoke-corpus
    ;;
  smoke-simulate)
    if [[ $# -ne 1 || -z "$1" ]]; then
      printf 'smoke-simulate requires one run id.\n' >&2
      exit 2
    fi
    compose run --rm --no-deps -T lark-cli smoke-simulate "$1"
    ;;
  lark)
    compose run --rm --no-deps -T lark-cli lark "$@"
    ;;
  reset)
    if [[ "${DOC_OPS_SMOKE_CONFIRM_RESET:-}" != "YES" ]]; then
      printf 'Refusing reset. Set DOC_OPS_SMOKE_CONFIRM_RESET=YES to delete sandbox volumes.\n' >&2
      exit 10
    fi
    compose down --volumes --remove-orphans
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
