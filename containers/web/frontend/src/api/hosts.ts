import apiClient from './client';
import type { Host, PaginatedResponse, HostFilters } from '@/types';

// Import/Export types
export interface ImportResult {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    line: number;
    hostname?: string;
    error: string;
  }>;
  hosts?: Host[];
}

export interface ImportValidationResult {
  valid: boolean;
  totalLines: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  errors: Array<{
    line: number;
    hostname?: string;
    error: string;
  }>;
  preview: Array<{
    line: number;
    hostname: string;
    mac: string;
    ip?: string;
    room?: string;
    group?: string;
    action: 'create' | 'update' | 'skip';
    reason?: string;
  }>;
}

export interface CreateHostData {
  hostname: string;
  macAddress: string;
  ipAddress?: string;
  roomId?: string;
  configId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateHostData {
  hostname?: string;
  macAddress?: string;
  ipAddress?: string;
  roomId?: string | null;
  configId?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

// API response wrapper types
interface ApiResponse<T> {
  data: T;
}

interface PaginatedApiResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const hostsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    filters?: HostFilters;
    sort?: string;
    order?: 'asc' | 'desc';
  }): Promise<PaginatedResponse<Host>> => {
    const response = await apiClient.get<PaginatedApiResponse<Host>>('/hosts', {
      params: {
        page: params?.page || 1,
        limit: params?.limit || 25,
        search: params?.filters?.search,
        status: params?.filters?.status,
        roomId: params?.filters?.roomId,
        configId: params?.filters?.configId,
        sort: params?.sort,
        order: params?.order,
      },
    });
    // Transform API response to match PaginatedResponse type
    return {
      data: response.data.data,
      total: response.data.pagination.total,
      page: response.data.pagination.page,
      limit: response.data.pagination.limit,
      totalPages: response.data.pagination.pages,
    };
  },

  get: async (id: string): Promise<Host> => {
    const response = await apiClient.get<ApiResponse<Host>>(`/hosts/${id}`);
    return response.data.data;
  },

  getByHostname: async (hostname: string): Promise<Host> => {
    const response = await apiClient.get<ApiResponse<Host>>(`/hosts/by-name/${hostname}`);
    return response.data.data;
  },

  getByMac: async (mac: string): Promise<Host> => {
    const response = await apiClient.get<ApiResponse<Host>>(`/hosts/by-mac/${mac}`);
    return response.data.data;
  },

  create: async (data: CreateHostData): Promise<Host> => {
    const response = await apiClient.post<ApiResponse<Host>>('/hosts', data);
    return response.data.data;
  },

  update: async (id: string, data: UpdateHostData): Promise<Host> => {
    const response = await apiClient.patch<ApiResponse<Host>>(`/hosts/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/hosts/${id}`);
  },

  wakeOnLan: async (id: string): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean; message: string }>>(
      `/hosts/${id}/wake-on-lan`
    );
    return response.data.data;
  },

  sync: async (id: string, options?: { image?: string; force?: boolean }): Promise<{ operationId: string }> => {
    const response = await apiClient.post<ApiResponse<{ operationId: string }>>(
      `/hosts/${id}/sync`,
      options
    );
    return response.data.data;
  },

  start: async (id: string, osIndex?: number): Promise<{ success: boolean }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean }>>(
      `/hosts/${id}/start`,
      { osIndex }
    );
    return response.data.data;
  },

  updateStatus: async (id: string, status: string): Promise<Host> => {
    const response = await apiClient.patch<ApiResponse<Host>>(`/hosts/${id}/status`, { status });
    return response.data.data;
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
    const response = await apiClient.post<ApiResponse<{ operationId: string }>>('/operations', {
      targetHosts: hostIds,
      commands: ['sync'],
      options,
    });
    return response.data.data;
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

  bulkDelete: async (hostIds: string[]): Promise<{ success: number; failed: number }> => {
    const results = await Promise.allSettled(
      hostIds.map((id) => apiClient.delete(`/hosts/${id}`))
    );
    return {
      success: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  },

  // Device Import/Export (Phase 7c)
  import: async (csv: string, options?: { dryRun?: boolean }): Promise<ImportResult> => {
    const response = await apiClient.post<ApiResponse<ImportResult>>('/hosts/import', {
      csv,
      options,
    });
    return response.data.data;
  },

  importValidate: async (csv: string): Promise<ImportValidationResult> => {
    const response = await apiClient.post<ApiResponse<ImportValidationResult>>('/hosts/import/validate', {
      csv,
    });
    return response.data.data;
  },

  export: async (): Promise<Blob> => {
    const response = await apiClient.get('/hosts/export', {
      responseType: 'blob',
    });
    return response.data;
  },
};
