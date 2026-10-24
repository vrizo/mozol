#!/usr/bin/env bash
#
# logs.sh — the app and the worker in one timeline.
#
# Both sides stamp every line `YYYY-MM-DDTHH:MM:SS.mmmZ` (scripts/dev-worker.sh
# for the worker, scripts/sim-logs.sh for the app), so merging is a sort, not a
# parse. Each line is tagged with its source and, for the app, its category:
#
#   12:00:27.778Z  app  sync     sync started (trigger: launch)
#   12:00:27.902Z  app  api      → cards rid=9d989d6d6e2b
#   12:00:27.930Z  wrk           {"rid":"9d989d6d6e2b","evt":"req","route":"/cards"}
#   12:00:27.963Z  wrk           {"rid":"9d989d6d6e2b","evt":"cards_ok","count":12,"ms":29}
#   12:00:27.969Z  app  api      ← cards rid=9d989d6d6e2b status=200 ms=67
#
# Usage:
#   scripts/logs.sh                     follow both, live
#   scripts/logs.sh --last 10m          the last 10 minutes, time-ordered
#   scripts/logs.sh --rid 9d989d6d6e2b  one request, both sides
#   scripts/logs.sh --last 1h -c api    history, app-side category filter
#
# Options:
#   -l, --last <duration>   history mode: 5m, 2h, 1d
#       --rid <id>          only lines carrying this request id (implies history)
#   -c, --category <a[,b]>  app-side filter: api sync notify store ui
#       --app               app lines only
#       --worker            worker lines only
#       --raw               keep the full os_log line (level, process, pid)
#       --run <dir>         a run folder other than logs/current
#       --udid <UDID>       simulator to read (default: $MOZOL_SIM_UDID or the iPhone 17)
#
# Live mode follows logs/current/worker.log and opens its own stream from the
# simulator, so it does not need scripts/sim-logs.sh to be running. History mode
# reads the worker's log file and the simulator's own recorded log store, so it
# works after the fact — and after a crash.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LAST=""
RID=""
CATEGORY=""
WANT_APP=1
WANT_WORKER=1
RAW=0
RUN_DIR=""
UDID=""

fail() { echo "[logs] ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -l|--last)     LAST="${2:-}"; shift 2 ;;
    --rid)         RID="${2:-}"; shift 2 ;;
    -c|--category) CATEGORY="${2:-}"; shift 2 ;;
    --app)         WANT_WORKER=0; shift ;;
    --worker)      WANT_APP=0; shift ;;
    --raw)         RAW=1; shift ;;
    --run)         RUN_DIR="${2:-}"; shift 2 ;;
    --udid)        UDID="${2:-}"; shift 2 ;;
    -h|--help)     sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             fail "unknown option $1 (see --help)" ;;
  esac
done

[ -n "$RID" ] && [ -z "$LAST" ] && LAST="1h"
MODE="live"; [ -n "$LAST" ] && MODE="history"

if [ -z "$RUN_DIR" ]; then
  [ -L "$REPO_ROOT/logs/current" ] || fail "no logs/current symlink. Start scripts/start-all.sh, or pass --run <dir>."
  RUN_DIR="$(cd "$REPO_ROOT/logs/current" && pwd)"
fi
WORKER_LOG="$RUN_DIR/worker.log"

if [ "$WANT_WORKER" -eq 1 ] && [ ! -f "$WORKER_LOG" ]; then
  # Named rather than silently shown as one-sided: the usual cause is that the
  # app is pointed at production, where there is no local worker log at all.
  echo "[logs] no $WORKER_LOG — showing app lines only" >&2
  WANT_WORKER=0
fi

# --- formatting ------------------------------------------------------------
# Column 1 is the shared timestamp, so sorting the merged text is sorting by
# time. --raw keeps the os_log level/process/pid columns instead of the category.
# Line-buffered throughout (`sed -l`, `fflush`): live mode writes into a pipe,
# and block buffering there means the terminal shows nothing until 4 KB of log
# has piled up — which reads as "the app is silent".
format() {
  if [ "$RAW" -eq 1 ]; then cat; return; fi
  sed -l -E \
    -e 's/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9:.]+Z) (app|wrk) [A-Za-z]+ +[A-Za-z]+\[[0-9:a-fx]+\] \[app\.mozol:([a-z]+)\] /\2  \3  \4\t/' \
    -e 's/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9:.]+Z) (app|wrk) /\2  \3  \t/' \
  | awk -F'\t' 'NF > 1 { printf "%-30s %s\n", $1, $2; fflush(); next } { print; fflush() }'
}

