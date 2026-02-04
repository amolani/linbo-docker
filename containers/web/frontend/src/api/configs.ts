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

export const configsApi = {
  list: async (): Promise<Config[]> => {
    const response = await apiClient.get<Config[]>('/configs');
    return response.data;
  },

  get: async (id: string): Promise<Config> => {
    const response = await apiClient.get<Config>(`/configs/${id}`);
    return response.data;
  },

  preview: async (id: string): Promise<string> => {
    const response = await apiClient.get<{ content: string }>(`/configs/${id}/preview`);
    return response.data.content;
  },

  create: async (data: CreateConfigData): Promise<Config> => {
    const response = await apiClient.post<Config>('/configs', data);
    return response.data;
  },

  update: async (id: string, data: UpdateConfigData): Promise<Config> => {
    const response = await apiClient.patch<Config>(`/configs/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/configs/${id}`);
  },

  applyToGroups: async (id: string, groupIds: string[]): Promise<{ success: boolean; updated: number }> => {
    const response = await apiClient.post<{ success: boolean; updated: number }>(
      `/configs/${id}/apply-to-groups`,
      { groupIds }
    );
    return response.data;
  },

  clone: async (id: string, newName: string): Promise<Config> => {
    const response = await apiClient.post<Config>(`/configs/${id}/clone`, { name: newName });
    return response.data;
  },
};
