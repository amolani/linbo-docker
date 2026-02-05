/**
 * LINBO Docker - Remote Command Service
 * Ersetzt linbo-remote für Docker-Umgebung
 *
 * Funktionen:
 * - Direkte Befehle via SSH an LINBO-Clients
 * - Onboot-Commands (.cmd Dateien) für verzögerte Ausführung
 * - Gruppen-/Raum-basierte Massenoperationen
 */

const path = require('path');
const fs = require('fs').promises;
const { prisma } = require('../lib/prisma');
const sshService = require('./ssh.service');
const wolService = require('./wol.service');
const hostService = require('./host.service');
const ws = require('../lib/websocket');

// Konfiguration
const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const LINBOCMD_DIR = path.join(LINBO_DIR, 'linbocmd');

// Bekannte LINBO-Befehle
const KNOWN_COMMANDS = [
  'label',
  'partition',
  'format',
  'initcache',
  'new',
  'sync',
  'postsync',
  'start',
  'prestart',
  'create_image',
  'create_qdiff',
  'upload_image',
  'upload_qdiff',
  'reboot',
  'halt',
];

// Download-Typen für initcache
const DOWNLOAD_TYPES = ['multicast', 'rsync', 'torrent'];

// Spezielle Flags
const SPECIAL_FLAGS = ['noauto', 'disablegui'];

/**
 * Parst einen Command-String in einzelne Befehle
 * @param {string} commandString - z.B. "sync:1,start:1" oder "initcache:rsync,reboot"
 * @returns {Array<{command: string, params: Array}>}
 */
