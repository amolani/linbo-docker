import apiClient from './client';
import type { Image } from '@/types';

export interface CreateImageData {
  filename: string;
  type: 'base' | 'differential' | 'rsync';
  path: string;
  description?: string;
  backingImage?: string;
}

export interface UpdateImageData {
  description?: string;
  status?: 'available' | 'uploading' | 'verifying' | 'error';
}

export interface ImageInfo {
  filename: string;
  size: number;
  checksum: string;
  createdAt: string;
  modifiedAt: string;
}

export const imagesApi = {
  list: async (): Promise<Image[]> => {
    const response = await apiClient.get<Image[]>('/images');
    return response.data;
  },

  get: async (id: string): Promise<Image> => {
    const response = await apiClient.get<Image>(`/images/${id}`);
    return response.data;
  },

  create: async (data: CreateImageData): Promise<Image> => {
    const response = await apiClient.post<Image>('/images', data);
    return response.data;
  },

  register: async (filename: string): Promise<Image> => {
    const response = await apiClient.post<Image>('/images/register', { filename });
    return response.data;
  },

  update: async (id: string, data: UpdateImageData): Promise<Image> => {
    const response = await apiClient.patch<Image>(`/images/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/images/${id}`);
  },

  verify: async (id: string): Promise<{ valid: boolean; checksum: string }> => {
    const response = await apiClient.post<{ valid: boolean; checksum: string }>(
      `/images/${id}/verify`
    );
    return response.data;
  },

  getInfo: async (id: string): Promise<ImageInfo> => {
    const response = await apiClient.get<ImageInfo>(`/images/${id}/info`);
    return response.data;
  },
};
