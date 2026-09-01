'use strict';

const fs = require('fs');
const path = require('path').posix;
const { spawn } = require('child_process');

const MAGIC = '# tdarr-av1-jellyfin-gate/v1';
const LOCK_NAME = '.tdarr-av1-jellyfin-gate.lock';
const MEDIA_ROOT = process.env.TDARR_GATE_MEDIA_ROOT || '/media';
const FFPROBE_PATH = process.env.TDARR_GATE_FFPROBE || '/usr/local/bin/ffprobe';
const LOCK_TIMEOUT_MS = 60 * 1000;
const LOCK_RETRY_MS = 1000;
const PROBE_TIMEOUT_MS = Number(process.env.TDARR_GATE_PROBE_TIMEOUT_MS || 60 * 1000);
const MAX_PROBE_OUTPUT = 10 * 1024 * 1024;
const sleepBuffer = new SharedArrayBuffer(4);
const sleepView = new Int32Array(sleepBuffer);

const details = () => ({
  name: 'AV1 Jellyfin Gate',
  description:
    'Verifies the final library file is AV1, removes only the owned Jellyfin gate rule, '
    + 'and emits a filesystem event for the normal Jellyfin watcher.',
  style: {
    borderColor: '#6efefc',
  },
  tags: 'video,av1,jellyfin,gate',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faUnlock',
  inputs: [],
  outputs: [
    {
      number: 1,
      tooltip: 'Released: final file is verified AV1 and the owned gate is cleared.',
    },
    {
      number: 2,
      tooltip: 'Held: proof, path, marker, lock, or watcher-event handling failed.',
    },
  ],
});

async function plugin(args) {
  const inputFileObj = (args && args.inputFileObj) || {};

  try {
    const finalFile = resolveFinalFile(args);
    if (!finalFile) {
      return held(args, 'No regular final library file under /media was found.');
    }

    const probe = await probeFile(finalFile);
    const videoStreams = (probe.streams || []).filter(isRealVideoStream);
    if (!videoStreams.length) {
      return held(args, 'Independent ffprobe found no real video stream.');
    }

    if (videoStreams.some((stream) => String(stream.codec_name || '').toLowerCase() !== 'av1')) {
      return held(args, 'Independent ffprobe found a real video stream that is not AV1.');
    }

    const parent = path.dirname(finalFile);
    const marker = path.join(parent, '.ignore');
    const lock = acquireLock(parent);
    let previousContent = null;
    let markerChanged = false;
    let result = null;

    try {
      const markerState = readMarker(marker);
      if (!markerState.exists) {
        log(args, 'Verified AV1 historical file has no gate marker; leaving filesystem unchanged.');
        result = released(args);
      } else {
        previousContent = markerState.content;
        const expectedRules = new Set(ruleCandidates(finalFile, args));
        const matchingRules = new Set(
          markerState.rules.filter((rule) => expectedRules.has(rule))
        );

        if (markerState.rules.length && !matchingRules.size) {
          result = held(args, 'Owned marker has no rule matching the final file stem.');
        } else {
          const remainingLines = markerState.lines
            .filter((line) => !matchingRules.has(line))
            .map(canonicalGateRule);
          const remainingRules = remainingLines.filter(isGateRule);

          if (!remainingRules.length) {
            fs.unlinkSync(marker);
          } else {
            writeAtomically(marker, remainingLines.join('\n'));
          }
          markerChanged = true;

          try {
            touchAndRestore(finalFile);
          } catch (error) {
            log(args, `Watcher event failed; restoring gate marker: ${error.message}`);
            restoreMarker(marker, previousContent);
            markerChanged = false;
            result = held(args, 'Filesystem event or timestamp restoration failed.');
          }

          if (!result) {
            log(args, `Released verified AV1 file: ${finalFile}`);
            result = released(args);
          }
        }
      }
    } catch (error) {
      if (markerChanged && previousContent !== null) {
        try {
          restoreMarker(marker, previousContent);
        } catch (restoreError) {
          log(args, `Gate restoration failed: ${restoreError.message}`);
        }
      }
      result = held(args, error.message);
    } finally {
      try {
        releaseLock(lock);
      } catch (error) {
        if (markerChanged && previousContent !== null) {
          try {
            restoreMarker(marker, previousContent);
          } catch (restoreError) {
            log(args, `Lock-release restoration failed: ${restoreError.message}`);
          }
        }
        log(args, `Gate lock cleanup failed: ${error.message}`);
        result = held(args, 'Gate lock cleanup failed.');
      }
    }

    return result || held(args, 'Gate did not produce a release result.');
  } catch (error) {
    log(args, `Gate held: ${error.message}`);
    return held(args, error.message);
  }
}

function resolveFinalFile(args) {
  const inputId = args && args.inputFileObj && args.inputFileObj._id;
  const originalId = args && args.originalLibraryFile && args.originalLibraryFile._id;

  for (const candidate of [inputId, originalId]) {
    const normalized = normalizeMediaPath(candidate);
    if (!normalized) continue;

    try {
      assertNoSymlinkComponents(normalized);
      const stat = fs.lstatSync(normalized);
      if (stat.isFile()) return normalized;
    } catch (error) {
      // A cache path, missing replacement, or unsafe candidate is not usable.
    }
  }

  return null;
}

function normalizeMediaPath(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) {
    return null;
  }

  if (!candidate.startsWith('/') || candidate.split('/').includes('..')) {
    return null;
  }

  const normalized = path.normalize(candidate);
  const root = path.normalize(MEDIA_ROOT).replace(/\/$/, '');
  if (normalized === root || !normalized.startsWith(`${root}/`)) {
    return null;
  }

  if (normalized.split('/').includes('tdarr-workDir')
      || normalized.split('/').includes('temp')) {
    return null;
  }

  return normalized;
}

