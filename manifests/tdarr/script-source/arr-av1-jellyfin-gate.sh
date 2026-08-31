#!/bin/sh
set -eu

MAGIC='# tdarr-av1-jellyfin-gate/v1'
LOCK_NAME='.tdarr-av1-jellyfin-gate.lock'
MEDIA_ROOT=${ARR_GATE_MEDIA_ROOT:-/media_2}
GATE_ROOTS=${ARR_GATE_ROOTS:-/media_2/series/anime/:/media_2/series/web series/}
LOCK_TIMEOUT_SECONDS=${ARR_GATE_LOCK_TIMEOUT_SECONDS:-60}

newline=$(printf '\nx')
newline=${newline%x}
carriage_return=$(printf '\rx')
carriage_return=${carriage_return%x}

fail() {
  printf 'arr-av1-jellyfin-gate: %s\n' "$1" >&2
  exit 1
}

defer_move() {
  printf '%s\n' '[MoveStatus] DeferMove'
  exit 0
}

[ "$#" -eq 2 ] || fail 'expected source and destination arguments'
source=$1
destination=$2
# Arr supplies the source for its own import bookkeeping. The gate only owns the final path.
: "$source"

case "$destination" in
  "$MEDIA_ROOT"/*) ;;
  *) defer_move ;;
esac

case "$destination" in
  */../*|*/..) fail 'destination contains path traversal' ;;
esac
case "$destination" in
  *"$newline"*|*"$carriage_return"*) fail 'destination contains a line break' ;;
esac

old_ifs=$IFS
IFS=:
allowed=0
for configured_root in $GATE_ROOTS; do
  case "$configured_root" in
    */) root=$configured_root ;;
    *) root="$configured_root/" ;;
  esac
  case "$destination" in
    "$root"*) allowed=1 ; break ;;
  esac
done
IFS=$old_ifs

[ "$allowed" -eq 1 ] || defer_move

