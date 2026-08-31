#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/../../manifests/tdarr/script-source/arr-av1-jellyfin-gate.sh"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT HUP INT TERM

root="$fixture/media_2/series/anime"
web_root="$fixture/media_2/series/web series"
mkdir -p "$root/Show [Test]" "$web_root/Show [Test]"

run_gate() {
  ARR_GATE_MEDIA_ROOT="$fixture/media_2" \
  ARR_GATE_ROOTS="$root/:$web_root/" \
  "$SCRIPT" /downloads/source.mkv "$1"
}

output=$(run_gate "$root/Show [Test]/Episode #1?.mp4")
[ "$output" = '[MoveStatus] DeferMove' ]
[ -s "$root/Show [Test]/.ignore" ]
grep -F '# tdarr-av1-jellyfin-gate/v1' "$root/Show [Test]/.ignore" >/dev/null
grep -F '/Episode \#1\?.*' "$root/Show [Test]/.ignore" >/dev/null

output=$(run_gate "$root/Show [Test]/Episode [2].mkv")
[ "$output" = '[MoveStatus] DeferMove' ]

output=$(run_gate "$root/Show [Test]/O'Brien.mkv")
[ "$output" = '[MoveStatus] DeferMove' ]
grep -F "/O'Brien.*" "$root/Show [Test]/.ignore" >/dev/null

output=$(run_gate "$web_root/Show [Test]/Web-Episode.mkv")
[ "$output" = '[MoveStatus] DeferMove' ]
grep -F '/Web-Episode.*' "$web_root/Show [Test]/.ignore" >/dev/null

(
  run_gate "$root/Show [Test]/Concurrent-A.mkv" > "$fixture/concurrent-a.out"
) &
pid_a=$!
(
  run_gate "$root/Show [Test]/Concurrent-B.mkv" > "$fixture/concurrent-b.out"
) &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
grep -F '/Concurrent-A.*' "$root/Show [Test]/.ignore" >/dev/null
grep -F '/Concurrent-B.*' "$root/Show [Test]/.ignore" >/dev/null

unowned="$root/Show [Test]/Unowned"
mkdir -p "$unowned"
printf '%s\n' '# user-owned' '/Unowned.*' > "$unowned/.ignore"
if run_gate "$unowned/Unowned.mkv" > "$fixture/unowned.out" 2> "$fixture/unowned.err"; then
  exit 1
fi
grep -F '# user-owned' "$unowned/.ignore" >/dev/null

empty="$root/Show [Test]/Empty"
mkdir -p "$empty"
: > "$empty/.ignore"
if run_gate "$empty/Empty.mkv" > "$fixture/empty.out" 2> "$fixture/empty.err"; then
  exit 1
fi
[ ! -s "$empty/.ignore" ]

failed="$root/Show [Test]/FailedWrite"
mkdir -p "$failed"
touch "$failed/.tdarr-av1-jellyfin-gate.lock"
if ARR_GATE_MEDIA_ROOT="$fixture/media_2" ARR_GATE_ROOTS="$root/" \
  "$SCRIPT" /downloads/source.mkv "$failed/FailedWrite.mkv" > "$fixture/failed.out" 2> "$fixture/failed.err"; then
  exit 1
fi
[ ! -e "$failed/.ignore" ]
rm -f "$failed/.tdarr-av1-jellyfin-gate.lock"

before=$(cksum "$root/Show [Test]/.ignore")
output=$(ARR_GATE_MEDIA_ROOT="$fixture/media_2" ARR_GATE_ROOTS="$fixture/media_2/series/other/" \
  "$SCRIPT" /downloads/source.mkv "$root/Show [Test]/Outside.mkv")
[ "$output" = '[MoveStatus] DeferMove' ]
after=$(cksum "$root/Show [Test]/.ignore")
[ "$before" = "$after" ]

printf '%s\n' 'arr gate script fixture tests passed'
