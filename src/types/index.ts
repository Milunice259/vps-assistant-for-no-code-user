/**
 * Shared TypeScript types used across the application.
 */

// ─── System Stats ───

export interface CpuStats {
  model?: string;
  cores?: number;
  usagePercent: number;
}

export interface MemoryStats {
  total: number;
  used: number;
  available: number;
  usagePercent: number;
}

export interface DiskStats {
  total: number;
  used: number;
  available: number;
  usagePercent: number;
}

export interface OSDetails {
  distro: string;
  version: string;
  kernel: string;
}

export interface SystemStats {
  hostname: string;
  platform: string;
  uptime: number | string;
  cpu: CpuStats;
  memory: MemoryStats;
  disk: DiskStats;
  os?: OSDetails;
}

// ─── Dashboard Summary ───

export interface DashboardSummary {
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  apps: {
    total: number;
    running: number;
    stopped: number;
  };
  servers: {
    total: number;
    active: number;
  };
  network: {
    listeningPorts: number;
    dockerNetworks: number;
  };
  deployments: {
    total: number;
    running: number;
    failed: number;
    recent: number; // last 24h
  };
  os: {
    distro: string;
    kernel: string;
    arch: string;
  };
}

// ─── Server (VPS Connection) ───

export interface ServerInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "PASSWORD" | "KEY";
  isActive: boolean;
  lastConnected: string | null;
  createdAt: string;
  hostname?: string;
}

export interface CreateServerInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod: "PASSWORD" | "KEY";
  password?: string;
  privateKey?: string;
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: "PASSWORD" | "KEY";
  password?: string;
  privateKey?: string;
  isActive?: boolean;
}

// ─── Deployment ───

export type DetectedStack =
  | "nextjs"
  | "react"
  | "vue"
  | "nuxt"
  | "node"
  | "python"
  | "go"
  | "rust"
  | "static"
  | "unknown";

export type DeployStatus =
  | "PENDING"
  | "CLONING"
  | "BUILDING"
  | "RUNNING"
  | "FAILED";

export interface DeploymentInfo {
  id: string;
  repoUrl: string;
  branch: string;
  detectedStack: string;
  status: DeployStatus;
  logs: string;
  domain: string | null;
  serverId: string | null;
  commitHash: string | null;
  customPath: string | null;
  createdAt: string;
}

export interface DeployInput {
  repoUrl: string;
  branch?: string;
  domain?: string;
  serverId?: string;
  customPath?: string;
  envVars?: string;
}

// ─── Network ───

export interface PortInfo {
  protocol: string;
  localAddress: string;
  localPort: number;
  foreignAddress: string;
  foreignPort: number;
  state: string;
  process: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  status: string;
  upgradable: boolean;
  newVersion?: string;
}

// ─── Docker & Containers ───

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  uptime: string;
  ports: string;
  state: string;
}

export type ContainerActionType = "start" | "stop" | "restart";

// ─── System Services ───

export interface ServiceInfo {
  name: string;
  loadState: string;
  activeState: string;
  subState: string;
  unitFileState?: string;
  description: string;
}

// ─── Network Topology ───

export interface DockerNetworkContainer {
  id: string;
  name: string;
  ipv4: string;
  image?: string;
  state?: string;
  ports?: string;
}

export interface DockerNetworkInfo {
  id: string;
  name: string;
  driver: string;
  containers: DockerNetworkContainer[];
}

export interface NetworkTopology {
  networks: DockerNetworkInfo[];
  hostPorts: PortInfo[];
}

// ─── Applications ───

export type AppStatusType =
  | "RUNNING"
  | "STOPPED"
  | "RESTARTING"
  | "UNHEALTHY"
  | "UNKNOWN";

export interface AppInfo {
  id: string;
  name: string;
  containerId: string | null;
  containerName: string | null;
  image: string | null;
  serverId: string;
  serverName: string;
  status: AppStatusType;
  domain: string | null;
  createdAt: string;
}

/** Full app detail with resource config + metrics */
export interface AppDetailInfo extends AppInfo {
  cpuLimit: number | null;
  memoryLimit: number | null;
  storageLimit: number | null;
  restartPolicy: string | null;
  healthCheck: string | null;
  volumes: string | null; // JSON string
  ports: string | null; // JSON string
  updatedAt: string;
}

/** Per-app resource metric data point */
export interface AppMetricInfo {
  id: string;
  cpuUsage: number;
  memUsage: number;
  netIn: number | null;
  netOut: number | null;
  timestamp: string;
}

/** Downsampled metric point for chart display */
export interface MetricPoint {
  time: string;   // ISO timestamp
  cpu: number;
  mem: number;
  netIn: number;
  netOut: number;
}

/** Live container stats from docker stats */
export interface ContainerStats {
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  memPercent: number;
  netIn: number;
  netOut: number;
  pids: number;
}

export interface CreateAppInput {
  name: string;
  serverId: string;
  containerId?: string;
  containerName?: string;
  image?: string;
  domain?: string;
}

export interface UpdateAppInput {
  name?: string;
  domain?: string;
  cpuLimit?: number | null;
  memoryLimit?: number | null;
  storageLimit?: number | null;
  restartPolicy?: string | null;
  healthCheck?: string | null;
}

export type AppActionType = "start" | "stop" | "restart" | "pull" | "recreate";

// ─── Quick Actions ───

export type QuickActionType = "apt-update" | "docker-prune" | "restart-docker";

// ─── API Responses ───

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  warning?: string;
  code?: string;
}

// ─── Auth ───

export interface LoginInput {
  username: string;
  password: string;
}

export interface UserInfo {
  id: string;
  username: string;
}
