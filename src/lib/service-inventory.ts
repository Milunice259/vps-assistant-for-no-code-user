export const serviceUnitsCommand = "systemctl list-units --type=service --all --no-pager --plain --no-legend";
export const serviceFilesCommand = "systemctl list-unit-files --type=service --no-pager --no-legend";
// ssh2-promise can resolve nonzero exits: both inventories need success evidence.
export const serviceInventoryCommand = `{ ${serviceUnitsCommand} && printf '\\n__VPS_SERVICE_UNITS_OK__\\n' && ${serviceFilesCommand} && printf '\\n__VPS_SERVICE_FILES_OK__\\n'; } 2>/dev/null`;
export function parseServiceInventory(raw: string) {
  const parts = raw.trim().match(/^([\s\S]*?)\n?__VPS_SERVICE_UNITS_OK__\n([\s\S]*?)\n?__VPS_SERVICE_FILES_OK__$/);
  if (!parts) throw Object.assign(new Error("Service inventory unavailable; systemd service discovery did not complete."), { statusCode: 503 });
  return parseServices(parts[1], parts[2]);
}
export function parseServices(units: string, files: string) {
  const enabled = new Map(files.split("\n").map(line => line.trim().split(/\s+/)).filter(parts => parts[0]?.endsWith(".service")).map(parts => [parts[0], parts[1]]));
  return units.split("\n").flatMap(line => {
    const parts = line.trim().replace(/^●\s*/, "").split(/\s+/);
    if (!parts[0]?.endsWith(".service") || parts.length < 4) return [];
    return [{name:parts[0].slice(0,-8),loadState:parts[1],activeState:parts[2],subState:parts[3],unitFileState:enabled.get(parts[0]) || "unknown",description:parts.slice(4).join(" ")}];
  });
}
