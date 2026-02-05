/**
 * LINBO Docker - API Tests
 * Vollständige Test-Suite für alle Endpoints
 */

const { TestClient, generateTestData, sleep } = require('./helpers');

describe('LINBO Docker API', () => {
  let client;

  beforeAll(async () => {
    client = new TestClient();
  });

  // ===========================================================================
  // Health Checks
  // ===========================================================================
  describe('Health Checks', () => {
    test('GET /health returns healthy status', async () => {
      const res = await client.get('/health', { skipAuth: true });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('healthy');
      expect(res.data.services).toBeDefined();
      expect(res.data.services.api).toBe('up');
      expect(res.data.services.database).toBe('up');
      expect(res.data.services.redis).toBe('up');
    });

    test('GET /ready returns ready status', async () => {
      const res = await client.get('/ready', { skipAuth: true });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('ready');
    });
  });

  // ===========================================================================
  // Authentication
  // ===========================================================================
  describe('Authentication', () => {
    test('POST /api/v1/auth/login with valid credentials returns token', async () => {
      const res = await client.post('/api/v1/auth/login', {
        username: 'admin',
        password: 'admin',
      }, { skipAuth: true });

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(res.data.data.token).toBeDefined();
      expect(res.data.data.user).toBeDefined();
      expect(res.data.data.user.username).toBe('admin');
      expect(res.data.data.user.role).toBe('admin');
    });

    test('POST /api/v1/auth/login with invalid credentials returns 401', async () => {
      const res = await client.post('/api/v1/auth/login', {
        username: 'admin',
        password: 'wrongpassword',
      }, { skipAuth: true });

      expect(res.status).toBe(401);
      expect(res.data.error).toBeDefined();
      expect(res.data.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('POST /api/v1/auth/login with missing fields returns 400', async () => {
      const res = await client.post('/api/v1/auth/login', {
        username: 'admin',
      }, { skipAuth: true });

      expect(res.status).toBe(400);
      expect(res.data.error).toBeDefined();
    });

    test('Protected endpoint without token returns 401', async () => {
      client.clearToken();
      const res = await client.get('/api/v1/hosts');

      expect(res.status).toBe(401);
      expect(res.data.error.code).toBe('UNAUTHORIZED');
    });

    test('Protected endpoint with invalid token returns 401 or 403', async () => {
      client.setToken('invalid_token');
      const res = await client.get('/api/v1/hosts');

      // 401 = missing/invalid token, 403 = forbidden (also valid for invalid token)
      expect([401, 403]).toContain(res.status);
    });

    test('GET /api/v1/auth/me with valid token returns user info', async () => {
      await client.login();
      const res = await client.get('/api/v1/auth/me');

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(res.data.data.username).toBe('admin');
    });
  });

  // ===========================================================================
  // Rooms CRUD
  // ===========================================================================
  describe('Rooms', () => {
    let testRoomId;
    const testRoom = {
      name: generateTestData.name(),
      description: 'Test Room for API Tests',
      location: 'Building A, Floor 1',
    };

    beforeAll(async () => {
      await client.login();
    });

    test('GET /api/v1/rooms returns rooms list', async () => {
      const res = await client.get('/api/v1/rooms');

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(Array.isArray(res.data.data)).toBe(true);
    });

    test('POST /api/v1/rooms creates new room', async () => {
      const res = await client.post('/api/v1/rooms', testRoom);

      expect(res.status).toBe(201);
      expect(res.data.data).toBeDefined();
      expect(res.data.data.name).toBe(testRoom.name);
      expect(res.data.data.id).toBeDefined();

      testRoomId = res.data.data.id;
    });

    test('GET /api/v1/rooms/:id returns room details', async () => {
      const res = await client.get(`/api/v1/rooms/${testRoomId}`);

      expect(res.status).toBe(200);
      expect(res.data.data.id).toBe(testRoomId);
      expect(res.data.data.name).toBe(testRoom.name);
    });

    test('PATCH /api/v1/rooms/:id updates room', async () => {
      const update = { description: 'Updated description' };
      const res = await client.patch(`/api/v1/rooms/${testRoomId}`, update);

      expect(res.status).toBe(200);
      expect(res.data.data.description).toBe(update.description);
    });

    test('DELETE /api/v1/rooms/:id deletes room', async () => {
      const res = await client.delete(`/api/v1/rooms/${testRoomId}`);

      expect(res.status).toBe(204);

      // Verify deletion
      const checkRes = await client.get(`/api/v1/rooms/${testRoomId}`);
      expect(checkRes.status).toBe(404);
    });

    test('POST /api/v1/rooms with duplicate name returns 409', async () => {
      // Create first room
      const room1 = { name: generateTestData.name() };
      const res1 = await client.post('/api/v1/rooms', room1);
      expect(res1.status).toBe(201);

      // Try to create duplicate
      const res2 = await client.post('/api/v1/rooms', room1);
      expect(res2.status).toBe(409);

      // Cleanup
      await client.delete(`/api/v1/rooms/${res1.data.data.id}`);
    });
  });

  // ===========================================================================
  // Hosts CRUD
  // ===========================================================================
  describe('Hosts', () => {
    let testHostId;
    let testRoomId;
    let testConfigId;

    beforeAll(async () => {
      await client.login();

      // Create room and config for host tests
      const roomRes = await client.post('/api/v1/rooms', { name: generateTestData.name() });
      testRoomId = roomRes.data.data.id;

      const configRes = await client.post('/api/v1/configs', { name: generateTestData.name() });
      testConfigId = configRes.data.data.id;
    });

    afterAll(async () => {
      // Cleanup
      if (testRoomId) await client.delete(`/api/v1/rooms/${testRoomId}`);
      if (testConfigId) await client.delete(`/api/v1/configs/${testConfigId}`);
    });

    test('GET /api/v1/hosts returns hosts list with pagination', async () => {
      const res = await client.get('/api/v1/hosts');

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(Array.isArray(res.data.data)).toBe(true);
      expect(res.data.pagination).toBeDefined();
      expect(res.data.pagination.page).toBeDefined();
      expect(res.data.pagination.limit).toBeDefined();
      expect(res.data.pagination.total).toBeDefined();
    });

    test('POST /api/v1/hosts creates new host', async () => {
      const testHost = {
        hostname: generateTestData.hostname(),
        macAddress: generateTestData.mac(),
        ipAddress: generateTestData.ip(),
        roomId: testRoomId,
        configId: testConfigId,
      };

      const res = await client.post('/api/v1/hosts', testHost);

      expect(res.status).toBe(201);
      expect(res.data.data).toBeDefined();
      expect(res.data.data.hostname).toBe(testHost.hostname);
      // MAC addresses are normalized to lowercase
      expect(res.data.data.macAddress.toLowerCase()).toBe(testHost.macAddress.toLowerCase());

      testHostId = res.data.data.id;
    });

    test('POST /api/v1/hosts with invalid MAC returns 400', async () => {
      const invalidHost = {
        hostname: generateTestData.hostname(),
        macAddress: 'invalid-mac',
      };

      const res = await client.post('/api/v1/hosts', invalidHost);

      expect(res.status).toBe(400);
    });

    test('GET /api/v1/hosts/:id returns host details', async () => {
      const res = await client.get(`/api/v1/hosts/${testHostId}`);

      expect(res.status).toBe(200);
      expect(res.data.data.id).toBe(testHostId);
      expect(res.data.data.room).toBeDefined();
      expect(res.data.data.config).toBeDefined();
    });

    test('GET /api/v1/hosts/by-mac/:mac returns host', async () => {
      // First get the host to know its MAC
      const hostRes = await client.get(`/api/v1/hosts/${testHostId}`);
      const mac = hostRes.data.data.macAddress;

      const res = await client.get(`/api/v1/hosts/by-mac/${encodeURIComponent(mac)}`);

      expect(res.status).toBe(200);
      expect(res.data.data.id).toBe(testHostId);
    });

    test('PATCH /api/v1/hosts/:id updates host', async () => {
      const update = {
        status: 'online',
        ipAddress: generateTestData.ip(),
      };
      const res = await client.patch(`/api/v1/hosts/${testHostId}`, update);

      expect(res.status).toBe(200);
      expect(res.data.data.status).toBe(update.status);
    });

    test('GET /api/v1/hosts with filters', async () => {
      const res = await client.get(`/api/v1/hosts?roomId=${testRoomId}`);

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThan(0);
      res.data.data.forEach(host => {
        expect(host.roomId).toBe(testRoomId);
      });
    });

    test('DELETE /api/v1/hosts/:id deletes host', async () => {
      const res = await client.delete(`/api/v1/hosts/${testHostId}`);

      expect(res.status).toBe(204);

      const checkRes = await client.get(`/api/v1/hosts/${testHostId}`);
      expect(checkRes.status).toBe(404);
    });

    test('POST /api/v1/hosts with duplicate MAC returns 409', async () => {
      const mac = generateTestData.mac();

      const host1 = {
        hostname: generateTestData.hostname(),
        macAddress: mac,
      };
      const res1 = await client.post('/api/v1/hosts', host1);
      expect(res1.status).toBe(201);

      const host2 = {
        hostname: generateTestData.hostname(),
        macAddress: mac,
      };
      const res2 = await client.post('/api/v1/hosts', host2);
      expect(res2.status).toBe(409);

      // Cleanup
      await client.delete(`/api/v1/hosts/${res1.data.data.id}`);
    });
  });

  // ===========================================================================
  // Stats
  // ===========================================================================
  describe('Stats', () => {
    beforeAll(async () => {
      await client.login();
    });

    test('GET /api/v1/stats/overview returns statistics', async () => {
      const res = await client.get('/api/v1/stats/overview');

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(typeof res.data.data.hosts.total).toBe('number');
      expect(typeof res.data.data.hosts.online).toBe('number');
      expect(typeof res.data.data.hosts.offline).toBe('number');
    });
  });

  // ===========================================================================
  // Configs
  // ===========================================================================
  describe('Configs', () => {
    let testConfigId;

    beforeAll(async () => {
      await client.login();
    });

    test('GET /api/v1/configs returns configs list', async () => {
      const res = await client.get('/api/v1/configs');

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(Array.isArray(res.data.data)).toBe(true);
    });

    test('POST /api/v1/configs creates new config', async () => {
      const testConfig = {
        name: generateTestData.name(),
        description: 'Test Config',
        linboSettings: {
          cache: '/dev/sda2',
          downloadType: 'rsync',
          autoPartition: true,
        },
      };

      const res = await client.post('/api/v1/configs', testConfig);

      expect(res.status).toBe(201);
      expect(res.data.data).toBeDefined();
      expect(res.data.data.name).toBe(testConfig.name);

      testConfigId = res.data.data.id;
    });

    test('GET /api/v1/configs/:id returns config details', async () => {
      const res = await client.get(`/api/v1/configs/${testConfigId}`);

      expect(res.status).toBe(200);
      expect(res.data.data.id).toBe(testConfigId);
    });

    test('GET /api/v1/configs/:id/preview returns start.conf format', async () => {
      const res = await client.get(`/api/v1/configs/${testConfigId}/preview`);

      expect(res.status).toBe(200);
      // Preview returns text/plain
      expect(typeof res.data).toBe('string');
      expect(res.data).toContain('[LINBO]');
    });

    test('DELETE /api/v1/configs/:id deletes config', async () => {
      const res = await client.delete(`/api/v1/configs/${testConfigId}`);

      expect(res.status).toBe(204);
    });
  });

  // ===========================================================================
  // Images
  // ===========================================================================
  describe('Images', () => {
    beforeAll(async () => {
      await client.login();
    });

    test('GET /api/v1/images returns images list', async () => {
      const res = await client.get('/api/v1/images');

      expect(res.status).toBe(200);
      expect(res.data.data).toBeDefined();
      expect(Array.isArray(res.data.data)).toBe(true);
    });
  });

  // ===========================================================================
  // API Info
  // ===========================================================================
  describe('API Info', () => {
    test('GET /api/v1 returns API documentation', async () => {
      const res = await client.get('/api/v1', { skipAuth: true });

      expect(res.status).toBe(200);
      expect(res.data.message).toBe('LINBO Docker API');
      expect(res.data.version).toBe('v1');
      expect(res.data.endpoints).toBeDefined();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================
  describe('Error Handling', () => {
    beforeAll(async () => {
      await client.login();
    });

    test('GET non-existent endpoint returns 404', async () => {
      const res = await client.get('/api/v1/nonexistent');

      expect(res.status).toBe(404);
      expect(res.data.error).toBeDefined();
      expect(res.data.error.code).toBe('NOT_FOUND');
    });

    test('GET non-existent resource returns 404', async () => {
      const res = await client.get('/api/v1/hosts/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.data.error.code).toBe('NOT_FOUND');
    });

    test('POST with invalid JSON returns 400', async () => {
      const res = await fetch(`${client.baseUrl}/api/v1/hosts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${client.token}`,
        },
        body: 'invalid json{',
      });

      expect(res.status).toBe(400);
    });
  });
});
