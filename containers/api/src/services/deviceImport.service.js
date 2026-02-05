/**
 * LINBO Docker - Device Import Service
 * Ersetzt linuxmuster-import-devices für Docker-Umgebung
 *
 * Funktionen:
 * - CSV-Import im linuxmuster devices.csv Format
 * - Validierung mit detaillierten Fehlermeldungen
 * - Automatisches Deployment nach Import
 */

const { prisma } = require('../lib/prisma');
const configService = require('./config.service');
const grubService = require('./grub.service');
const ws = require('../lib/websocket');

/**
 * devices.csv Spalten-Mapping (linuxmuster 7.x Format)
 *
 * Spalte | Index | Beschreibung
 * -------|-------|-------------
 * room   | 0     | Raum-Name
 * host   | 1     | Hostname
 * group  | 2     | LINBO-Gruppe (Config-Name) oder "nopxe"
 * mac    | 3     | MAC-Adresse
 * ip     | 4     | IP-Adresse oder "DHCP"
 * field5 | 5     | (ungenutzt)
 * field6 | 6     | (ungenutzt)
 * field7 | 7     | DHCP-Optionen
 * field8 | 8     | (ungenutzt)
 * role   | 9     | Computer-Rolle (classroom-studentcomputer, etc.)
 * field10| 10    | (ungenutzt)
 * pxe    | 11    | PXE-Flag (0=kein PXE, 1=PXE, 2=PXE)
 */

const CSV_COLUMNS = {
  ROOM: 0,
  HOSTNAME: 1,
  GROUP: 2,
  MAC: 3,
  IP: 4,
  DHCP_OPTIONS: 7,
  ROLE: 9,
  PXE_FLAG: 11,
};

/**
 * Validiert eine MAC-Adresse
 * @param {string} mac
 * @returns {boolean}
 */
function isValidMac(mac) {
  if (!mac) return false;
  const normalized = mac.toLowerCase().replace(/-/g, ':');
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(normalized);
}

/**
 * Normalisiert eine MAC-Adresse zu lowercase mit Doppelpunkten
 * @param {string} mac
 * @returns {string}
 */
function normalizeMac(mac) {
  return mac.toLowerCase().replace(/-/g, ':');
}

/**
 * Validiert eine IP-Adresse
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIp(ip) {
  if (!ip || ip === 'DHCP') return true;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 0 && num <= 255;
  });
}

/**
 * Validiert einen Hostnamen
 * @param {string} hostname
 * @returns {boolean}
 */
function isValidHostname(hostname) {
  if (!hostname) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(hostname);
}

/**
 * Parst eine CSV-Zeile
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function parseCsvLine(line, delimiter = ';') {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parst CSV-Inhalt
 * @param {string} csvContent
 * @param {Object} options
 * @param {string} options.delimiter - Trennzeichen (default: ';')
 * @returns {Array<{lineNumber: number, fields: string[], raw: string}>}
 */
function parseCsv(csvContent, options = {}) {
  const delimiter = options.delimiter || ';';
  const lines = csvContent.split(/\r?\n/);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Leere Zeilen und Kommentare überspringen
    if (!line || line.startsWith('#')) {
      continue;
    }

    const fields = parseCsvLine(line, delimiter);
    rows.push({
      lineNumber: i + 1,
      fields,
      raw: line,
    });
  }

  return rows;
}

/**
 * Validiert eine CSV-Zeile
 * @param {Object} row - Geparste Zeile
 * @param {number} row.lineNumber
 * @param {string[]} row.fields
 * @returns {{valid: boolean, errors: string[], warnings: string[], data?: Object}}
 */
