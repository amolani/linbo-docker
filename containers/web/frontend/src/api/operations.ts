import apiClient from './client';
import type { Operation, PaginatedResponse } from '@/types';

export interface CreateOperationData {
  targetHosts: string[];
  commands: string[];
  options?: Record<string, unknown>;
}

export interface SendCommandData {
  hostIds: string[];
  command: string;
  args?: string[];
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

export const operationsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<Operation>> => {
    const response = await apiClient.get<PaginatedApiResponse<Operation>>('/operations', {
      params: {
        page: params?.page || 1,
        limit: params?.limit || 25,
        status: params?.status,
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

  get: async (id: string): Promise<Operation> => {
    const response = await apiClient.get<ApiResponse<Operation>>(`/operations/${id}`);
    return response.data.data;
  },

  create: async (data: CreateOperationData): Promise<Operation> => {
    const response = await apiClient.post<ApiResponse<Operation>>('/operations', data);
    return response.data.data;
  },

  sendCommand: async (data: SendCommandData): Promise<{ operationId: string }> => {
    const response = await apiClient.post<ApiResponse<{ operationId: string }>>(
      '/operations/send-command',
      data
    );
    return response.data.data;
  },

  update: async (id: string, data: Partial<Operation>): Promise<Operation> => {
    const response = await apiClient.patch<ApiResponse<Operation>>(`/operations/${id}`, data);
    return response.data.data;
  },

  cancel: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean }>>(`/operations/${id}/cancel`);
    return response.data.data;
  },
};
