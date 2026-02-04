import apiClient from './client';
import type { LoginRequest, LoginResponse, User } from '@/types';

export const authApi = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/login', credentials);
    return response.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },

  me: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },

  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await apiClient.put('/auth/password', { oldPassword, newPassword });
  },

  register: async (data: { username: string; password: string; email?: string; role?: string }): Promise<User> => {
    const response = await apiClient.post<User>('/auth/register', data);
    return response.data;
  },
};
