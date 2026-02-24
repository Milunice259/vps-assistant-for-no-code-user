/**
 * SSH Module — Re-exports all SSH functionality.
 *
 * All consumers use `import { ... } from "@/lib/ssh"` — this index
 * file ensures zero breaking changes after the module split.
 */

// Connection management
export {
  type SSHConnectionConfig,
  createSSHConnection,
  closeSSH,
  executeCommand,
  executeCommandSafe,
} from "./connection";

// System stats & OS details
export {
  getRemoteStats,
  type RemoteOSDetails,
  getRemoteOSDetails,
} from "./stats";

// Docker containers & systemd services
export {
  type RemoteContainerInfo,
  getRemoteContainers,
  type RemoteServiceInfo,
  getRemoteServices,
  type ContainerAction,
  containerAction,
  getContainerLogs,
} from "./containers";

// Docker networks & host ports
export {
  type RemoteDockerNetworkContainer,
  type RemoteDockerNetwork,
  getRemoteDockerNetworks,
  getRemoteHostPorts,
} from "./network";

// Quick actions & remote deployment
export {
  quickAction,
  type RemoteDeployResult,
  remoteDeployViaSSH,
} from "./actions";

// Connection pool
export {
  getPooledConnection,
  releaseConnection,
  drainPool,
  getPoolStats,
} from "./pool";
