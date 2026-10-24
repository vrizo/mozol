#!/usr/bin/env bash
#
# sim-logs.sh — the MOZOL app's os_log output from the iOS Simulator, live or
# after the fact.
#
# Live (default) follows the app as it runs and appends to the current run's
# app.log. History replays what the system already recorded, so a crash or a bad
# sync can be investigated after it happened — nothing needs to have been
# streaming at the time.
#
# Usage:
#   scripts/sim-logs.sh                        live, all categories
#   scripts/sim-logs.sh --category sync        live, one category
#   scripts/sim-logs.sh --last 10m             history: the last 10 minutes
#   scripts/sim-logs.sh --last 1h -c api,sync  history, two categories
#   scripts/sim-logs.sh --rid 3f2a91b0c4de     every line of one request
#   scripts/sim-logs.sh --udid <UDID>          another simulator
#
# Options:
#   -c, --category <a[,b]>  one or more of: api sync notify store ui
#   -l, --last <duration>   history mode: 5m, 2h, 1d — anything `log show --last` takes
#       --rid <id>          only lines mentioning this request id (implies history
#                           unless --live is given); the same id appears in worker.log
#       --live              force live mode even with --rid
#       --debug             include debug-level lines (verbose; info is on by default)
#       --udid <UDID>       simulator to read (default: $MOZOL_SIM_UDID or the iPhone 17)
#       --out <file>        write here instead of the run folder's app.log
#
# Live output is appended to logs/current/app.log when a run folder exists;
# history goes to logs/current/app-history-<stamp>.log. With no run folder both
# print to the terminal only.

set -euo pipefail

DEFAULT_UDID="${MOZOL_SIM_UDID:-898564DD-FAE8-4AB0-9BF5-CBF17DB72852}"
SUBSYSTEM="app.mozol"
CATEGORIES=(api sync notify store ui)

UDID="$DEFAULT_UDID"
CATEGORY_FILTER=""
LAST=""
RID=""
FORCE_LIVE=0
LEVEL="info"
OUT=""

fail() { echo "[sim-logs] ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--category) CATEGORY_FILTER="${2:-}"; shift 2 ;;
    -l|--last)     LAST="${2:-}"; shift 2 ;;
    --rid)         RID="${2:-}"; shift 2 ;;
    --live)        FORCE_LIVE=1; shift ;;
    --debug)       LEVEL="debug"; shift ;;
    --udid)        UDID="${2:-}"; shift 2 ;;
    --out)         OUT="${2:-}"; shift 2 ;;
    -h|--help)     sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)            fail "unknown option $1 (see --help)" ;;
    # Bare argument: a UDID, the way this script used to be called.
    *)             UDID="$1"; shift ;;
  esac
done

[ -n "${CATEGORY_FILTER}${LAST}${RID}${UDID}" ] || fail "nothing to do"

# --- predicate -------------------------------------------------------------
# Category names are checked against the closed set in MozolCore/Log.swift, so
# a typo is a refusal rather than a silently empty stream.
PREDICATE="subsystem == \"$SUBSYSTEM\""
if [ -n "$CATEGORY_FILTER" ]; then
  clause=""
  IFS=',' read -r -a wanted <<< "$CATEGORY_FILTER"
  for name in "${wanted[@]}"; do
    known=0
    for known_name in "${CATEGORIES[@]}"; do
      [ "$name" = "$known_name" ] && known=1
    done
    [ "$known" -eq 1 ] || fail "unknown category '$name'. Known: ${CATEGORIES[*]}"
    clause="${clause:+$clause OR }category == \"$name\""
  done
  PREDICATE="$PREDICATE AND ($clause)"
fi
if [ -n "$RID" ]; then
  # The id is stamped by the app's `api` category and echoed in every worker
  # line for the same request; matching the message text catches both sides.
  case "$RID" in
    *[!0-9A-Za-z_-]*) fail "request id '$RID' is not the id shape the app stamps" ;;
  esac
  PREDICATE="$PREDICATE AND eventMessage CONTAINS \"$RID\""
fi

# --- mode ------------------------------------------------------------------
MODE="live"
if [ -n "$LAST" ]; then
  MODE="history"
