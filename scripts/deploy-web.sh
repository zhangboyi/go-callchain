#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release/go-callchain-service"
OUTPUT_SET=0
ADDR="127.0.0.1:8787"
RUN_SERVICE=1
RUN_TESTS=1
CLEAN=1
TARGET=""
GOOS_VALUE=""
GOARCH_VALUE=""
CGO_ENABLED_VALUE="${CGO_ENABLED:-0}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-web.sh [options]

Options:
  --addr <host:port>    Service listen address. Default: 127.0.0.1:8787
  --output <dir>        Release directory. Default: release/go-callchain-service
  --target <os-arch>    Build target. Default: auto-detect current system
                        Examples: auto, linux-amd64, linux-arm64, darwin-arm64
  --goos <os>           Go target OS. Overrides --target OS part
  --goarch <arch>       Go target arch. Overrides --target arch part
  --cgo-enabled <0|1>   CGO_ENABLED value for go build. Default: 0
  --no-run              Build release only, do not start service
  --skip-tests          Skip go test ./...
  --no-clean            Keep existing release directory before build
  -h, --help            Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --addr)
      ADDR="${2:-}"
      shift 2
      ;;
    --output)
      RELEASE_DIR="${2:-}"
      OUTPUT_SET=1
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --goos)
      GOOS_VALUE="${2:-}"
      shift 2
      ;;
    --goarch)
      GOARCH_VALUE="${2:-}"
      shift 2
      ;;
    --cgo-enabled)
      CGO_ENABLED_VALUE="${2:-}"
      shift 2
      ;;
    --no-run)
      RUN_SERVICE=0
      shift
      ;;
    --skip-tests)
      RUN_TESTS=0
      shift
      ;;
    --no-clean)
      CLEAN=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$ADDR" ]]; then
  echo "--addr cannot be empty" >&2
  exit 2
fi

HOST_GOOS="$(go env GOOS)"
HOST_GOARCH="$(go env GOARCH)"

if [[ -z "$TARGET" || "$TARGET" == "auto" || "$TARGET" == "native" || "$TARGET" == "current" ]]; then
  [[ -n "$GOOS_VALUE" ]] || GOOS_VALUE="$HOST_GOOS"
  [[ -n "$GOARCH_VALUE" ]] || GOARCH_VALUE="$HOST_GOARCH"
elif [[ -n "$TARGET" ]]; then
  if [[ "$TARGET" != *-* ]]; then
    echo "--target must use os-arch format, for example linux-amd64" >&2
    exit 2
  fi
  TARGET_OS="${TARGET%%-*}"
  TARGET_ARCH="${TARGET#*-}"
  [[ -n "$GOOS_VALUE" ]] || GOOS_VALUE="$TARGET_OS"
  [[ -n "$GOARCH_VALUE" ]] || GOARCH_VALUE="$TARGET_ARCH"
fi

if [[ -n "$GOOS_VALUE" && -z "$GOARCH_VALUE" ]]; then
  GOARCH_VALUE="$HOST_GOARCH"
fi

if [[ -z "$GOOS_VALUE" && -n "$GOARCH_VALUE" ]]; then
  GOOS_VALUE="$HOST_GOOS"
fi

if [[ -n "$GOOS_VALUE" || -n "$GOARCH_VALUE" ]]; then
  [[ -n "$GOOS_VALUE" ]] || GOOS_VALUE="$(go env GOOS)"
  [[ -n "$GOARCH_VALUE" ]] || GOARCH_VALUE="$(go env GOARCH)"
  if [[ "$OUTPUT_SET" -eq 0 && -n "$TARGET" && "$TARGET" != "auto" && "$TARGET" != "native" && "$TARGET" != "current" ]]; then
    RELEASE_DIR="${ROOT_DIR}/release/go-callchain-service-${GOOS_VALUE}-${GOARCH_VALUE}"
  fi
fi

if [[ "$CGO_ENABLED_VALUE" != "0" && "$CGO_ENABLED_VALUE" != "1" ]]; then
  echo "--cgo-enabled must be 0 or 1" >&2
  exit 2
fi

cd "$ROOT_DIR"

if [[ "$CLEAN" -eq 1 ]]; then
  rm -rf "$RELEASE_DIR"
fi

mkdir -p "$RELEASE_DIR/web"

echo "[1/5] installing web dependencies"
npm --prefix web ci

echo "[2/5] building web assets"
npm --prefix web run build

if [[ "$RUN_TESTS" -eq 1 ]]; then
  echo "[3/5] running Go tests"
  go test ./...
else
  echo "[3/5] skipping Go tests"
fi

echo "[4/5] building service binary"
echo "target: GOOS=$GOOS_VALUE GOARCH=$GOARCH_VALUE CGO_ENABLED=$CGO_ENABLED_VALUE"
GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" CGO_ENABLED="$CGO_ENABLED_VALUE" \
  go build -o "$RELEASE_DIR/go-callchain-service" ./cmd/server

echo "[5/5] copying web/dist"
rm -rf "$RELEASE_DIR/web/dist"
cp -R web/dist "$RELEASE_DIR/web/dist"

echo "release ready: $RELEASE_DIR"

if [[ "$RUN_SERVICE" -eq 1 ]]; then
  if [[ "$GOOS_VALUE" != "$HOST_GOOS" || "$GOARCH_VALUE" != "$HOST_GOARCH" ]]; then
    echo "cross-compiled release cannot run on this host: target=${GOOS_VALUE}/${GOARCH_VALUE}, host=${HOST_GOOS}/${HOST_GOARCH}" >&2
    echo "use --no-run for cross-platform packages" >&2
    exit 2
  fi
  echo "starting: http://$ADDR"
  cd "$RELEASE_DIR"
  exec ./go-callchain-service -addr "$ADDR"
fi

echo "start manually:"
echo "  cd \"$RELEASE_DIR\" && ./go-callchain-service -addr \"$ADDR\""