function parseCommands(commandString) {
  if (!commandString || typeof commandString !== 'string') {
    throw new Error('Invalid command string');
  }

  const commands = [];
  let remaining = commandString.trim();

  while (remaining.length > 0) {
    // Extrahiere Befehl (bis zum ersten : oder ,)
    const colonIdx = remaining.indexOf(':');
    const commaIdx = remaining.indexOf(',');

    let cmdEnd;
    if (colonIdx === -1 && commaIdx === -1) {
      cmdEnd = remaining.length;
    } else if (colonIdx === -1) {
      cmdEnd = commaIdx;
    } else if (commaIdx === -1) {
      cmdEnd = colonIdx;
    } else {
      cmdEnd = Math.min(colonIdx, commaIdx);
    }

    const cmd = remaining.substring(0, cmdEnd).toLowerCase();
    remaining = remaining.substring(cmdEnd);

    // Prüfe ob bekannter Befehl oder Flag
    const isKnownCommand = KNOWN_COMMANDS.includes(cmd);
    const isSpecialFlag = SPECIAL_FLAGS.includes(cmd);

    if (!isKnownCommand && !isSpecialFlag) {
      throw new Error(`Unknown command: ${cmd}`);
    }

    const parsedCmd = { command: cmd, params: [] };

    // Parameter extrahieren wenn vorhanden
    if (remaining.startsWith(':')) {
      remaining = remaining.substring(1); // ':' entfernen

      // Parameter bis zum nächsten Komma oder Ende
      let paramEnd = remaining.indexOf(',');
      if (paramEnd === -1) paramEnd = remaining.length;

      // Prüfe ob nächster Befehl kommt
      for (const knownCmd of [...KNOWN_COMMANDS, ...SPECIAL_FLAGS]) {
        const cmdIdx = remaining.indexOf(knownCmd);
        if (cmdIdx !== -1 && cmdIdx < paramEnd) {
          // Finde das Komma vor diesem Befehl
          const commaBeforeCmd = remaining.lastIndexOf(',', cmdIdx);
          if (commaBeforeCmd !== -1) {
            paramEnd = commaBeforeCmd;
          }
        }
      }

      const param = remaining.substring(0, paramEnd);
      remaining = remaining.substring(paramEnd);

      // Parameter validieren je nach Befehl
      switch (cmd) {
        case 'format':
          // format oder format:nr
          if (param) {
            const nr = parseInt(param, 10);
            if (isNaN(nr) || nr < 1) {
              throw new Error(`Invalid partition number for format: ${param}`);
            }
            parsedCmd.params.push(nr);
          }
          break;

        case 'new':
        case 'sync':
        case 'postsync':
        case 'start':
        case 'prestart':
        case 'upload_image':
        case 'upload_qdiff':
          // Benötigt OS-Nummer
          const osNr = parseInt(param, 10);
          if (isNaN(osNr) || osNr < 1) {
            throw new Error(`Invalid OS number for ${cmd}: ${param}`);
          }
          parsedCmd.params.push(osNr);
          break;

        case 'initcache':
          // Optional: Download-Typ
          if (param && !DOWNLOAD_TYPES.includes(param.toLowerCase())) {
            throw new Error(`Invalid download type for initcache: ${param}`);
          }
          if (param) parsedCmd.params.push(param.toLowerCase());
          break;

        case 'create_image':
        case 'create_qdiff':
          // OS-Nummer und optionaler Kommentar
          // Format: create_image:1:"Mein Kommentar"
          const parts = param.split(':');
          const imageOsNr = parseInt(parts[0], 10);
          if (isNaN(imageOsNr) || imageOsNr < 1) {
            throw new Error(`Invalid OS number for ${cmd}: ${parts[0]}`);
          }
          parsedCmd.params.push(imageOsNr);
          if (parts[1]) {
            // Kommentar (Anführungszeichen entfernen)
            parsedCmd.params.push(parts[1].replace(/^["']|["']$/g, ''));
          }
          break;
      }
    }

    commands.push(parsedCmd);

    // Komma am Anfang entfernen
    if (remaining.startsWith(',')) {
      remaining = remaining.substring(1);
    }
  }

  return commands;
}

/**
 * Validiert einen Command-String
 * @param {string} commandString
 * @returns {{valid: boolean, error?: string, commands?: Array}}
 */
function validateCommandString(commandString) {
  try {
    const commands = parseCommands(commandString);
    return { valid: true, commands };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Formatiert geparste Befehle zurück zu einem String für linbo_wrapper
 * @param {Array<{command: string, params: Array}>} commands
 * @returns {string}
 */
function formatCommandsForWrapper(commands) {
  return commands
    .map(cmd => {
      if (cmd.params.length === 0) {
        return cmd.command;
      }
      // Spezialfall: create_image mit Kommentar
      if (
        (cmd.command === 'create_image' || cmd.command === 'create_qdiff') &&
        cmd.params.length > 1
      ) {
        return `${cmd.command}:${cmd.params[0]}:\\"${cmd.params[1]}\\"`;
      }
      return `${cmd.command}:${cmd.params.join(':')}`;
    })
    .join(',');
}

/**
 * Erstellt das linbocmd Verzeichnis falls nicht vorhanden
 */
async function ensureLinbocmdDir() {
  try {
    await fs.mkdir(LINBOCMD_DIR, { recursive: true });
    // Berechtigungen setzen (nobody:root, 660)
    await fs.chmod(LINBOCMD_DIR, 0o770);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Gibt den Pfad zur .cmd Datei für einen Host zurück
 * @param {string} hostname
 * @returns {string}
 */
function getOnbootCmdPath(hostname) {
  return path.join(LINBOCMD_DIR, `${hostname}.cmd`);
}

/**
 * Erstellt Onboot-Command-Dateien für die angegebenen Hosts
 * @param {string[]} hostIds - Array von Host-IDs
 * @param {string} commandString - z.B. "sync:1,start:1"
 * @param {Object} options
 * @param {boolean} options.noauto - Automatische Funktionen überspringen
 * @param {boolean} options.disablegui - GUI deaktivieren
 * @returns {Promise<{created: string[], failed: Array<{hostname: string, error: string}>}>}
 */
async function scheduleOnbootCommands(hostIds, commandString, options = {}) {
  // Validiere Commands
  const validation = validateCommandString(commandString);
  if (!validation.valid) {
    throw new Error(`Invalid command string: ${validation.error}`);
  }

  // Verzeichnis sicherstellen
  await ensureLinbocmdDir();

  // Hosts laden
  const hosts = await prisma.host.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, hostname: true, macAddress: true, ipAddress: true },
  });

  if (hosts.length === 0) {
    throw new Error('No valid hosts found');
  }

  // Command-String zusammenbauen
  let finalCommands = commandString;
  const flags = [];
  if (options.noauto) flags.push('noauto');
  if (options.disablegui) flags.push('disablegui');
  if (flags.length > 0) {
    finalCommands = `${flags.join(',')},${commandString}`;
  }

  const results = {
    created: [],
    failed: [],
  };

  // .cmd Dateien erstellen
  for (const host of hosts) {
    try {
      const cmdPath = getOnbootCmdPath(host.hostname);
      await fs.writeFile(cmdPath, finalCommands, { mode: 0o660 });
      results.created.push(host.hostname);

      // Host-Status aktualisieren
      await prisma.host.update({
        where: { id: host.id },
        data: {
          metadata: {
            scheduledCommand: finalCommands,
            scheduledAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      results.failed.push({
        hostname: host.hostname,
        error: error.message,
      });
    }
  }

  // WebSocket-Event
  ws.broadcast('onboot.scheduled', {
    commands: finalCommands,
    created: results.created,
    failed: results.failed.length,
  });

  return results;
}

/**
 * Listet alle geplanten Onboot-Commands auf
 * @returns {Promise<Array<{hostname: string, commands: string, createdAt: Date}>>}
 */
async function listScheduledCommands() {
  await ensureLinbocmdDir();

  const files = await fs.readdir(LINBOCMD_DIR);
  const cmdFiles = files.filter(f => f.endsWith('.cmd'));

  const scheduled = [];

  for (const file of cmdFiles) {
    const hostname = file.replace('.cmd', '');
    const filePath = path.join(LINBOCMD_DIR, file);

    try {
      const [content, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
      ]);

      scheduled.push({
        hostname,
        commands: content.trim(),
        createdAt: stats.mtime,
        filepath: filePath,
      });
    } catch (error) {
      // Datei wurde möglicherweise gerade gelöscht
      continue;
    }
  }

  return scheduled;
}

/**
 * Löscht einen geplanten Onboot-Command
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
async function cancelScheduledCommand(hostname) {
  const cmdPath = getOnbootCmdPath(hostname);

  try {
    await fs.unlink(cmdPath);

    // Host-Metadaten aktualisieren
    const host = await prisma.host.findFirst({
      where: { hostname },
    });

    if (host) {
      const metadata = host.metadata || {};
      delete metadata.scheduledCommand;
      delete metadata.scheduledAt;

      await prisma.host.update({
        where: { id: host.id },
        data: { metadata },
      });
    }

    ws.broadcast('onboot.cancelled', { hostname });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Führt direkte Befehle via SSH an Hosts aus
 * @param {string[]} hostIds - Array von Host-IDs
 * @param {string} commandString - z.B. "sync:1,start:1"
 * @param {Object} options
 * @param {boolean} options.wol - Wake-on-LAN vor Ausführung senden
 * @param {number} options.wolWait - Wartezeit nach WoL in Sekunden
 * @param {number} options.timeout - SSH-Timeout in ms
 * @returns {Promise<{operationId: string, results: Array}>}
 */
async function executeDirectCommands(hostIds, commandString, options = {}) {
  // Validiere Commands
  const validation = validateCommandString(commandString);
  if (!validation.valid) {
    throw new Error(`Invalid command string: ${validation.error}`);
  }

  // Hosts laden
  const hosts = await prisma.host.findMany({
    where: { id: { in: hostIds } },
    select: {
      id: true,
      hostname: true,
      macAddress: true,
      ipAddress: true,
      status: true,
    },
  });

  if (hosts.length === 0) {
    throw new Error('No valid hosts found');
  }

  // Operation erstellen
  const operation = await prisma.operation.create({
    data: {
      targetHosts: hosts.map(h => h.id),
      commands: [commandString],
      options: options,
      status: 'pending',
      sessions: {
        create: hosts.map(host => ({
          hostId: host.id,
          hostname: host.hostname,
          status: 'pending',
        })),
      },
    },
    include: {
      sessions: true,
    },
  });

  // WebSocket-Event
  ws.broadcast('operation.started', {
    operationId: operation.id,
    type: 'direct',
    commands: commandString,
    hostCount: hosts.length,
  });

  // Wake-on-LAN wenn gewünscht
  if (options.wol) {
    const wolResults = await wolService.sendWakeOnLanBulk(
      hosts.map(h => h.macAddress)
    );

    ws.broadcast('operation.wol_sent', {
      operationId: operation.id,
      successful: wolResults.successful.length,
      failed: wolResults.failed.length,
    });

    // Warten wenn gewünscht
    if (options.wolWait && options.wolWait > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, options.wolWait * 1000)
      );
    }
  }

  // Befehle für linbo_wrapper formatieren
  const wrapperCommands = formatCommandsForWrapper(validation.commands);

  // Operation als running markieren
  await prisma.operation.update({
    where: { id: operation.id },
    data: { status: 'running', startedAt: new Date() },
  });

  // SSH-Befehle parallel ausführen (mit Concurrency-Limit)
  const concurrency = parseInt(process.env.MAX_CONCURRENT_SESSIONS, 10) || 5;
  const results = [];

  for (let i = 0; i < hosts.length; i += concurrency) {
    const batch = hosts.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async host => {
        const session = operation.sessions.find(s => s.hostId === host.id);

        // Session als running markieren
        await prisma.session.update({
          where: { id: session.id },
          data: { status: 'running', startedAt: new Date() },
        });

        ws.broadcast('session.started', {
          operationId: operation.id,
          sessionId: session.id,
          hostname: host.hostname,
        });

        try {
          // Prüfen ob Host online ist
          const isOnline = await sshService.testConnection(
            host.ipAddress || host.hostname
          );

          if (!isOnline.success) {
            throw new Error('Host not online');
          }

          // Eventuell vorhandene .cmd Datei löschen
          const cmdPath = getOnbootCmdPath(host.hostname);
          try {
            await fs.unlink(cmdPath);
          } catch {
            // Ignorieren wenn nicht vorhanden
          }

          // GUI deaktivieren
          await sshService.executeCommand(
            host.ipAddress || host.hostname,
            'gui_ctl disable',
            { timeout: 5000 }
          );

          // Befehle ausführen
          const result = await sshService.executeCommand(
            host.ipAddress || host.hostname,
            `/usr/bin/linbo_wrapper ${wrapperCommands}`,
            { timeout: options.timeout || 300000 }
          );

          // GUI wieder aktivieren (außer bei start/reboot/halt)
          const hasTerminalCommand = validation.commands.some(c =>
            ['start', 'reboot', 'halt'].includes(c.command)
          );

          if (!hasTerminalCommand) {
            await sshService
              .executeCommand(
                host.ipAddress || host.hostname,
                'gui_ctl restore',
                { timeout: 5000 }
              )
              .catch(() => {});
          }

          // Session als completed markieren
          await prisma.session.update({
            where: { id: session.id },
            data: {
              status: result.code === 0 ? 'completed' : 'failed',
              completedAt: new Date(),
              progress: 100,
            },
          });

          // Host-Status aktualisieren
          await hostService.updateHostStatus(host.id, 'online', {
            lastCommand: commandString,
            lastCommandAt: new Date(),
          });

          ws.broadcast('session.completed', {
            operationId: operation.id,
            sessionId: session.id,
            hostname: host.hostname,
            success: result.code === 0,
          });

          return {
            hostname: host.hostname,
            success: result.code === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
          };
        } catch (error) {
          // Session als failed markieren
          await prisma.session.update({
            where: { id: session.id },
            data: {
              status: 'failed',
              completedAt: new Date(),
            },
          });

          ws.broadcast('session.failed', {
            operationId: operation.id,
            sessionId: session.id,
            hostname: host.hostname,
            error: error.message,
          });

          return {
            hostname: host.hostname,
            success: false,
            error: error.message,
          };
        }
      })
    );

    results.push(
      ...batchResults.map((r, idx) => {
        if (r.status === 'fulfilled') {
          return r.value;
        }
        return {
          hostname: batch[idx].hostname,
          success: false,
          error: r.reason?.message || 'Unknown error',
        };
      })
    );

    // Fortschritt aktualisieren
    const progress = Math.round(
      ((i + batch.length) / hosts.length) * 100
    );
    await prisma.operation.update({
      where: { id: operation.id },
      data: { progress },
    });

    ws.broadcast('operation.progress', {
      operationId: operation.id,
      progress,
      completed: i + batch.length,
      total: hosts.length,
    });
  }

  // Operation abschließen
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  const finalStatus =
    failCount === 0
      ? 'completed'
      : successCount === 0
        ? 'failed'
        : 'completed_with_errors';

  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      progress: 100,
      stats: {
        total: hosts.length,
        successful: successCount,
        failed: failCount,
      },
    },
  });

  ws.broadcast('operation.completed', {
    operationId: operation.id,
    status: finalStatus,
    stats: {
      total: hosts.length,
      successful: successCount,
      failed: failCount,
    },
  });

  return {
    operationId: operation.id,
    status: finalStatus,
    results,
  };
}

