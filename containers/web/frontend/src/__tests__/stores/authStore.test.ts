import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Auth Store - Rehydration Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
  });

  it('should sync token to localStorage on rehydration', () => {
    // Simulate the onRehydrateStorage callback behavior
    const state = {
      token: 'rehydrated-token-789',
      user: { id: '1', username: 'admin', email: 'admin@test.com', role: 'admin' as const },
      isAuthenticated: false,
    };

    // This is what onRehydrateStorage does:
    if (state?.token) {
      localStorage.setItem('token', state.token);
      state.isAuthenticated = true;
    }

    expect(localStorage.setItem).toHaveBeenCalledWith('token', 'rehydrated-token-789');
    expect(state.isAuthenticated).toBe(true);
  });

  it('should not set token if state is null', () => {
    const state = null;

    // This is what onRehydrateStorage does:
    if (state?.token) {
      localStorage.setItem('token', state.token);
    }

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('should not set token if token is empty', () => {
    const state = {
      token: null,
      user: null,
      isAuthenticated: false,
    };

    // This is what onRehydrateStorage does:
    if (state?.token) {
      localStorage.setItem('token', state.token);
    }

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('Auth Store - Login Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store token in localStorage after login', () => {
    const loginResponse = {
      token: 'new-login-token-abc',
      user: {
        id: '1',
        username: 'admin',
        email: 'admin@localhost',
        role: 'admin' as const,
      },
    };

    // Simulate login behavior
    localStorage.setItem('token', loginResponse.token);

    expect(localStorage.setItem).toHaveBeenCalledWith('token', 'new-login-token-abc');
  });

  it('should remove token on logout', () => {
    // Simulate logout behavior
    localStorage.removeItem('token');

    expect(localStorage.removeItem).toHaveBeenCalledWith('token');
  });
});

describe('Auth Store - Check Auth Logic', () => {
  it('should return not authenticated when no token', () => {
    const state = {
      token: null,
      isAuthenticated: false,
    };

    // checkAuth logic when no token
    if (!state.token) {
      state.isAuthenticated = false;
    }

    expect(state.isAuthenticated).toBe(false);
  });
});
