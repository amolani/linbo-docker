/**
 * LINBO Docker - Operation Worker Tests
 * Tests for sync-mode disabled state (Prisma-optional guard)
 */

// Must set env BEFORE requiring the worker
beforeAll(() => {
  process.env.SYNC_ENABLED = 'true';
});

afterAll(() => {
  delete process.env.SYNC_ENABLED;
});

// Mock dependencies that the worker would require in non-sync mode
jest.mock('../../src/lib/prisma', () => ({
  prisma: null,
}));

jest.mock('../../src/services/ssh.service', () => ({}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

// Import after env + mocks are set
const operationWorker = require('../../src/workers/operation.worker');

describe('Operation Worker (sync mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Module exports
  // =========================================================================
  describe('exports', () => {
    test('should export all 7 functions', () => {
      expect(typeof operationWorker.startWorker).toBe('function');
      expect(typeof operationWorker.stopWorker).toBe('function');
      expect(typeof operationWorker.pauseWorker).toBe('function');
      expect(typeof operationWorker.resumeWorker).toBe('function');
      expect(typeof operationWorker.getStatus).toBe('function');
      expect(typeof operationWorker.cancelOperation).toBe('function');
      expect(typeof operationWorker.retryOperation).toBe('function');
    });
  });

  // =========================================================================
  // startWorker
  // =========================================================================
  describe('startWorker', () => {
    test('should log disabled message via console.debug', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();

      operationWorker.startWorker();

      expect(debugSpy).toHaveBeenCalledWith(
        '[OperationWorker] Disabled -- sync mode (no database)'
      );
      debugSpy.mockRestore();
    });

    test('should not start polling loop (no console.log about starting)', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();

      operationWorker.startWorker();

      // Should NOT log "Started" or "Poll interval"
      const startLogs = logSpy.mock.calls.filter(c =>
        String(c[0]).includes('[OperationWorker] Started')
      );
      expect(startLogs).toHaveLength(0);

      logSpy.mockRestore();
      debugSpy.mockRestore();
    });
  });

  // =========================================================================
  // stopWorker / pauseWorker / resumeWorker (silent no-ops)
  // =========================================================================
  describe('silent no-ops', () => {
    test('stopWorker should be a silent no-op', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      expect(() => operationWorker.stopWorker()).not.toThrow();

      // Should not log anything
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    test('pauseWorker should be a silent no-op', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      expect(() => operationWorker.pauseWorker()).not.toThrow();

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    test('resumeWorker should be a silent no-op', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      expect(() => operationWorker.resumeWorker()).not.toThrow();

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  // =========================================================================
  // getStatus
  // =========================================================================
  describe('getStatus', () => {
    test('should return disabled status object', () => {
      const status = operationWorker.getStatus();

      expect(status).toEqual({
        running: false,
        disabled: true,
        reason: 'sync-mode',
      });
    });
  });

  // =========================================================================
  // cancelOperation / retryOperation (throw in sync mode)
  // =========================================================================
  describe('cancelOperation', () => {
    test('should throw descriptive error', () => {
      expect(() => operationWorker.cancelOperation('any-id')).toThrow(
        'Operations not available in sync mode'
      );
    });
  });

  describe('retryOperation', () => {
    test('should throw descriptive error', () => {
      expect(() => operationWorker.retryOperation('any-id')).toThrow(
        'Operations not available in sync mode'
      );
    });
  });
});
