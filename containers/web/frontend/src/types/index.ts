// User & Auth
export interface User {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'operator' | 'viewer';
  active: boolean;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// Room
export interface Room {
  id: string;
  name: string;
  description?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
  hosts?: Host[];
  _count?: {
    hosts: number;
  };
}

// Host
export interface Host {
  id: string;
  hostname: string;
  macAddress: string;
  ipAddress?: string;
  roomId?: string;
  configId?: string;
  status: HostStatus;
  lastSeen?: string;
  bootMode?: string;
  hardware?: HardwareInfo;
  cacheInfo?: CacheInfo;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  room?: Room;
  config?: Config;
}

export type HostStatus = 'online' | 'offline' | 'syncing' | 'booting' | 'unknown';

export interface HardwareInfo {
  cpu?: string;
  memory?: number;
  disk?: number;
  manufacturer?: string;
  model?: string;
}

export interface CacheInfo {
  size?: number;
  used?: number;
  images?: string[];
}

// Config
export interface Config {
  id: string;
  name: string;
  description?: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  linboSettings: LinboSettings;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  partitions?: ConfigPartition[];
  osEntries?: ConfigOs[];
  _count?: {
    hosts: number;
  };
}

export interface LinboSettings {
  server?: string;
  group?: string;
  cache?: string;
  roottimeout?: number;
  autopartition?: boolean;
  autoformat?: boolean;
  autoinitcache?: boolean;
  autostart?: boolean;
  downloadType?: 'rsync' | 'torrent' | 'multicast';
  kerneloptions?: string;
  systemtype?: 'bios' | 'bios64' | 'efi32' | 'efi64';
  locale?: string;
  backgroundfontcolor?: string;
  consolefontcolorsstdout?: string;
  consolefontcolorstderr?: string;
}

export interface ConfigPartition {
  id: string;
  configId?: string;
  position: number;
  device: string;
  label?: string;
  size?: string;
  partitionId?: number;
  fsType?: string;
  bootable: boolean;
}

export interface ConfigOs {
  id: string;
  configId?: string;
  position: number;
  name: string;
  version?: string;
  description?: string;
  osType?: string;
  iconName?: string;
  image?: string;
  baseImage?: string;
  differentialImage?: string;
  rootDevice?: string;
  root?: string;
  kernel?: string;
  initrd?: string;
  append?: string[] | string;
  startEnabled: boolean;
  syncEnabled: boolean;
  newEnabled: boolean;
  autostart: boolean;
  autostartTimeout: number;
  defaultAction?: string;
  restoreOpsiState?: boolean;
  forceOpsiSetup?: string;
  hidden?: boolean;
  prestartScript?: string;
  postsyncScript?: string;
}

// Image
export interface Image {
  id: string;
  filename: string;
  type: 'base' | 'differential' | 'rsync';
  path: string;
  size?: number;
  checksum?: string;
  backingImage?: string;
  description?: string;
  status: 'available' | 'uploading' | 'verifying' | 'error';
  torrentFile?: string;
  createdBy?: string;
  createdAt: string;
  uploadedAt?: string;
  lastUsedAt?: string;
  lastUsedBy?: string;
}

// Operation
export interface Operation {
  id: string;
  targetHosts: string[];
  commands: string[];
  options: Record<string, unknown>;
  status: OperationStatus;
  progress: number;
  stats?: OperationStats;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  sessions?: Session[];
}

export type OperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OperationStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
}

// Session
export interface Session {
  id: string;
  operationId?: string;
  hostId?: string;
  hostname?: string;
  tmuxSessionId?: string;
  status: SessionStatus;
  progress: number;
  logFile?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  host?: Host;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed';

// Stats
export interface DashboardStats {
  hosts: {
    total: number;
    online: number;
    offline: number;
    syncing: number;
  };
  configs: number;
  rooms: number;
  images: {
    total: number;
    totalSize: number;
  };
  operations: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
}

// API Response types
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// WebSocket events
export interface WsHostStatusEvent {
  type: 'host.status.changed';
  payload: {
    hostId: string;
    hostname: string;
    status: HostStatus;
    previousStatus: HostStatus;
    timestamp: string;
  };
}

export interface WsSyncProgressEvent {
  type: 'sync.progress';
  payload: {
    hostId: string;
    hostname: string;
    progress: number;
    speed?: string;
    eta?: string;
  };
}

export interface WsOperationProgressEvent {
  type: 'operation.progress';
  payload: {
    operationId: string;
    progress: number;
    stats: OperationStats;
  };
}

export interface WsNotificationEvent {
  type: 'notification';
  payload: {
    level: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
  };
}

export type WsEvent =
  | WsHostStatusEvent
  | WsSyncProgressEvent
  | WsOperationProgressEvent
  | WsNotificationEvent;

// Filters
export interface HostFilters {
  search?: string;
  status?: HostStatus;
  roomId?: string;
  configId?: string;
}

// Table Column
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => ReactNode;
  className?: string;
}
