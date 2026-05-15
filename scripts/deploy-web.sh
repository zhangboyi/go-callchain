#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release/go-callchain-service"
OUTPUT_SET=0
HOST="0.0.0.0"
PORT="8787"
ADDR=""
ADDR_SET=0
RUN_TESTS=1
CLEAN=1
BUILD_BEFORE_START=1
FOREGROUND=0
TARGET=""
GOOS_VALUE=""
GOARCH_VALUE=""
CGO_ENABLED_VALUE="${CGO_ENABLED:-0}"
ACTION="start"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-web.sh [action] [options]

Actions:
  start      Build release and start service in background. Default action
  stop       Stop background service
  restart    Stop, rebuild, and start service in background
  status     Show service status
  build      Build release only

Options:
  --host <host>         Listen host. Default: 0.0.0.0
  --port <port>         Listen port. Default: 8787
  --addr <host:port>    Listen address. Overrides --host and --port
  --output <dir>        Release directory. Default: release/go-callchain-service
  --target <os-arch>    Build target. Default: auto-detect current system
                        Examples: auto, linux-amd64, linux-arm64, darwin-arm64
  --goos <os>           Go target OS. Overrides --target OS part
  --goarch <arch>       Go target arch. Overrides --target arch part
  --cgo-enabled <0|1>   CGO_ENABLED value for go build. Default: 0
  --foreground          Start service in foreground
  --no-build            Start existing release without rebuilding
  --no-run              Alias for build
  --skip-tests          Skip go test ./...
  --no-clean            Keep existing release directory before build
  -h, --help            Show help
EOF
}

case "${1:-}" in
  start|stop|restart|status|build)
    ACTION="$1"
    shift
    ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --addr)
      ADDR="${2:-}"
      ADDR_SET=1
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
    --foreground)
      FOREGROUND=1
      shift
      ;;
    --no-build)
      BUILD_BEFORE_START=0
      shift
      ;;
    --no-run)
      ACTION="build"
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

if [[ "$ADDR_SET" -eq 0 ]]; then
  ADDR="${HOST}:${PORT}"
fi

if [[ -z "$ADDR" ]]; then
  echo "listen address cannot be empty" >&2
  exit 2
fi

if [[ "$CGO_ENABLED_VALUE" != "0" && "$CGO_ENABLED_VALUE" != "1" ]]; then
  echo "--cgo-enabled must be 0 or 1" >&2
  exit 2
fi

HOST_GOOS="$(go env GOOS)"
HOST_GOARCH="$(go env GOARCH)"

if [[ -z "$TARGET" || "$TARGET" == "auto" || "$TARGET" == "native" || "$TARGET" == "current" ]]; then
  [[ -n "$GOOS_VALUE" ]] || GOOS_VALUE="$HOST_GOOS"
  [[ -n "$GOARCH_VALUE" ]] || GOARCH_VALUE="$HOST_GOARCH"
else
  if [[ "$TARGET" != *-* ]]; then
    echo "--target must use os-arch format, for example linux-amd64" >&2
    exit 2
  fi
  [[ -n "$GOOS_VALUE" ]] || GOOS_VALUE="${TARGET%%-*}"
  [[ -n "$GOARCH_VALUE" ]] || GOARCH_VALUE="${TARGET#*-}"
fi

[[ -n "$GOOS_VALUE" ]] || GOOS_VALUE="$HOST_GOOS"
[[ -n "$GOARCH_VALUE" ]] || GOARCH_VALUE="$HOST_GOARCH"

if [[ "$OUTPUT_SET" -eq 0 && -n "$TARGET" && "$TARGET" != "auto" && "$TARGET" != "native" && "$TARGET" != "current" ]]; then
  RELEASE_DIR="${ROOT_DIR}/release/go-callchain-service-${GOOS_VALUE}-${GOARCH_VALUE}"
fi

PID_FILE="${RELEASE_DIR}/go-callchain-service.pid"
LOG_FILE="${RELEASE_DIR}/go-callchain-service.log"
LAUNCHD_LABEL="com.local.go-callchain-service.${ADDR##*:}"
LAUNCHD_PLIST="${RELEASE_DIR}/${LAUNCHD_LABEL}.plist"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

service_pid() {
  cat "$PID_FILE" 2>/dev/null || true
}

