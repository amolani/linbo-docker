import { create } from 'zustand';
import axios from 'axios';

interface ServerConfigState {
  serverIp: string;
  fetched: boolean;
  fetchServerConfig: () => Promise<void>;
}

export const useServerConfigStore = create<ServerConfigState>()((set, get) => ({
  serverIp: '10.0.0.1',
  fetched: false,

  fetchServerConfig: async () => {
    if (get().fetched) return;
    try {
      const res = await axios.get('/health');
      if (res.data?.serverIp) {
        set({ serverIp: res.data.serverIp, fetched: true });
      }
    } catch {
      // Fallback bleibt 10.0.0.1
      set({ fetched: true });
    }
  },
}));