function assertNoSymlinkComponents(filePath) {
  const root = path.normalize(MEDIA_ROOT).replace(/\/$/, '');
  const relative = path.relative(root, filePath);
  let current = root;

  for (const component of relative.split('/')) {
    if (!component) continue;
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink path component rejected: ${current}`);
    }
  }
}

function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };

    const collect = (chunk, target) => {
      const text = chunk.toString();
      if (target === 'stdout') stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > MAX_PROBE_OUTPUT) {
        child.kill('SIGKILL');
        finish(new Error('ffprobe output exceeded the safety limit.'));
      }
    };

    child.stdout.on('data', (chunk) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => collect(chunk, 'stderr'));
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`ffprobe failed with exit code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        finish(null, JSON.parse(stdout));
      } catch (error) {
        finish(new Error(`ffprobe returned invalid JSON: ${error.message}`));
      }
    });

    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('ffprobe timed out.'));
    }, PROBE_TIMEOUT_MS);
  });
}

function isRealVideoStream(stream) {
  return stream && stream.codec_type === 'video'
    && !(stream.disposition && Number(stream.disposition.attached_pic) === 1);
}

function ruleCandidates(finalFile, args) {
  const names = [
    path.basename(finalFile),
    args && args.inputFileObj && path.basename(String(args.inputFileObj._id || '')),
    args && args.originalLibraryFile && path.basename(String(args.originalLibraryFile._id || '')),
  ];
  const rules = [];

  for (const name of names) {
    if (!name) continue;
    try {
      const rule = gateRule(name);
      const candidates = [rule, `/${rule}`];
      for (const candidate of candidates) {
        if (!rules.includes(candidate)) rules.push(candidate);
      }
    } catch (error) {
      // An unsafe cache basename must not prevent a valid final basename candidate.
    }
  }

  return rules;
}

function gateRule(filename) {
  const basename = path.basename(filename);
  const extension = path.extname(basename);
  const stem = extension ? basename.slice(0, -extension.length) : basename;

  if (!stem || stem.includes('\0') || stem.includes('/') || stem.includes('\n')
      || stem.includes('\r') || /\s$/.test(stem)) {
    throw new Error('Unsafe media filename stem.');
  }

  let escaped = '';
  for (const character of stem) {
    if ('\\*?[]!#'.includes(character)) escaped += `\\${character}`;
    else escaped += character;
  }

  return `${escaped}.*`;
}

function readMarker(marker) {
  let stat;
  try {
    stat = fs.lstatSync(marker);
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Gate marker is not a regular file.');
  }

  const content = fs.readFileSync(marker, 'utf8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  if (lines[0] !== MAGIC) throw new Error('Gate marker is not owned by this gate.');

  const rules = lines.slice(1).filter(isGateRule);
  const invalid = lines.slice(1).some(
    (line) => line !== '' && !line.startsWith('#') && !isGateRule(line)
  );
  if (invalid) throw new Error('Gate marker has invalid rules.');

  return { exists: true, content, lines, rules };
}

function isGateRule(line) {
  if (typeof line !== 'string' || line.length <= 2 || !line.endsWith('.*')) {
    return false;
  }

  const encodedStem = line.startsWith('/') ? line.slice(1, -2) : line.slice(0, -2);
  if (!encodedStem || /\s$/.test(encodedStem)) return false;

  let escaped = false;
  for (const character of encodedStem) {
    if (escaped) {
      if (!'\\*?[]!#'.includes(character)) return false;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if ('/*?[]!#'.includes(character)) {
      return false;
    }
  }

  return !escaped;
}

function canonicalGateRule(line) {
  return isGateRule(line) && line.startsWith('/') ? line.slice(1) : line;
}

function acquireLock(parent) {
  const lock = path.join(parent, LOCK_NAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      fs.mkdirSync(lock);
      return lock;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      let stat;
      try {
        stat = fs.lstatSync(lock);
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Gate lock path is not a regular directory.');
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for gate lock.');
      Atomics.wait(sleepView, 0, 0, LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lock) {
  fs.rmdirSync(lock);
}

function writeAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.tdarr-gate.${process.pid}.${Date.now()}.tmp`
  );
  let descriptor;

  try {
    descriptor = fs.openSync(temporary, 'wx', 0o644);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(temporary, 0o644);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        // Preserve the original write error; the stale temp is observable for cleanup.
      }
    }
    throw error;
  }
}

function restoreMarker(marker, content) {
  writeAtomically(marker, content);
}

function touchAndRestore(filePath) {
  const stat = fs.statSync(filePath);
  fs.utimesSync(filePath, new Date(), new Date());
  fs.utimesSync(filePath, stat.atime, stat.mtime);
}

function log(args, message) {
  if (args && typeof args.jobLog === 'function') args.jobLog(`AV1 Jellyfin Gate: ${message}`);
}

function released(args) {
  const inputFileObj = (args && args.inputFileObj) || {};
  return {
    outputFileObj: inputFileObj,
    outputNumber: 1,
    variables: args && args.variables,
  };
}

function held(args, reason) {
  log(args, `Held: ${reason}`);
  const inputFileObj = (args && args.inputFileObj) || {};
  return {
    outputFileObj: inputFileObj,
    outputNumber: 2,
    variables: args && args.variables,
  };
}

module.exports.details = details;
module.exports.plugin = plugin;

// Exported only for the fixture harness; Tdarr uses details/plugin above.
module.exports._test = {
  gateRule,
  isRealVideoStream,
  normalizeMediaPath,
};
