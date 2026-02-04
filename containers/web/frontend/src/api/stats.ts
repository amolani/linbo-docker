import apiClient from './client';
import type { DashboardStats } from '@/types';

export interface HostStats {
  total: number;
  byStatus: Record<string, number>;
  byRoom: Record<string, number>;
  byGroup: Record<string, number>;
}

export interface OperationStats {
  total: number;
  byStatus: Record<string, number>;
  recentCount: number;
  averageDuration: number;
}

export interface ImageStats {
  total: number;
  totalSize: number;
  byType: Record<string, number>;
  largestImages: Array<{ filename: string; size: number }>;
}

export interface AuditStats {
  total: number;
  byAction: Record<string, number>;
  byActor: Record<string, number>;
  recentActivity: Array<{
    timestamp: string;
    actor: string;
    action: string;
    targetType: string;
    targetName: string;
  }>;
}

export const statsApi = {
  overview: async (): Promise<DashboardStats> => {
    const response = await apiClient.get<DashboardStats>('/stats/overview');
    return response.data;
  },

  hosts: async (): Promise<HostStats> => {
    const response = await apiClient.get<HostStats>('/stats/hosts');
    return response.data;
  },

  operations: async (): Promise<OperationStats> => {
    const response = await apiClient.get<OperationStats>('/stats/operations');
    return response.data;
  },

  images: async (): Promise<ImageStats> => {
    const response = await apiClient.get<ImageStats>('/stats/images');
    return response.data;
  },

  audit: async (): Promise<AuditStats> => {
    const response = await apiClient.get<AuditStats>('/stats/audit');
    return response.data;
  },
};