elif [ -n "$RID" ] && [ "$FORCE_LIVE" -eq 0 ]; then
  # Looking up a request id you already have is always a look backwards.
  MODE="history"
  LAST="1h"
fi

xcrun simctl list devices 2>/dev/null | grep -q "$UDID" \
  || fail "simulator UDID $UDID not found (xcrun simctl list devices)."

# --- destination -----------------------------------------------------------
# The run folder is whatever logs/current points at; history does not require
# one, so investigating an old crash never depends on a live run existing.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CURRENT="$REPO_ROOT/logs/current"

if [ -z "$OUT" ] && [ -L "$CURRENT" ] && RUN_DIR="$(cd "$CURRENT" 2>/dev/null && pwd)"; then
  if [ "$MODE" = "live" ]; then
    OUT="$RUN_DIR/app.log"
  else
    OUT="$RUN_DIR/app-history-$(date +%H%M%S).log"
  fi
fi
if [ "$MODE" = "live" ] && [ -z "$OUT" ]; then
  fail "no logs/current symlink and no --out. Start scripts/start-all.sh, or pass --out."
fi

echo "[sim-logs] $MODE | $UDID | ${CATEGORY_FILTER:-all categories}${RID:+ | rid=$RID}"
if [ -n "$OUT" ]; then echo "[sim-logs] writing to $OUT"; else echo "[sim-logs] terminal only"; fi

# --- one clock, one format -------------------------------------------------
# Both modes emit `YYYY-MM-DDTHH:MM:SS.mmmZ <rest>` — byte-for-byte the stamp
# dev-worker.sh puts on worker.log, so the two files sort together and
# scripts/logs.sh can merge them without parsing dates.
#
# Live: `log stream` has no --timezone, so its local timestamp is dropped and
# the line is stamped on arrival (within milliseconds of the event, and exactly
# what dev-worker.sh does to wrangler's output).
# History: the recorded event time is the truth, so it is kept, asked for in UTC
# and rewritten into the same ISO shape.

# Three lines the tooling emits around the log itself: `simctl spawn`'s getpwuid_r
# complaint (stderr, every invocation on this Mac) and `log`'s own preamble and
# column header. None is app output, and each would sit in a merged timeline as if
# it were.
drop_tool_noise() {
  sed -l -E -e '/^getpwuid_r did not find a match/d' \
            -e '/^Filtering the log data using/d' \
            -e '/^Timestamp  /d'
}

strip_local_stamp() {
  sed -l -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3} //'
}

stamp_on_arrival() {
  perl -MPOSIX -MTime::HiRes=time -ne '
    BEGIN { $| = 1 }
    my $t  = time;
    my $ms = int(($t - int($t)) * 1000);
    printf "%s.%03dZ %s", POSIX::strftime("%Y-%m-%dT%H:%M:%S", gmtime(int($t))), $ms, $_;
  '
}

# Turns `log show`'s UTC timestamp into the same ISO form the live path stamps.
iso_recorded_stamp() {
  sed -E -e 's/^([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}) /\1T\2Z /'
}

# --level info is not the default: without it every Logger.info line — most of
# what the app writes — is dropped, which is what made the app look silent.
if [ "$MODE" = "live" ]; then
  echo "[sim-logs] Ctrl+C to stop"
  xcrun simctl spawn "$UDID" log stream \
    --predicate "$PREDICATE" \
    --level "$LEVEL" \
    --style compact 2>&1 | drop_tool_noise | strip_local_stamp | stamp_on_arrival | tee -a "$OUT"
  exit 0
fi

ARGS=(log show --last "$LAST" --predicate "$PREDICATE" --style compact --info --timezone UTC)
[ "$LEVEL" = "debug" ] && ARGS+=(--debug)
if [ -n "$OUT" ]; then
  xcrun simctl spawn "$UDID" "${ARGS[@]}" 2>&1 | drop_tool_noise | iso_recorded_stamp | tee "$OUT"
else
  xcrun simctl spawn "$UDID" "${ARGS[@]}" 2>&1 | drop_tool_noise | iso_recorded_stamp
fi
