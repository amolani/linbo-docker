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

export const operationsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<Operation>> => {
    const response = await apiClient.get<PaginatedResponse<Operation>>('/operations', {
      params: {
        page: params?.page || 1,
        limit: params?.limit || 25,
        status: params?.status,
      },
    });
    return response.data;
  },

  get: async (id: string): Promise<Operation> => {
    const response = await apiClient.get<Operation>(`/operations/${id}`);
    return response.data;
  },

  create: async (data: CreateOperationData): Promise<Operation> => {
    const response = await apiClient.post<Operation>('/operations', data);
    return response.data;
  },

  sendCommand: async (data: SendCommandData): Promise<{ operationId: string }> => {
    const response = await apiClient.post<{ operationId: string }>(
      '/operations/send-command',
      data
    );
    return response.data;
  },

  update: async (id: string, data: Partial<Operation>): Promise<Operation> => {
    const response = await apiClient.patch<Operation>(`/operations/${id}`, data);
    return response.data;
  },

  cancel: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiClient.post<{ success: boolean }>(`/operations/${id}/cancel`);
    return response.data;
  },
};
