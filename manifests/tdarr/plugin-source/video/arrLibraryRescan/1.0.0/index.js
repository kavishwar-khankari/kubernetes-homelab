'use strict';

const http = require('http');
const https = require('https');
const path = require('path').posix;
const { URL } = require('url');

const MAX_RESPONSE = 10 * 1024 * 1024;

function tdarrMediaRoot() {
  return (process.env.TDARR_ARR_TDARR_ROOT || '/media').replace(/\/$/, '');
}

function arrMediaRoot() {
  return (process.env.TDARR_ARR_ARR_ROOT || '/media_2').replace(/\/$/, '');
}

function sonarrUrl() {
  return (process.env.SONARR_URL
    || 'http://arr-stack-service.arr-stack.svc.cluster.local:8989/api/v3').replace(/\/$/, '');
}

function radarrUrl() {
  return (process.env.RADARR_URL
    || 'http://arr-stack-service.arr-stack.svc.cluster.local:7878/api/v3').replace(/\/$/, '');
}

function timeoutMs() {
  return Number(process.env.ARR_RESCAN_TIMEOUT_MS || 8000);
}

const ROOTS = [
  { rel: '001.MOVIES', app: 'radarr' },
  { rel: '4k movies', app: 'radarr' },
  { rel: 'series/anime', app: 'sonarr' },
  { rel: 'series/web series', app: 'sonarr' },
];

const details = () => ({
  name: 'Arr Library Rescan',
  description:
    'After a verified AV1 gate release, notify Radarr or Sonarr with a scoped '
    + 'RescanMovie/RescanSeries for the owner folder. Whole-series scan per episode '
    + 'is accepted. Notifications are nonfatal.',
  style: {
    borderColor: '#7ad7f0',
  },
  tags: 'video,av1,radarr,sonarr,rescan',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faSync',
  inputs: [],
  outputs: [
    {
      number: 1,
      tooltip: 'Continue. Arr notify is skipped, queued, finished, or failed nonfatally.',
    },
  ],
});

async function plugin(args) {
  const inputFileObj = (args && args.inputFileObj) || {};
  const variables = (args && args.variables) || {};

  try {
    if (!shouldNotify(variables)) {
      log(args, 'Historic no-op: library file was not replaced and no gate rule was removed.');
      return continued(args);
    }

    const libraryFile = resolveLibraryPath(args);
    if (!libraryFile) {
      log(args, 'No library path under the Tdarr media root; skipping Arr notify.');
      return continued(args);
    }

    const route = matchRoot(libraryFile);
    if (!route) {
      log(args, `Unmapped library path; skipping Arr notify: ${libraryFile}`);
      return continued(args);
    }

    const owner = ownerFolder(libraryFile, route.root);
    if (!owner) {
      log(args, `No owner folder under ${route.root}; skipping Arr notify.`);
      return continued(args);
    }

    const arrOwner = toArrPath(owner);
    const arrFile = toArrPath(libraryFile);
    if (!arrOwner || !arrFile) {
      log(args, 'Path translation to Arr media root failed; skipping Arr notify.');
      return continued(args);
    }

    const replaced = readVar(variables, 'av1LibraryFileReplaced') === 'true';
    const ruleRemoved = readVar(variables, 'av1GateRuleRemoved') === 'true';
    log(
      args,
      `Notify ${route.app} owner=${arrOwner} replaced=${replaced} ruleRemoved=${ruleRemoved}`
    );

    await notifyArr(args, route.app, arrOwner, arrFile);
    return continued(args);
  } catch (error) {
    log(args, `Nonfatal notify error: ${error.message}`);
    return {
      outputFileObj: inputFileObj,
      outputNumber: 1,
      variables,
    };
  }
}

function continued(args) {
  return {
    outputFileObj: (args && args.inputFileObj) || {},
    outputNumber: 1,
    variables: (args && args.variables) || {},
  };
}

function shouldNotify(variables) {
  return readVar(variables, 'av1LibraryFileReplaced') === 'true'
    || readVar(variables, 'av1GateRuleRemoved') === 'true';
}

function readVar(variables, name) {
  if (!variables || typeof variables !== 'object') return '';
  const user = variables.user;
  if (user && typeof user === 'object' && !Array.isArray(user)
      && user[name] !== undefined && user[name] !== null && user[name] !== '') {
    return String(user[name]);
  }
  if (variables[name] === undefined || variables[name] === null) return '';
  return String(variables[name]);
}