/**
 * Holt Hosts nach Filter (Raum, Gruppe, oder IDs)
 * @param {Object} filter
 * @param {string[]} filter.hostIds - Direkte Host-IDs
 * @param {string} filter.roomId - Raum-ID
 * @param {string} filter.groupId - Gruppen-ID
 * @returns {Promise<Array>}
 */
async function getHostsByFilter(filter) {
  const where = {};

  if (filter.hostIds && filter.hostIds.length > 0) {
    where.id = { in: filter.hostIds };
  } else if (filter.roomId) {
    where.roomId = filter.roomId;
  } else if (filter.groupId) {
    where.groupId = filter.groupId;
  } else {
    throw new Error('No filter specified');
  }

  return prisma.host.findMany({
    where,
    select: {
      id: true,
      hostname: true,
      macAddress: true,
      ipAddress: true,
      status: true,
    },
  });
}

/**
 * Kombinierte Funktion für Wake-on-LAN mit optionalem Command
 * @param {Object} filter - Host-Filter
 * @param {Object} options
 * @param {number} options.wait - Wartezeit in Sekunden
 * @param {string} options.commands - Optional: Befehle nach WoL
 * @param {boolean} options.onboot - Befehle als Onboot-Commands
 */
async function wakeAndExecute(filter, options = {}) {
  const hosts = await getHostsByFilter(filter);

  if (hosts.length === 0) {
    throw new Error('No hosts found matching filter');
  }

  // WoL senden
  const wolResults = await wolService.sendWakeOnLanBulk(
    hosts.map(h => h.macAddress)
  );

  ws.broadcast('wol.sent', {
    total: hosts.length,
    successful: wolResults.successful.length,
    failed: wolResults.failed.length,
  });

  // Wenn Befehle angegeben und Onboot-Modus
  if (options.commands && options.onboot) {
    await scheduleOnbootCommands(
      hosts.map(h => h.id),
      options.commands,
      { noauto: options.noauto, disablegui: options.disablegui }
    );
  }

  // Wenn Befehle angegeben und Direkt-Modus
  if (options.commands && !options.onboot && options.wait) {
    // Warten
    await new Promise(resolve => setTimeout(resolve, options.wait * 1000));

    // Direkte Ausführung
    return executeDirectCommands(
      hosts.map(h => h.id),
      options.commands,
      { timeout: options.timeout }
    );
  }

  return {
    wolResults,
    hostCount: hosts.length,
  };
}

module.exports = {
  // Command-Parsing
  parseCommands,
  validateCommandString,
  formatCommandsForWrapper,

  // Onboot-Commands
  scheduleOnbootCommands,
  listScheduledCommands,
  cancelScheduledCommand,
  getOnbootCmdPath,

  // Direct Commands
  executeDirectCommands,

  // Utilities
  getHostsByFilter,
  wakeAndExecute,

  // Constants
  KNOWN_COMMANDS,
  DOWNLOAD_TYPES,
  SPECIAL_FLAGS,
};