# --- sources ---------------------------------------------------------------
app_history() {
  local args=(--last "$LAST" --out /dev/null)
  [ -n "$UDID" ] && args+=(--udid "$UDID")
  [ -n "$CATEGORY" ] && args+=(--category "$CATEGORY")
  "$SCRIPT_DIR/sim-logs.sh" "${args[@]}" 2>/dev/null | grep -E '^[0-9]{4}-' | sed -E 's/^([^ ]+) /\1 app /'
}

app_live() {
  local args=(--out /dev/null)
  [ -n "$UDID" ] && args+=(--udid "$UDID")
  [ -n "$CATEGORY" ] && args+=(--category "$CATEGORY")
  "$SCRIPT_DIR/sim-logs.sh" "${args[@]}" 2>/dev/null | grep --line-buffered -E '^[0-9]{4}-' \
    | sed -l -E 's/^([^ ]+) /\1 app /'
}

worker_history() {
  # ISO timestamps are fixed width, so the window is a string comparison.
  local cutoff
  cutoff="$(cutoff_iso "$LAST")"
  awk -v cutoff="$cutoff" '$1 >= cutoff' "$WORKER_LOG" | sed -E 's/^([^ ]+) /\1 wrk /'
}

worker_live() {
  tail -n 0 -F "$WORKER_LOG" 2>/dev/null | sed -l -E 's/^([^ ]+) /\1 wrk /'
}

# `10m` / `2h` / `1d` → the ISO timestamp that far in the past, in UTC.
cutoff_iso() {
  local spec="$1" n unit
  n="${spec%[mhd]}"; unit="${spec#"$n"}"
  case "$unit" in
    m) unit=M ;;
    h) unit=H ;;
    d) unit=d ;;
    *) fail "--last takes 5m, 2h or 1d — got '$spec'" ;;
  esac
  [[ "$n" =~ ^[0-9]+$ ]] || fail "--last takes 5m, 2h or 1d — got '$spec'"
  date -u -v-"${n}${unit}" +%Y-%m-%dT%H:%M:%S
}

# Wrangler reprints its whole binding table on every start — dozens of
# `env.NAME  Environment Variable  local` rows plus blank separators, at the head
# of each run folder. Only those two exact shapes are dropped: anything else the
# worker says still reaches the terminal, errors included. --raw keeps them.
drop_binding_table() {
  if [ "$RAW" -eq 1 ]; then cat; return; fi
  sed -l -E -e '/^[^ ]+ wrk (env\.[A-Z_]+ |Binding +Resource|Your Worker has access)/d' \
            -e '/^[^ ]+ wrk[[:space:]]*$/d'
}

# --- run -------------------------------------------------------------------
filter() {
  if [ -n "$RID" ]; then grep --line-buffered -- "$RID"; else cat; fi
}

if [ "$MODE" = "history" ]; then
  {
    [ "$WANT_APP" -eq 1 ] && app_history
    [ "$WANT_WORKER" -eq 1 ] && worker_history
  } | sort | drop_binding_table | filter | format
  exit 0
fi

echo "[logs] following app + worker — Ctrl+C to stop" >&2
# Live lines are printed as they arrive rather than sorted: both sides are being
# written right now, so arrival order is time order.
#
# The two feeds are killed by pid on the way out, not with `kill 0` — this script
# is also run from other scripts, where killing the whole process group would take
# the caller with it.
# Both feeds write into one FIFO so their pids stay in this shell, where the
# trap can see them. Ctrl+C in a terminal already reaches every descendant
# through the foreground process group; this covers the non-interactive case.
FIFO_DIR="$(mktemp -d)"
FIFO="$FIFO_DIR/feed"
mkfifo "$FIFO"
FEEDS=""
cleanup() {
  [ -n "$FEEDS" ] && kill $FEEDS 2>/dev/null
  rm -rf "$FIFO_DIR"
  return 0
}
trap cleanup EXIT INT TERM

if [ "$WANT_APP" -eq 1 ]; then app_live > "$FIFO" & FEEDS="$FEEDS $!"; fi
if [ "$WANT_WORKER" -eq 1 ]; then worker_live > "$FIFO" & FEEDS="$FEEDS $!"; fi
# `cat` sees EOF only once every writer has closed, so one feed ending does not
# end the view.
cat "$FIFO" | drop_binding_table | filter | format
