#!/usr/bin/env bash
#
# run-dir.sh — shared helpers for per-run log folders. Source it, do not run it.
#
#   new_run_dir <service>   creates logs/<YYYY-MM-DD>/run-<N>/, writes run.json,
#                           points logs/current at it, sets RUN_DIR
#   stamp                   filter: prefixes every line with a UTC ISO 8601
#                           timestamp (ms), the shape every log file shares
#
# Layout and rules: docs/logs/layout.md.

RUN_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RUN_LIB_DIR/../.." && pwd)"
LOGS_ROOT="$REPO_ROOT/logs"

new_run_dir() {
  local service="$1"
  local date_dir max n run
  local date
  date="$(date +%Y-%m-%d)"
  date_dir="$LOGS_ROOT/$date"
  mkdir -p "$date_dir"

  max=0
  for d in "$date_dir"/run-*; do
    [ -d "$d" ] || continue
    n="${d##*/run-}"
    if [[ "$n" =~ ^[0-9]+$ ]] && (( n > max )); then max="$n"; fi
  done
  run=$((max + 1))
  RUN_DIR="$date_dir/run-$run"
  mkdir -p "$RUN_DIR"
  ln -sfn "$date/run-$run" "$LOGS_ROOT/current"

  local git_commit git_branch git_dirty node_version version
  git_commit="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo none)"
  git_branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then git_dirty=true; else git_dirty=false; fi
  node_version="$(node --version 2>/dev/null || echo none)"
  version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" 2>/dev/null | head -1)"
  cat > "$RUN_DIR/run.json" <<JSON
{
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "service": "$service",
  "version": "${version:-none}",
  "gitCommit": "$git_commit",
  "gitBranch": "$git_branch",
  "isGitDirty": $git_dirty,
  "nodeVersion": "$node_version"
}
JSON
}

stamp() {
  perl -MPOSIX -MTime::HiRes=time -ne '
    BEGIN { $| = 1 }
    my $t  = time;
    my $ms = int(($t - int($t)) * 1000);
    printf "%s.%03dZ %s", POSIX::strftime("%Y-%m-%dT%H:%M:%S", gmtime(int($t))), $ms, $_;
  '
}

# Reads one key from an env file without printing it. Usage: env_value <file> <KEY>
env_value() {
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | head -1 | tr -d '"'"'"'\r'
}