listen_pid() {
  local port="${ADDR##*:}"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

launchd_domain() {
  echo "gui/$(id -u)"
}

print_urls() {
  local port="${ADDR##*:}"
  if [[ "$ADDR" == 127.0.0.1:* || "$ADDR" == localhost:* ]]; then
    echo "url: http://127.0.0.1:${port}"
    return
  fi

  echo "url: http://127.0.0.1:${port}"
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | awk -v port="$port" 'NF {print "url: http://" $1 ":" port}' || true
  fi
  if command -v ipconfig >/dev/null 2>&1; then
    for iface in en0 en1 en2; do
      ipconfig getifaddr "$iface" 2>/dev/null | awk -v port="$port" 'NF {print "url: http://" $1 ":" port}' || true
    done
  fi
}

write_launchd_plist() {
  mkdir -p "$RELEASE_DIR"
  cat >"$LAUNCHD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RELEASE_DIR}/go-callchain-service</string>
    <string>-addr</string>
    <string>${ADDR}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${RELEASE_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF
}

start_launchd_service() {
  write_launchd_plist
  launchctl bootout "$(launchd_domain)" "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "$(launchd_domain)" "$LAUNCHD_PLIST"
  launchctl kickstart -k "$(launchd_domain)/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
  sleep 1

  local pid
  pid="$(listen_pid)"
  if [[ -z "$pid" ]]; then
    echo "service failed to start, log: $LOG_FILE" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    exit 1
  fi

  echo "$pid" >"$PID_FILE"
  echo "pid: $pid"
  print_urls
  echo "log: $LOG_FILE"
  echo "launchd: $LAUNCHD_LABEL"
}

ensure_native_target() {
  if [[ "$GOOS_VALUE" != "$HOST_GOOS" || "$GOARCH_VALUE" != "$HOST_GOARCH" ]]; then
    echo "cross-compiled release cannot run on this host: target=${GOOS_VALUE}/${GOARCH_VALUE}, host=${HOST_GOOS}/${HOST_GOARCH}" >&2
    echo "use build or --no-run for cross-platform packages" >&2
    exit 2
  fi
}

build_release() {
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
}

start_service() {
  ensure_native_target

  if is_running; then
    echo "service already running: pid=$(service_pid)"
    print_urls
    echo "log: $LOG_FILE"
    return
  fi

  if [[ ! -x "$RELEASE_DIR/go-callchain-service" ]]; then
    echo "service binary not found: $RELEASE_DIR/go-callchain-service" >&2
    echo "run: scripts/deploy-web.sh build" >&2
    exit 1
  fi

  mkdir -p "$RELEASE_DIR"

  if [[ "$FOREGROUND" -eq 1 ]]; then
    echo "starting foreground: http://$ADDR"
    cd "$RELEASE_DIR"
    exec ./go-callchain-service -addr "$ADDR"
  fi

  if [[ "$HOST_GOOS" == "darwin" && -x /bin/launchctl ]]; then
    echo "starting background with launchctl: http://$ADDR"
    start_launchd_service
    return
  fi

  echo "starting background: http://$ADDR"
  cd "$RELEASE_DIR"
  nohup ./go-callchain-service -addr "$ADDR" >"$LOG_FILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$PID_FILE"
  sleep 1

  if ! is_running; then
    echo "service failed to start, log: $LOG_FILE" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    exit 1
  fi

  echo "pid: $(service_pid)"
  print_urls
  echo "log: $LOG_FILE"
}

stop_service() {
  if [[ "$HOST_GOOS" == "darwin" && -f "$LAUNCHD_PLIST" && -x /bin/launchctl ]]; then
    echo "stopping launchd service: $LAUNCHD_LABEL"
    launchctl bootout "$(launchd_domain)" "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
    echo "service stopped"
    return
  fi

  if ! is_running; then
    rm -f "$PID_FILE"
    echo "service not running"
    return
  fi

  local pid
  pid="$(service_pid)"
  echo "stopping: pid=$pid"
  kill "$pid"

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "service stopped"
      return
    fi
    sleep 0.5
  done

  echo "force stopping: pid=$pid"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "service stopped"
}

status_service() {
  local pid
  pid="$(listen_pid)"
  if [[ -n "$pid" ]]; then
    echo "service running: pid=$pid"
    print_urls
    echo "log: $LOG_FILE"
    if [[ "$HOST_GOOS" == "darwin" && -f "$LAUNCHD_PLIST" ]]; then
      echo "launchd: $LAUNCHD_LABEL"
    fi
  elif is_running; then
    echo "service running: pid=$(service_pid)"
    print_urls
    echo "log: $LOG_FILE"
  else
    rm -f "$PID_FILE"
    echo "service not running"
  fi
}

case "$ACTION" in
  build)
    build_release
    ;;
  start)
    if [[ "$BUILD_BEFORE_START" -eq 1 ]]; then
      build_release
    fi
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    build_release
    start_service
    ;;
  status)
    status_service
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    usage >&2
    exit 2
    ;;
esac
