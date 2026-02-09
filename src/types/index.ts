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

export interface SystemStats {
  hostname: string;
  platform: string;
  uptime: number | string;
  cpu: CpuStats;
  memory: MemoryStats;
  disk: DiskStats;
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
  createdAt: string;
}

export interface DeployInput {
  repoUrl: string;
  branch?: string;
  domain?: string;
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

// ─── API Responses ───

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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
