import apiClient from './client';
import type { Host, PaginatedResponse, HostFilters } from '@/types';

export interface CreateHostData {
  hostname: string;
  macAddress: string;
  ipAddress?: string;
  roomId?: string;
  groupId?: string;
  configId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateHostData {
  hostname?: string;
  macAddress?: string;
  ipAddress?: string;
  roomId?: string | null;
  groupId?: string | null;
  configId?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

export const hostsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    filters?: HostFilters;
    sort?: string;
    order?: 'asc' | 'desc';
  }): Promise<PaginatedResponse<Host>> => {
    const response = await apiClient.get<PaginatedResponse<Host>>('/hosts', {
      params: {
        page: params?.page || 1,
        limit: params?.limit || 25,
        search: params?.filters?.search,
        status: params?.filters?.status,
        roomId: params?.filters?.roomId,
        groupId: params?.filters?.groupId,
        configId: params?.filters?.configId,
        sort: params?.sort,
        order: params?.order,
      },
    });
    return response.data;
  },

  get: async (id: string): Promise<Host> => {
    const response = await apiClient.get<Host>(`/hosts/${id}`);
    return response.data;
  },

  getByHostname: async (hostname: string): Promise<Host> => {
    const response = await apiClient.get<Host>(`/hosts/by-name/${hostname}`);
    return response.data;
  },

  getByMac: async (mac: string): Promise<Host> => {
    const response = await apiClient.get<Host>(`/hosts/by-mac/${mac}`);
    return response.data;
  },

  create: async (data: CreateHostData): Promise<Host> => {
    const response = await apiClient.post<Host>('/hosts', data);
    return response.data;
  },

  update: async (id: string, data: UpdateHostData): Promise<Host> => {
    const response = await apiClient.patch<Host>(`/hosts/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/hosts/${id}`);
  },

  wakeOnLan: async (id: string): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post<{ success: boolean; message: string }>(
      `/hosts/${id}/wake-on-lan`
    );
    return response.data;
  },

  sync: async (id: string, options?: { image?: string; force?: boolean }): Promise<{ operationId: string }> => {
    const response = await apiClient.post<{ operationId: string }>(
      `/hosts/${id}/sync`,
      options
    );
    return response.data;
  },

  start: async (id: string, osIndex?: number): Promise<{ success: boolean }> => {
    const response = await apiClient.post<{ success: boolean }>(
      `/hosts/${id}/start`,
      { osIndex }
    );
    return response.data;
  },

  updateStatus: async (id: string, status: string): Promise<Host> => {
    const response = await apiClient.patch<Host>(`/hosts/${id}/status`, { status });
    return response.data;
  },

  bulkWakeOnLan: async (hostIds: string[]): Promise<{ success: number; failed: number }> => {
    const results = await Promise.allSettled(
      hostIds.map((id) => apiClient.post(`/hosts/${id}/wake-on-lan`))
    );
    return {
      success: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  },

  bulkSync: async (hostIds: string[], options?: { image?: string; force?: boolean }): Promise<{ operationId: string }> => {
    const response = await apiClient.post<{ operationId: string }>('/operations', {
      targetHosts: hostIds,
      commands: ['sync'],
      options,
    });
    return response.data;
  },

  bulkStart: async (hostIds: string[], osIndex?: number): Promise<{ success: number; failed: number }> => {
    const results = await Promise.allSettled(
      hostIds.map((id) => apiClient.post(`/hosts/${id}/start`, { osIndex }))
    );
    return {
      success: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  },
};
