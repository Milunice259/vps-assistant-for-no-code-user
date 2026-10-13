// Both targets use ss -H -tulnp: protocol, state, queues, endpoints, optional process.
export function parseHostPorts(raw: string) {
  return raw.split("\n").filter(line => line.trim()).flatMap(line => {
    const parts = line.trim().split(/\s+/);
    if (!/^(tcp|udp)$/.test(parts[0])) return [];
    const endpoint = (value: string) => { const i = value.lastIndexOf(":"); return { address: value.slice(0, i).replace(/^\[|\]$/g, ""), port: Number(value.slice(i + 1)) }; };
    const local = endpoint(parts[4] || "");
    if (!Number.isInteger(local.port) || local.port < 1 || local.port > 65535 || !local.address) return [];
    const foreign = endpoint(parts[5] || "");
    return [{ protocol: parts[0], state: parts[1], localAddress: local.address, localPort: local.port, foreignAddress: foreign.address, foreignPort: Number.isFinite(foreign.port) ? foreign.port : 0, process: parts.slice(6).join(" ").match(/\(\("([^"]+)"/)?.[1] || "" }];
  });
}