function validateCsvRow(row) {
  const { fields, lineNumber } = row;
  const errors = [];
  const warnings = [];

  // Mindestanzahl Felder prüfen
  if (fields.length < 5) {
    return {
      valid: false,
      errors: [`Line ${lineNumber}: Not enough fields (minimum 5 required)`],
      warnings: [],
    };
  }

  const room = fields[CSV_COLUMNS.ROOM];
  const hostname = fields[CSV_COLUMNS.HOSTNAME];
  const group = fields[CSV_COLUMNS.GROUP];
  const mac = fields[CSV_COLUMNS.MAC];
  const ip = fields[CSV_COLUMNS.IP];
  const dhcpOptions = fields[CSV_COLUMNS.DHCP_OPTIONS] || '';
  const role = fields[CSV_COLUMNS.ROLE] || '';
  const pxeFlag = parseInt(fields[CSV_COLUMNS.PXE_FLAG] || '1', 10);

  // Pflichtfelder validieren
  if (!room) {
    errors.push(`Line ${lineNumber}: Room is required`);
  }

  if (!hostname) {
    errors.push(`Line ${lineNumber}: Hostname is required`);
  } else if (!isValidHostname(hostname)) {
    errors.push(`Line ${lineNumber}: Invalid hostname format: ${hostname}`);
  }

  if (!group) {
    errors.push(`Line ${lineNumber}: Group is required`);
  }

  if (!mac) {
    errors.push(`Line ${lineNumber}: MAC address is required`);
  } else if (!isValidMac(mac)) {
    errors.push(`Line ${lineNumber}: Invalid MAC address format: ${mac}`);
  }

  if (ip && ip !== 'DHCP' && !isValidIp(ip)) {
    errors.push(`Line ${lineNumber}: Invalid IP address format: ${ip}`);
  }

  // Warnungen
  if (group === 'nopxe') {
    warnings.push(`Line ${lineNumber}: Host ${hostname} has no PXE group`);
  }

  if (pxeFlag === 0) {
    warnings.push(`Line ${lineNumber}: Host ${hostname} has PXE disabled`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: {
      room: room.toLowerCase(),
      hostname: hostname.toLowerCase(),
      group: group === 'nopxe' ? null : group,
      macAddress: normalizeMac(mac),
      ipAddress: ip === 'DHCP' ? null : ip,
      dhcpOptions,
      computerType: role,
      pxeFlag,
      isPxeEnabled: pxeFlag > 0 && group !== 'nopxe',
    },
  };
}

/**
 * Validiert kompletten CSV-Inhalt
 * @param {string} csvContent
 * @param {Object} options
 * @returns {{valid: boolean, rows: Array, errors: string[], warnings: string[], summary: Object}}
 */
function validateCsv(csvContent, options = {}) {
  const rows = parseCsv(csvContent, options);

  if (rows.length === 0) {
    return {
      valid: false,
      rows: [],
      errors: ['CSV file is empty or contains only comments'],
      warnings: [],
      summary: { total: 0, valid: 0, invalid: 0 },
    };
  }

  const validatedRows = [];
  const allErrors = [];
  const allWarnings = [];
  const seenMacs = new Set();
  const seenHostnames = new Set();

  for (const row of rows) {
    const result = validateCsvRow(row);

    // Duplikate prüfen
    if (result.valid) {
      if (seenMacs.has(result.data.macAddress)) {
        result.valid = false;
        result.errors.push(
          `Line ${row.lineNumber}: Duplicate MAC address: ${result.data.macAddress}`
        );
      } else {
        seenMacs.add(result.data.macAddress);
      }

      if (seenHostnames.has(result.data.hostname)) {
        result.valid = false;
        result.errors.push(
          `Line ${row.lineNumber}: Duplicate hostname: ${result.data.hostname}`
        );
      } else {
        seenHostnames.add(result.data.hostname);
      }
    }

    validatedRows.push({
      lineNumber: row.lineNumber,
      raw: row.raw,
      ...result,
    });

    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  const validCount = validatedRows.filter(r => r.valid).length;

  return {
    valid: allErrors.length === 0,
    rows: validatedRows,
    errors: allErrors,
    warnings: allWarnings,
    summary: {
      total: rows.length,
      valid: validCount,
      invalid: rows.length - validCount,
    },
  };
}

/**
 * Importiert Hosts aus CSV
 * @param {string} csvContent
 * @param {Object} options
 * @param {boolean} options.dryRun - Nur validieren, nicht importieren
 * @param {string} options.mergeStrategy - 'update' | 'skip' | 'error'
 * @param {boolean} options.createRooms - Fehlende Räume automatisch erstellen
 * @param {boolean} options.createGroups - Fehlende Gruppen automatisch erstellen
 * @param {boolean} options.deployConfigs - Nach Import Configs deployen
 * @returns {Promise<Object>}
 */
async function importFromCsv(csvContent, options = {}) {
  const {
    dryRun = false,
    mergeStrategy = 'update',
    createRooms = true,
    createGroups = true,
    deployConfigs = true,
  } = options;

  // Validierung
  const validation = validateCsv(csvContent, options);

  if (!validation.valid) {
    return {
      success: false,
      dryRun,
      validation,
      imported: { created: 0, updated: 0, skipped: 0 },
    };
  }

  if (dryRun) {
    // Zusätzliche Prüfungen für Dry-Run
    const existingMacs = await prisma.host.findMany({
      where: {
        macAddress: {
          in: validation.rows
            .filter(r => r.valid)
            .map(r => r.data.macAddress),
        },
      },
      select: { macAddress: true, hostname: true },
    });

    const existingHostnames = await prisma.host.findMany({
      where: {
        hostname: {
          in: validation.rows
            .filter(r => r.valid)
            .map(r => r.data.hostname),
        },
      },
      select: { hostname: true, macAddress: true },
    });

    return {
      success: true,
      dryRun: true,
      validation,
      preview: {
        wouldCreate: validation.rows.filter(
          r =>
            r.valid &&
            !existingMacs.find(e => e.macAddress === r.data.macAddress) &&
            !existingHostnames.find(e => e.hostname === r.data.hostname)
        ).length,
        wouldUpdate:
          mergeStrategy === 'update'
            ? existingMacs.length + existingHostnames.length
            : 0,
        wouldSkip:
          mergeStrategy === 'skip'
            ? existingMacs.length + existingHostnames.length
            : 0,
        existingConflicts:
          mergeStrategy === 'error'
            ? existingMacs.length + existingHostnames.length
            : 0,
      },
    };
  }

  // Tatsächlicher Import
  const results = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const roomsToCreate = new Set();
  const groupsToCreate = new Set();
  const hostsToProcess = [];

  // Sammle einzigartige Räume und Gruppen
  for (const row of validation.rows.filter(r => r.valid)) {
    roomsToCreate.add(row.data.room);
    if (row.data.group) {
      groupsToCreate.add(row.data.group);
    }
    hostsToProcess.push(row.data);
  }

  // Räume erstellen/laden
  const roomMap = new Map();
  if (createRooms) {
    for (const roomName of roomsToCreate) {
      try {
        let room = await prisma.room.findUnique({
          where: { name: roomName },
        });

        if (!room) {
          room = await prisma.room.create({
            data: { name: roomName },
          });
        }

        roomMap.set(roomName, room.id);
      } catch (error) {
        results.errors.push(`Failed to create room ${roomName}: ${error.message}`);
      }
    }
  } else {
    const existingRooms = await prisma.room.findMany({
      where: { name: { in: Array.from(roomsToCreate) } },
    });
    for (const room of existingRooms) {
      roomMap.set(room.name, room.id);
    }
  }

  // Gruppen erstellen/laden
  const groupMap = new Map();
  if (createGroups) {
    for (const groupName of groupsToCreate) {
      try {
        let group = await prisma.hostGroup.findUnique({
          where: { name: groupName },
        });

        if (!group) {
          group = await prisma.hostGroup.create({
            data: { name: groupName },
          });
        }

        groupMap.set(groupName, group.id);
      } catch (error) {
        results.errors.push(`Failed to create group ${groupName}: ${error.message}`);
      }
    }
  } else {
    const existingGroups = await prisma.hostGroup.findMany({
      where: { name: { in: Array.from(groupsToCreate) } },
    });
    for (const group of existingGroups) {
      groupMap.set(group.name, group.id);
    }
  }

  // Hosts importieren
  const affectedGroupIds = new Set();

  for (const hostData of hostsToProcess) {
    try {
      // Prüfen ob Host bereits existiert
      const existingByMac = await prisma.host.findUnique({
        where: { macAddress: hostData.macAddress },
      });

      const existingByHostname = await prisma.host.findUnique({
        where: { hostname: hostData.hostname },
      });

      const existing = existingByMac || existingByHostname;

      const roomId = roomMap.get(hostData.room) || null;
      const groupId = hostData.group ? groupMap.get(hostData.group) || null : null;

      if (groupId) {
        affectedGroupIds.add(groupId);
      }

      if (existing) {
        if (mergeStrategy === 'skip') {
          results.skipped++;
          continue;
        }

        if (mergeStrategy === 'error') {
          results.failed++;
          results.errors.push(
            `Host ${hostData.hostname} already exists (MAC: ${hostData.macAddress})`
          );
          continue;
        }

        // Update
        await prisma.host.update({
          where: { id: existing.id },
          data: {
            hostname: hostData.hostname,
            macAddress: hostData.macAddress,
            ipAddress: hostData.ipAddress,
            roomId,
            groupId,
            metadata: {
              ...existing.metadata,
              computerType: hostData.computerType,
              pxeFlag: hostData.pxeFlag,
              dhcpOptions: hostData.dhcpOptions,
              importedAt: new Date().toISOString(),
            },
          },
        });

        results.updated++;
      } else {
        // Create
        await prisma.host.create({
          data: {
            hostname: hostData.hostname,
            macAddress: hostData.macAddress,
            ipAddress: hostData.ipAddress,
            roomId,
            groupId,
            status: 'offline',
            metadata: {
              computerType: hostData.computerType,
              pxeFlag: hostData.pxeFlag,
              dhcpOptions: hostData.dhcpOptions,
              importedAt: new Date().toISOString(),
            },
          },
        });

        results.created++;
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Failed to import ${hostData.hostname}: ${error.message}`
      );
    }
  }

  // Nach Import: Configs deployen
  if (deployConfigs && affectedGroupIds.size > 0) {
    try {
      // Für jede betroffene Gruppe: Symlinks und GRUB-Configs aktualisieren
      const groups = await prisma.hostGroup.findMany({
        where: { id: { in: Array.from(affectedGroupIds) } },
        include: {
          defaultConfig: true,
          hosts: {
            select: { hostname: true, ipAddress: true },
          },
        },
      });

      for (const group of groups) {
        if (group.defaultConfig) {
          // Symlinks erstellen
          await configService.createHostSymlinks(group.defaultConfig.id);
        }

        // GRUB-Config für Gruppe
        await grubService.generateGroupGrubConfig(group.name).catch(() => {});

        // GRUB-Configs für Hosts
        for (const host of group.hosts) {
          await grubService
            .generateHostGrubConfig(host.hostname, group.name)
            .catch(() => {});
        }
      }

      results.configsDeployed = true;
    } catch (error) {
      results.configDeployError = error.message;
    }
  }

  // WebSocket-Event
  ws.broadcast('import.completed', {
    created: results.created,
    updated: results.updated,
    skipped: results.skipped,
    failed: results.failed,
  });

  return {
    success: results.failed === 0,
    dryRun: false,
    validation,
    imported: results,
  };
}

/**
 * Exportiert alle Hosts als CSV im linuxmuster-Format
 * @returns {Promise<string>}
 */
async function exportToCsv() {
  const hosts = await prisma.host.findMany({
    include: {
      room: { select: { name: true } },
      group: { select: { name: true } },
    },
    orderBy: [{ room: { name: 'asc' } }, { hostname: 'asc' }],
  });

  const lines = [
    '# LINBO Docker - Exported devices',
    `# Generated: ${new Date().toISOString()}`,
    '# Format: room;hostname;group;mac;ip;;;;;role;;pxe;;;;;',
    '#',
  ];

  for (const host of hosts) {
    const room = host.room?.name || 'unknown';
    const hostname = host.hostname;
    const group = host.group?.name || 'nopxe';
    const mac = host.macAddress.toUpperCase();
    const ip = host.ipAddress || 'DHCP';
    const role = host.metadata?.computerType || '';
    const pxeFlag = host.metadata?.pxeFlag ?? 1;
    const dhcpOptions = host.metadata?.dhcpOptions || '';

    // Format: room;host;group;mac;ip;;;dhcpopts;;role;;pxe;;;;;
    const fields = [
      room,
      hostname,
      group,
      mac,
      ip,
      '', // field5
      '', // field6
      dhcpOptions, // field7
      '', // field8
      role, // field9
      '', // field10
      String(pxeFlag), // field11
      '', // field12
      '', // field13
      '', // field14
      '', // field15
    ];

    lines.push(fields.join(';'));
  }

  return lines.join('\n');
}

/**
 * Synchronisiert die Datenbank mit dem Dateisystem
 * (erstellt fehlende Symlinks und GRUB-Configs)
 */
async function syncFilesystem() {
  const results = {
    symlinks: { created: 0, errors: [] },
    grubConfigs: { created: 0, errors: [] },
  };

  // Alle Gruppen mit Hosts laden
  const groups = await prisma.hostGroup.findMany({
    include: {
      defaultConfig: true,
      hosts: {
        select: { hostname: true, ipAddress: true },
      },
    },
  });

  for (const group of groups) {
    // Symlinks für Config
    if (group.defaultConfig) {
      try {
        const count = await configService.createHostSymlinks(
          group.defaultConfig.id
        );
        results.symlinks.created += count;
      } catch (error) {
        results.symlinks.errors.push({
          group: group.name,
          error: error.message,
        });
      }
    }

    // GRUB-Config für Gruppe
    try {
      await grubService.generateGroupGrubConfig(group.name);
      results.grubConfigs.created++;
    } catch (error) {
      results.grubConfigs.errors.push({
        type: 'group',
        name: group.name,
        error: error.message,
      });
    }

    // GRUB-Configs für Hosts
    for (const host of group.hosts) {
      try {
        await grubService.generateHostGrubConfig(host.hostname, group.name);
        results.grubConfigs.created++;
      } catch (error) {
        results.grubConfigs.errors.push({
          type: 'host',
          name: host.hostname,
          error: error.message,
        });
      }
    }
  }

  // Main GRUB config
  try {
    await grubService.generateMainGrubConfig();
    results.grubConfigs.created++;
  } catch (error) {
    results.grubConfigs.errors.push({
      type: 'main',
      error: error.message,
    });
  }

  return results;
}

module.exports = {
  // Parsing
  parseCsv,
  parseCsvLine,
  validateCsvRow,
  validateCsv,

  // Validation helpers
  isValidMac,
  isValidIp,
  isValidHostname,
  normalizeMac,

  // Import/Export
  importFromCsv,
  exportToCsv,

  // Sync
  syncFilesystem,

  // Constants
  CSV_COLUMNS,
};