parent=$(dirname "$destination")
[ -d "$parent" ] || fail 'destination parent does not exist'
[ ! -L "$parent" ] || fail 'destination parent is a symlink'
resolved_parent=$(readlink -f "$parent") || fail 'could not resolve destination parent'
case "$resolved_parent"/ in
  "$MEDIA_ROOT"/*) ;;
  *) fail 'destination parent resolves outside the media root' ;;
esac

filename=$(basename "$destination")
[ -n "$filename" ] || fail 'destination filename is empty'
case "$filename" in
  .*.*) stem=${filename%.*} ;;
  .*) stem=$filename ;;
  *.*) stem=${filename%.*} ;;
  *) stem=$filename ;;
esac
[ -n "$stem" ] || fail 'destination filename stem is empty'
case "$stem" in
  *"$newline"*|*"$carriage_return"*|*[[:space:]]) fail 'destination stem is unsafe' ;;
esac

escaped_stem=
rest=$stem
while [ -n "$rest" ]; do
  character=${rest%"${rest#?}"}
  rest=${rest#?}
  case "$character" in
    '\'|'*'|'?'|'['|']'|'!'|'#') escaped_stem="${escaped_stem}\\${character}" ;;
    *) escaped_stem="${escaped_stem}${character}" ;;
  esac
done
rule="${escaped_stem}.*"

valid_rule() {
  candidate=$1
  case "$candidate" in
    /*.\*) encoded=${candidate#/} ;;
    *.\*) encoded=$candidate ;;
    *) return 1 ;;
  esac
  encoded=${encoded%.*}
  [ -n "$encoded" ] || return 1
  escaped=0
  rest=$encoded
  while [ -n "$rest" ]; do
    character=${rest%"${rest#?}"}
    rest=${rest#?}
    if [ "$escaped" -eq 1 ]; then
      case "$character" in
        '\'|'*'|'?'|'['|']'|'!'|'#') escaped=0 ;;
        *) return 1 ;;
      esac
    else
      case "$character" in
        '\' ) escaped=1 ;;
        '/'|'*'|'?'|'['|']'|'!'|'#') return 1 ;;
        *) ;;
      esac
    fi
  done
  [ "$escaped" -eq 0 ] || return 1
  case "$encoded" in *[[:space:]]) return 1 ;; esac
  return 0
}

lock="$parent/$LOCK_NAME"
owner="$lock/.owner"
acquired=0
cleanup() {
  if [ "$acquired" -eq 1 ]; then
    owner_pid=
    if [ -f "$owner" ] && [ ! -L "$owner" ]; then
      IFS= read -r owner_pid < "$owner" || owner_pid=
    fi
    if [ "$owner_pid" = "$$" ]; then
      rm -f "$owner" 2>/dev/null || true
    fi
    if ! rmdir "$lock" 2>/dev/null && [ -e "$lock" ]; then
      printf '%s\n' 'arr-av1-jellyfin-gate: lock cleanup failed' >&2
    fi
  fi
  return 0
}
trap cleanup EXIT HUP INT TERM

attempt=0
while :; do
  if mkdir "$lock" 2>/dev/null; then
    if (
      set -C
      umask 022
      printf '%s\n' "$$" > "$owner"
    ) 2>/dev/null; then
      acquired=1
      break
    fi
  fi
  if [ -L "$lock" ] || { [ -e "$lock" ] && [ ! -d "$lock" ]; }; then
    fail 'gate lock path is not a directory'
  fi
  attempt=$((attempt + 1))
  [ "$attempt" -lt "$LOCK_TIMEOUT_SECONDS" ] || fail 'timed out waiting for gate lock'
  sleep 1
done

marker="$parent/.ignore"
if [ -e "$marker" ] || [ -L "$marker" ]; then
  [ ! -L "$marker" ] || fail 'existing .ignore is a symlink'
  [ -f "$marker" ] || fail 'existing .ignore is not a regular file'

  first_line=1
  duplicate=0
  content=
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$first_line" -eq 1 ]; then
      [ "$line" = "$MAGIC" ] || fail 'existing .ignore is not gate-owned'
      first_line=0
      content="${MAGIC}${newline}"
      continue
    fi

    case "$line" in
      '') content="${content}${newline}" ;;
      \#*) content="${content}${line}${newline}" ;;
      *.\*)
        valid_rule "$line" || fail 'existing .ignore contains an invalid rule'
        canonical_line=$line
        case "$canonical_line" in
          /*) canonical_line=${canonical_line#/} ;;
        esac
        if [ "$canonical_line" = "$rule" ]; then
          duplicate=1
        else
          content="${content}${canonical_line}${newline}"
        fi
        ;;
      *) fail 'existing .ignore contains an invalid rule' ;;
    esac
  done < "$marker"
  [ "$first_line" -eq 0 ] || fail 'existing .ignore is empty'

  temporary="${marker}.tdarr-gate.$$.$attempt.tmp"
  if [ "$duplicate" -eq 0 ]; then
    content="${content}${rule}${newline}"
  fi
  (umask 022; printf '%s' "$content" > "$temporary") \
    || { rm -f "$temporary"; fail 'could not write temporary gate marker'; }
  chmod 0644 "$temporary" || { rm -f "$temporary"; fail 'could not set gate marker permissions'; }
  mv -f "$temporary" "$marker" || { rm -f "$temporary"; fail 'could not install gate marker'; }
else
  temporary="${marker}.tdarr-gate.$$.$attempt.tmp"
  (umask 022; printf '%s' "${MAGIC}${newline}${rule}${newline}" > "$temporary") \
    || { rm -f "$temporary"; fail 'could not write temporary gate marker'; }
  chmod 0644 "$temporary" || { rm -f "$temporary"; fail 'could not set gate marker permissions'; }
  mv -f "$temporary" "$marker" || { rm -f "$temporary"; fail 'could not install gate marker'; }
fi

defer_move
