#!/usr/bin/env bash
set -Eeuo pipefail

# This script hardens only the VPS perimeter and the application relay.
# It deliberately preserves the family VPN on wg0, including UDP/61115 and
# its existing bidirectional forwarding paths.

readonly BACKUP_DIR="/root/firewall-backups"
readonly APP_TUNNEL_IP="10.77.77.2"
readonly APP_TUNNEL_IF="wg-jellyfin"
readonly FAMILY_TUNNEL_IF="wg0"
readonly FAMILY_WG_PORT="61115"
readonly APP_WG_PORT="51822"

discover_wan_interface() {
  local -a fields
  local field_index
  while read -r -a fields; do
    for ((field_index = 0; field_index < ${#fields[@]}; field_index++)); do
      if [[ "${fields[field_index]}" == "dev" && -n "${fields[field_index + 1]:-}" ]]; then
        case "${fields[field_index + 1]}" in
          tailscale*|wg*|docker*|br-*)
            return 1
            ;;
        esac
        printf '%s' "${fields[field_index + 1]}"
        return 0
      fi
    done
  done < <(ip -4 route get 1.1.1.1)
  return 1
}

readonly WAN_IF="$(discover_wan_interface)"

backup_rules() {
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$BACKUP_DIR"
  iptables-save > "$BACKUP_DIR/rules.v4.$stamp"
  ip6tables-save > "$BACKUP_DIR/rules.v6.$stamp"
  printf 'Saved firewall backup under %s with stamp %s\n' "$BACKUP_DIR" "$stamp" >&2
}

has_interface() {
  ip link show "$1" >/dev/null 2>&1
}

preflight() {
  local command_name
  for command_name in iptables ip6tables iptables-save ip6tables-save netfilter-persistent; do
    command -v "$command_name" >/dev/null 2>&1 || {
      printf 'Required command is missing: %s\n' "$command_name" >&2
      return 1
    }
  done
  has_interface "$WAN_IF" || {
    printf 'Default-route interface is unavailable: %s\n' "$WAN_IF" >&2
    return 1
  }
}

install_input_chain() {
  local bin="$1"
  local chain="$2"
  local icmp_protocol="$3"

  "$bin" -w -N "$chain" 2>/dev/null || true
  "$bin" -w -F "$chain"

  "$bin" -w -A "$chain" -i lo -j ACCEPT
  "$bin" -w -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

  if has_interface tailscale0; then
    "$bin" -w -A "$chain" -i tailscale0 -j ACCEPT
  fi
  "$bin" -w -A "$chain" -p udp --dport 41641 -j ACCEPT

  if has_interface "$FAMILY_TUNNEL_IF"; then
    "$bin" -w -A "$chain" -i "$FAMILY_TUNNEL_IF" -j ACCEPT
  fi
  if has_interface tun0; then
    "$bin" -w -A "$chain" -i tun0 -j ACCEPT
  fi
  if has_interface "$APP_TUNNEL_IF"; then
    "$bin" -w -A "$chain" -i "$APP_TUNNEL_IF" -p tcp -m multiport --dports 80,443 -j ACCEPT
  fi

  if has_interface "$WAN_IF"; then
    # Family VPN and application WireGuard are separate listeners.
    "$bin" -w -A "$chain" -i "$WAN_IF" -p udp --dport "$FAMILY_WG_PORT" -j ACCEPT
    "$bin" -w -A "$chain" -i "$WAN_IF" -p udp --dport "$APP_WG_PORT" -j ACCEPT
    "$bin" -w -A "$chain" -i "$WAN_IF" -p tcp -m multiport --dports 80,443,853 -j ACCEPT
    "$bin" -w -A "$chain" -i "$WAN_IF" -p udp --sport 67 --dport 68 -j ACCEPT
  fi

  "$bin" -w -A "$chain" -p udp --sport 123 -j ACCEPT
  "$bin" -w -A "$chain" -p "$icmp_protocol" -j ACCEPT
  "$bin" -w -A "$chain" -j DROP
}

install_forward_chain() {
  local bin="$1"
  local chain="$2"
  local app_tunnel_ip="$3"
  local bridge_path bridge
  local public_port

  "$bin" -w -N "$chain" 2>/dev/null || true
  "$bin" -w -F "$chain"

  "$bin" -w -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

  # Preserve the existing Tailscale and Docker forwarding machinery.
  if "$bin" -w -nL ts-forward >/dev/null 2>&1; then
    "$bin" -w -A "$chain" -j ts-forward
  fi
  if "$bin" -w -nL DOCKER-FORWARD >/dev/null 2>&1; then
    # These are the VPS's intentional public Docker services. Other Docker
    # publishes, including Portainer, remain blocked by the final DROP.
    for public_port in 853 10012 10014; do
      "$bin" -w -A "$chain" -i "$WAN_IF" -p tcp -m conntrack \
        --ctstate NEW --ctorigdstport "$public_port" -j DOCKER-FORWARD
    done
  fi
  for bridge_path in /sys/class/net/docker0 /sys/class/net/br-*; do
    [[ -e "$bridge_path" ]] || continue
    bridge="${bridge_path##*/}"
    if has_interface "$bridge" && "$bin" -w -nL DOCKER-FORWARD >/dev/null 2>&1; then
      if "$bin" -w -nL DOCKER-USER >/dev/null 2>&1; then
        "$bin" -w -A "$chain" -i "$bridge" -j DOCKER-USER
      fi
      "$bin" -w -A "$chain" -i "$bridge" -j DOCKER-FORWARD
    fi
  done

  # Preserve the family VPN without changing wg0 configuration or peers.
  if has_interface "$FAMILY_TUNNEL_IF"; then
    "$bin" -w -A "$chain" -i "$FAMILY_TUNNEL_IF" -j ACCEPT
  fi
  if has_interface "$WAN_IF" && has_interface "$FAMILY_TUNNEL_IF"; then
    "$bin" -w -A "$chain" -i "$WAN_IF" -o "$FAMILY_TUNNEL_IF" -j ACCEPT
  fi
  if has_interface tun0; then
    "$bin" -w -A "$chain" -i tun0 -j ACCEPT
  fi
  if has_interface "$WAN_IF" && has_interface tun0; then
    "$bin" -w -A "$chain" -i "$WAN_IF" -o tun0 -j ACCEPT
  fi

  # The application tunnel accepts only the public ingress relay path.
  if [[ -n "$app_tunnel_ip" ]] && has_interface "$WAN_IF" && has_interface "$APP_TUNNEL_IF"; then
    "$bin" -w -A "$chain" -i "$WAN_IF" -o "$APP_TUNNEL_IF" -d "$app_tunnel_ip" \
      -p tcp -m multiport --dports 80,443 -m conntrack \
      --ctstate NEW,ESTABLISHED -j ACCEPT
  fi

  "$bin" -w -A "$chain" -j DROP
}

install_filter() {
  local bin="$1"
  local input_chain="$2"
  local forward_chain="$3"
  local icmp_protocol="$4"
  local app_tunnel_ip="$5"

  install_input_chain "$bin" "$input_chain" "$icmp_protocol"
  install_forward_chain "$bin" "$forward_chain" "$app_tunnel_ip"

  while "$bin" -w -C INPUT -j "$input_chain" 2>/dev/null; do
    "$bin" -w -D INPUT -j "$input_chain"
  done
  while "$bin" -w -C FORWARD -j "$forward_chain" 2>/dev/null; do
    "$bin" -w -D FORWARD -j "$forward_chain"
  done
  "$bin" -w -I INPUT 1 -j "$input_chain"
  "$bin" -w -I FORWARD 1 -j "$forward_chain"

  "$bin" -w -P INPUT DROP
  "$bin" -w -P FORWARD DROP
  "$bin" -w -P OUTPUT ACCEPT
}

preflight
backup_rules
install_filter iptables HOMELAB-INPUT HOMELAB-FORWARD icmp "$APP_TUNNEL_IP"
install_filter ip6tables HOMELAB6-INPUT HOMELAB6-FORWARD icmpv6 ""
netfilter-persistent save

printf '%s\n' 'Firewall installed. wg0 family VPN rules were preserved; wg-jellyfin is limited to TCP 80/443.'
