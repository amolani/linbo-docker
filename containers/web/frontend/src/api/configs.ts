import apiClient from './client';
import type { Config, ConfigPartition, ConfigOs, LinboSettings } from '@/types';

export interface CreateConfigData {
  name: string;
  description?: string;
  linboSettings?: LinboSettings;
  partitions?: Omit<ConfigPartition, 'id' | 'configId'>[];
  osEntries?: Omit<ConfigOs, 'id' | 'configId'>[];
}

export interface UpdateConfigData {
  name?: string;
  description?: string;
  version?: string;
  status?: 'draft' | 'active' | 'archived';
  linboSettings?: LinboSettings;
  partitions?: Omit<ConfigPartition, 'id' | 'configId'>[];
  osEntries?: Omit<ConfigOs, 'id' | 'configId'>[];
}

// API response wrapper type
interface ApiResponse<T> {
  data: T;
}

export const configsApi = {
  list: async (): Promise<Config[]> => {
    const response = await apiClient.get<ApiResponse<Config[]>>('/configs');
    return response.data.data;
  },

  get: async (id: string): Promise<Config> => {
    const response = await apiClient.get<ApiResponse<Config>>(`/configs/${id}`);
    return response.data.data;
  },

  preview: async (id: string): Promise<string> => {
    const response = await apiClient.get<ApiResponse<{ content: string }>>(`/configs/${id}/preview`);
    return response.data.data.content;
  },

  create: async (data: CreateConfigData): Promise<Config> => {
    const response = await apiClient.post<ApiResponse<Config>>('/configs', data);
    return response.data.data;
  },

  update: async (id: string, data: UpdateConfigData): Promise<Config> => {
    const response = await apiClient.patch<ApiResponse<Config>>(`/configs/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/configs/${id}`);
  },

  applyToGroups: async (id: string, groupIds: string[]): Promise<{ success: boolean; updated: number }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean; updated: number }>>(
      `/configs/${id}/apply-to-groups`,
      { groupIds }
    );
    return response.data.data;
  },

  clone: async (id: string, newName: string): Promise<Config> => {
    const response = await apiClient.post<ApiResponse<Config>>(`/configs/${id}/clone`, { name: newName });
    return response.data.data;
  },
};
