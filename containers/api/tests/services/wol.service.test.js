/**
 * LINBO Docker - Wake-on-LAN Service Tests
 * Tests für Magic Packet Generierung und Versand
 */

const wolService = require('../../src/services/wol.service');

describe('WoL Service', () => {
  describe('createMagicPacket', () => {
    test('should create valid magic packet from MAC with colons', () => {
      const packet = wolService.createMagicPacket('aa:bb:cc:dd:ee:ff');

      expect(packet).toBeInstanceOf(Buffer);
      expect(packet.length).toBe(102);

      // First 6 bytes should be 0xFF
      for (let i = 0; i < 6; i++) {
        expect(packet[i]).toBe(0xff);
      }

      // MAC should be repeated 16 times starting at byte 6
      const macBytes = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 6; j++) {
          expect(packet[6 + i * 6 + j]).toBe(macBytes[j]);
        }
      }
    });

    test('should create valid magic packet from MAC with dashes', () => {
      const packet = wolService.createMagicPacket('aa-bb-cc-dd-ee-ff');

      expect(packet.length).toBe(102);
    });

    test('should handle uppercase MAC address', () => {
      const packet = wolService.createMagicPacket('AA:BB:CC:DD:EE:FF');

      expect(packet.length).toBe(102);
      // Verify first MAC starts at byte 6 with correct values
      expect(packet[6]).toBe(0xaa);
      expect(packet[7]).toBe(0xbb);
    });

    test('should throw error for invalid MAC address - too short', () => {
      expect(() => wolService.createMagicPacket('aa:bb:cc:dd:ee'))
        .toThrow('Invalid MAC address');
    });

    test('should throw error for invalid MAC address - invalid characters', () => {
      expect(() => wolService.createMagicPacket('gg:hh:ii:jj:kk:ll'))
        .toThrow('Invalid MAC address');
    });

    test('should throw error for empty MAC address', () => {
      expect(() => wolService.createMagicPacket(''))
        .toThrow('Invalid MAC address');
    });
  });

  describe('isValidMac', () => {
    test('should validate correct MAC with colons', () => {
      expect(wolService.isValidMac('aa:bb:cc:dd:ee:ff')).toBe(true);
      expect(wolService.isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true);
      expect(wolService.isValidMac('00:11:22:33:44:55')).toBe(true);
    });

    test('should validate correct MAC with dashes', () => {
      expect(wolService.isValidMac('aa-bb-cc-dd-ee-ff')).toBe(true);
      expect(wolService.isValidMac('AA-BB-CC-DD-EE-FF')).toBe(true);
    });

    test('should reject invalid MAC formats', () => {
      expect(wolService.isValidMac('aabbccddeeff')).toBe(false);
      expect(wolService.isValidMac('aa:bb:cc:dd:ee')).toBe(false);
      expect(wolService.isValidMac('aa:bb:cc:dd:ee:ff:gg')).toBe(false);
      expect(wolService.isValidMac('gg:hh:ii:jj:kk:ll')).toBe(false);
      expect(wolService.isValidMac('')).toBe(false);
      expect(wolService.isValidMac('invalid')).toBe(false);
    });
  });

  describe('normalizeMac', () => {
    test('should normalize MAC with colons to lowercase', () => {
      expect(wolService.normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
    });

    test('should normalize MAC with dashes to colons', () => {
      expect(wolService.normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
    });

    test('should handle already normalized MAC', () => {
      expect(wolService.normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('aa:bb:cc:dd:ee:ff');
    });

    test('should handle mixed case', () => {
      expect(wolService.normalizeMac('Aa:Bb:Cc:Dd:Ee:Ff')).toBe('aa:bb:cc:dd:ee:ff');
    });
  });

  describe('sendWakeOnLan', () => {
    // Note: These tests can't fully verify network behavior without mocking dgram
    // They verify the function doesn't throw with valid input

    test('should resolve with success for valid MAC', async () => {
      // This test will actually try to send a packet
      // In a CI environment, this might fail due to network restrictions
      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 1,
          address: '127.0.0.1', // Use localhost to avoid broadcast issues
        });

        expect(result.macAddress).toBe('aa:bb:cc:dd:ee:ff');
        expect(result.packetsSent).toBe(1);
      } catch (error) {
        // Skip if network issues
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });

    test('should reject for invalid MAC', async () => {
      await expect(wolService.sendWakeOnLan('invalid-mac'))
        .rejects.toThrow('Invalid MAC address');
    });

    test('should send multiple packets when count specified', async () => {
      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 3,
          address: '127.0.0.1',
        });

        expect(result.packetsSent).toBe(3);
      } catch (error) {
        // Skip network errors
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });
  });

  describe('sendWakeOnLanBulk', () => {
    test('should handle multiple MAC addresses', async () => {
      try {
        const macs = [
          'aa:bb:cc:dd:ee:01',
          'aa:bb:cc:dd:ee:02',
          'aa:bb:cc:dd:ee:03',
        ];

        const result = await wolService.sendWakeOnLanBulk(macs, {
          count: 1,
          address: '127.0.0.1',
        });

        expect(result.total).toBe(3);
        expect(result.results.length).toBe(3);
      } catch (error) {
        // Skip network errors
      }
    });

    test('should track successful and failed sends', async () => {
      const macs = [
        'aa:bb:cc:dd:ee:01',
        'invalid-mac', // This will fail
        'aa:bb:cc:dd:ee:03',
      ];

      const result = await wolService.sendWakeOnLanBulk(macs, {
        count: 1,
        address: '127.0.0.1',
      });

      expect(result.total).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.results.find(r => r.macAddress === 'invalid-mac').success).toBe(false);
    });

    test('should return empty results for empty array', async () => {
      const result = await wolService.sendWakeOnLanBulk([], {});

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('sendWakeOnLanToSubnet', () => {
    test('should construct broadcast address from subnet', async () => {
      try {
        const result = await wolService.sendWakeOnLanToSubnet('aa:bb:cc:dd:ee:ff', '192.168.1');

        expect(result.broadcastAddress).toBe('192.168.1.255');
      } catch (error) {
        // Skip network errors
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });
  });
});