function resolveLibraryPath(args) {
  const candidates = [
    args && args.inputFileObj && args.inputFileObj._id,
    args && args.originalLibraryFile && args.originalLibraryFile._id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeTdarrPath(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeTdarrPath(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) {
    return null;
  }
  if (!candidate.startsWith('/') || candidate.split('/').includes('..')) {
    return null;
  }
  const normalized = path.normalize(candidate);
  const mediaRoot = tdarrMediaRoot();
  if (normalized === mediaRoot || !normalized.startsWith(`${mediaRoot}/`)) {
    return null;
  }
  if (normalized.split('/').includes('tdarr-workDir') || normalized.split('/').includes('temp')) {
    return null;
  }
  return normalized;
}

function matchRoot(filePath) {
  const matches = [];
  for (const spec of ROOTS) {
    const root = path.posix.join(tdarrMediaRoot(), spec.rel);
    if (filePath === root || filePath.startsWith(`${root}/`)) {
      matches.push({ root, app: spec.app, rel: spec.rel });
    }
  }
  matches.sort((left, right) => right.root.length - left.root.length);
  return matches[0] || null;
}

function ownerFolder(filePath, root) {
  if (filePath === root) return null;
  if (!filePath.startsWith(`${root}/`)) return null;
  const relative = filePath.slice(root.length + 1);
  const ownerName = relative.split('/')[0];
  if (!ownerName || relative === ownerName) return null;
  return `${root}/${ownerName}`;
}

function toArrPath(tdarrPath) {
  const fromRoot = tdarrMediaRoot();
  const toRoot = arrMediaRoot();
  if (tdarrPath === fromRoot) return toRoot;
  if (tdarrPath.startsWith(`${fromRoot}/`)) {
    return toRoot + tdarrPath.slice(fromRoot.length);
  }
  return null;
}

function normalizeFolder(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath) return '';
  const normalized = path.normalize(folderPath);
  if (normalized !== '/' && normalized.endsWith('/')) return normalized.slice(0, -1);
  return normalized;
}

function scopedId(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function buildCommand(app, id) {
  const scoped = scopedId(id);
  if (!scoped) return null;
  if (app === 'radarr') return { name: 'RescanMovie', movieId: scoped };
  if (app === 'sonarr') return { name: 'RescanSeries', seriesId: scoped };
  return null;
}

function describeCommandStatus(payload) {
  const id = payload && payload.id;
  const status = String((payload && payload.status) || '').toLowerCase();
  const idPart = id == null ? 'id=unknown' : `id=${id}`;
  if (status === 'completed') {
    return `Arr command finished ${idPart} status=${payload.status}`;
  }
  if (status === 'failed' || status === 'aborted') {
    return `Arr command ended ${idPart} status=${payload.status}`;
  }
  return `Arr command queued ${idPart} status=${(payload && payload.status) || 'queued'}`;
}

async function notifyArr(args, app, arrOwner, arrFile) {
  const baseUrl = app === 'radarr' ? radarrUrl() : sonarrUrl();
  const apiKey = app === 'radarr'
    ? (process.env.ARR_GATE_RADARR_API_KEY || '')
    : (process.env.ARR_GATE_SONARR_API_KEY || '');
  if (!apiKey) {
    log(args, `${app} API key is missing; skipping Arr notify.`);
    return;
  }

  const listPath = app === 'radarr' ? '/movie' : '/series';
  const items = await requestJson({
    method: 'GET',
    url: `${baseUrl}${listPath}`,
    apiKey,
    timeoutMs: timeoutMs(),
  });
  if (!Array.isArray(items)) {
    log(args, `${app} owner lookup returned a non-list; skipping command.`);
    return;
  }

  const wanted = normalizeFolder(arrOwner);
  const matches = items.filter((item) => item && normalizeFolder(item.path) === wanted);
  if (matches.length !== 1) {
    log(args, `${app} exact owner folder match count=${matches.length} for ${arrOwner}; skipping command.`);
    return;
  }

  const owner = matches[0];
  const command = buildCommand(app, owner.id);
  if (!command) {
    log(args, `${app} owner folder matched but id was not a scoped positive integer; skipping command.`);
    return;
  }

  await validateFileNonblocking(args, app, baseUrl, apiKey, command, arrFile);

  const payload = await requestJson({
    method: 'POST',
    url: `${baseUrl}/command`,
    apiKey,
    body: command,
    timeoutMs: timeoutMs(),
  });
  log(args, describeCommandStatus(payload && typeof payload === 'object' ? payload : {}));
}

async function validateFileNonblocking(args, app, baseUrl, apiKey, command, arrFile) {
  try {
    const filesPath = app === 'radarr'
      ? `/moviefile?movieId=${command.movieId}`
      : `/episodefile?seriesId=${command.seriesId}`;
    const files = await requestJson({
      method: 'GET',
      url: `${baseUrl}${filesPath}`,
      apiKey,
      timeoutMs: timeoutMs(),
    });
    const wanted = normalizeFolder(arrFile);
    const listed = Array.isArray(files)
      && files.some((file) => file && normalizeFolder(file.path) === wanted);
    if (listed) {
      log(args, `Arr file list contains ${arrFile}.`);
    } else {
      log(args, `Arr file list does not yet contain ${arrFile}; still issuing scoped rescan.`);
    }
  } catch (error) {
    log(args, `Arr file validation skipped: ${error.message}`);
  }
}

function requestJson(options) {
  return requestJsonImpl(options);
}

function defaultRequestJson({ method, url, apiKey, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const request = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      agent: false,
      headers: {
        Accept: 'application/json',
        'X-Api-Key': apiKey,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        } : {}),
      },
    }, (response) => {
      let raw = '';
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      response.on('data', (chunk) => {
        raw += chunk.toString();
        if (raw.length > MAX_RESPONSE) {
          request.destroy();
          finish(new Error('Arr response exceeded the safety limit.'));
        }
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish(new Error(`Arr API ${method} ${parsed.pathname} returned HTTP ${response.statusCode}`));
          return;
        }
        if (!raw) {
          finish(null, null);
          return;
        }
        try {
          finish(null, JSON.parse(raw));
        } catch (error) {
          finish(new Error(`Arr API returned invalid JSON: ${error.message}`));
        }
      });
      response.on('error', finish);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

let requestJsonImpl = defaultRequestJson;

function log(args, message) {
  if (args && typeof args.jobLog === 'function') args.jobLog(`Arr library rescan: ${message}`);
}

module.exports.details = details;
module.exports.plugin = plugin;
module.exports._test = {
  shouldNotify,
  readVar,
  matchRoot,
  ownerFolder,
  toArrPath,
  normalizeTdarrPath,
  buildCommand,
  describeCommandStatus,
  setRequestJson(fn) {
    requestJsonImpl = fn || defaultRequestJson;
  },
};
