'use strict';

const assert = require('assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const fixture = path.join(os.tmpdir(), `tdarr-arr-rescan-${process.pid}`);
const mediaRoot = path.join(fixture, 'media');
process.env.TDARR_ARR_TDARR_ROOT = mediaRoot;
process.env.TDARR_ARR_ARR_ROOT = '/media_2';
process.env.ARR_GATE_RADARR_API_KEY = 'radarr-test-key';
process.env.ARR_GATE_SONARR_API_KEY = 'sonarr-test-key';
process.env.ARR_RESCAN_TIMEOUT_MS = '200';

const plugin = require('../../manifests/tdarr/plugin-source/video/arrLibraryRescan/1.0.0/index.js');

function movieFile(name) {
  return path.posix.join(mediaRoot.replace(/\\/g, '/'), '001.MOVIES', 'Some Movie (2020)', name);
}

function fourKFile(name) {
  return path.posix.join(mediaRoot.replace(/\\/g, '/'), '4k movies', 'Big Movie (2021)', name);
}

function animeFile(name) {
  return path.posix.join(mediaRoot.replace(/\\/g, '/'), 'series', 'anime', 'Show', 'Season 01', name);
}

function webSeriesFile(name) {
  return path.posix.join(mediaRoot.replace(/\\/g, '/'), 'series', 'web series', 'Drama', 'Season 01', name);
}

async function run(file, variables, logs = []) {
  return plugin.plugin({
    inputFileObj: { _id: file },
    originalLibraryFile: { _id: file },
    variables,
    jobLog: (message) => logs.push(message),
  });
}

function startArrServer(state) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      const apiKey = request.headers['x-api-key'];
      let raw = '';
      request.on('data', (chunk) => {
        raw += chunk.toString();
      });
      request.on('end', () => {
        const entry = {
          method: request.method,
          pathname: url.pathname,
          search: url.search,
          apiKey,
          body: raw ? JSON.parse(raw) : undefined,
        };
        state.requests.push(entry);

        if (state.hang) return;

        if (state.statusCode && state.statusCode >= 400) {
          response.statusCode = state.statusCode;
          response.end('error');
          return;
        }

        if (request.method === 'GET' && url.pathname === '/api/v3/movie') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(state.movies));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/v3/series') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(state.series));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/v3/moviefile') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(state.movieFiles));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/v3/episodefile') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(state.episodeFiles));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/v3/command') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(state.commandResponse));
          return;
        }
        response.statusCode = 404;
        response.end('missing');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      process.env.RADARR_URL = `http://127.0.0.1:${port}/api/v3`;
      process.env.SONARR_URL = `http://127.0.0.1:${port}/api/v3`;
      resolve(server);
    });
  });
}

function commands(state) {
  return state.requests.filter((request) => request.method === 'POST' && request.pathname === '/api/v3/command');
}

async function main() {
  const posixMedia = mediaRoot.replace(/\\/g, '/');
  assert.deepEqual(plugin._test.buildCommand('radarr', 11), { name: 'RescanMovie', movieId: 11 });
  assert.deepEqual(plugin._test.buildCommand('sonarr', 22), { name: 'RescanSeries', seriesId: 22 });
  assert.equal(plugin._test.buildCommand('radarr', 0), null);
  assert.equal(plugin._test.buildCommand('radarr', 'nope'), null);
  assert.equal(plugin._test.buildCommand('radarr', undefined), null);

  const movie = movieFile('Some Movie (2020).mkv');
  const movieRoot = plugin._test.matchRoot(movie);
  assert.equal(movieRoot.app, 'radarr');
  assert.equal(movieRoot.rel, '001.MOVIES');
  assert.equal(plugin._test.ownerFolder(movie, movieRoot.root), `${posixMedia}/001.MOVIES/Some Movie (2020)`);
  assert.equal(
    plugin._test.toArrPath(`${posixMedia}/001.MOVIES/Some Movie (2020)`),
    '/media_2/001.MOVIES/Some Movie (2020)'
  );

  const fourK = fourKFile('Big Movie (2021).mkv');
  assert.equal(plugin._test.matchRoot(fourK).rel, '4k movies');
  assert.equal(
    plugin._test.toArrPath(plugin._test.ownerFolder(fourK, plugin._test.matchRoot(fourK).root)),
    '/media_2/4k movies/Big Movie (2021)'
  );

  const anime = animeFile('Show - S01E01.mkv');
  const animeRoot = plugin._test.matchRoot(anime);
  assert.equal(animeRoot.app, 'sonarr');
  assert.equal(animeRoot.rel, 'series/anime');
  assert.equal(plugin._test.ownerFolder(anime, animeRoot.root), `${posixMedia}/series/anime/Show`);
  assert.equal(plugin._test.toArrPath(`${posixMedia}/series/anime/Show`), '/media_2/series/anime/Show');

  const web = webSeriesFile('Drama - S01E02.mkv');
  assert.equal(plugin._test.matchRoot(web).rel, 'series/web series');
  assert.equal(
    plugin._test.toArrPath(plugin._test.ownerFolder(web, plugin._test.matchRoot(web).root)),
    '/media_2/series/web series/Drama'
  );

  assert.equal(plugin._test.matchRoot(`${posixMedia}/001.MOVIES-extra/Movie/file.mkv`), null);
  assert.equal(plugin._test.matchRoot(`${posixMedia}/series/anime extra/Show/file.mkv`), null);
  assert.equal(plugin._test.ownerFolder(`${posixMedia}/001.MOVIES/orphan.mkv`, `${posixMedia}/001.MOVIES`), null);
  assert.equal(plugin._test.shouldNotify({}), false);
  assert.equal(plugin._test.shouldNotify({ hdrType: 'sdr' }), false);
  assert.equal(plugin._test.shouldNotify({ av1GateRuleRemoved: 'false' }), false);
  assert.equal(plugin._test.shouldNotify({ av1GateRuleRemoved: 'true' }), true);
  assert.equal(plugin._test.shouldNotify({ user: { av1LibraryFileReplaced: 'true' } }), true);
  assert.equal(
    plugin._test.describeCommandStatus({ id: 9, status: 'queued' }),
    'Arr command queued id=9 status=queued'
  );
  assert.equal(
    plugin._test.describeCommandStatus({ id: 9, status: 'completed' }),
    'Arr command finished id=9 status=completed'
  );

  const historicLogs = [];
  let result = await run(movie, {}, historicLogs);
  assert.equal(result.outputNumber, 1);
  assert.match(historicLogs.join('\n'), /Historic no-op/);

  const hdrOnlyLogs = [];
  result = await run(movie, { hdrType: 'sdr' }, hdrOnlyLogs);
  assert.equal(result.outputNumber, 1);
  assert.match(hdrOnlyLogs.join('\n'), /Historic no-op/);

  const state = {
    requests: [],
    movies: [
      { id: 11, path: '/media_2/001.MOVIES/Some Movie (2020)' },
      { id: 12, path: '/media_2/001.MOVIES/Some Movie (2020) Special' },
      { id: 13, path: '/media_2/4k movies/Big Movie (2021)' },
    ],
    series: [
      { id: 22, path: '/media_2/series/anime/Show' },
      { id: 23, path: '/media_2/series/web series/Drama' },
    ],
    movieFiles: [{ path: '/media_2/001.MOVIES/Some Movie (2020)/Some Movie (2020).mkv' }],
    episodeFiles: [{ path: '/media_2/series/anime/Show/Season 01/Show - S01E01.mkv' }],
    commandResponse: { id: 99, name: 'RescanMovie', status: 'queued' },
  };
  const server = await startArrServer(state);
  try {
    const radarrLogs = [];
    result = await run(movie, { user: { av1LibraryFileReplaced: 'true' } }, radarrLogs);
    assert.equal(result.outputNumber, 1);
    assert.deepEqual(commands(state).map((request) => request.body), [
      { name: 'RescanMovie', movieId: 11 },
    ]);
    assert.equal(commands(state)[0].apiKey, 'radarr-test-key');
    assert.match(radarrLogs.join('\n'), /Arr command queued id=99 status=queued/);
    assert.doesNotMatch(radarrLogs.join('\n'), /finished/);

    state.requests = [];
    state.commandResponse = { id: 100, name: 'RescanMovie', status: 'completed' };
    const fourKLogs = [];
    result = await run(fourK, { av1GateRuleRemoved: 'true' }, fourKLogs);
    assert.equal(result.outputNumber, 1);
    assert.deepEqual(commands(state).map((request) => request.body), [
      { name: 'RescanMovie', movieId: 13 },
    ]);
    assert.match(fourKLogs.join('\n'), /Arr command finished id=100 status=completed/);

    state.requests = [];
    state.commandResponse = { id: 101, name: 'RescanSeries', status: 'started' };
    const sonarrLogs = [];
    result = await run(anime, { av1GateRuleRemoved: 'true' }, sonarrLogs);
    assert.equal(result.outputNumber, 1);
    assert.deepEqual(commands(state).map((request) => request.body), [
      { name: 'RescanSeries', seriesId: 22 },
    ]);
    assert.equal(commands(state)[0].apiKey, 'sonarr-test-key');
    assert.match(sonarrLogs.join('\n'), /Arr command queued id=101 status=started/);
    assert.equal('episodeId' in commands(state)[0].body, false);

    state.requests = [];
    result = await run(web, { user: { av1LibraryFileReplaced: 'true' } });
    assert.deepEqual(commands(state).map((request) => request.body), [
      { name: 'RescanSeries', seriesId: 23 },
    ]);

    state.requests = [];
    const prefixLogs = [];
    result = await run(
      `${posixMedia}/001.MOVIES-extra/Movie/file.mkv`,
      { av1LibraryFileReplaced: 'true' },
      prefixLogs
    );
    assert.equal(result.outputNumber, 1);
    assert.equal(commands(state).length, 0);
    assert.match(prefixLogs.join('\n'), /Unmapped library path/);

    state.movies = [{ id: 11, path: '/media_2/001.MOVIES/Some Movie (2020)' }, { id: 99, path: '/media_2/001.MOVIES/Some Movie (2020)' }];
    state.requests = [];
    const dupLogs = [];
    result = await run(movie, { av1LibraryFileReplaced: 'true' }, dupLogs);
    assert.equal(result.outputNumber, 1);
    assert.equal(commands(state).length, 0);
    assert.match(dupLogs.join('\n'), /exact owner folder match count=2/);

    state.movies = [{ id: 'nope', path: '/media_2/001.MOVIES/Some Movie (2020)' }];
    state.requests = [];
    const badIdLogs = [];
    result = await run(movie, { av1LibraryFileReplaced: 'true' }, badIdLogs);
    assert.equal(commands(state).length, 0);
    assert.match(badIdLogs.join('\n'), /id was not a scoped positive integer/);

    state.movies = [{ id: 11, path: '/media_2/001.MOVIES/Some Movie (2020)' }];
    state.statusCode = 500;
    state.requests = [];
    const errorLogs = [];
    result = await run(movie, { av1LibraryFileReplaced: 'true' }, errorLogs);
    assert.equal(result.outputNumber, 1);
    assert.equal(commands(state).length, 0);
    assert.match(errorLogs.join('\n'), /Nonfatal notify error/);

    state.statusCode = 0;
    state.hang = true;
    state.requests = [];
    const timeoutLogs = [];
    result = await run(movie, { av1LibraryFileReplaced: 'true' }, timeoutLogs);
    assert.equal(result.outputNumber, 1);
    assert.equal(commands(state).length, 0);
    assert.match(timeoutLogs.join('\n'), /timed out after 200ms/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  process.stdout.write('tdarr arr library rescan tests passed\n');
}

main().catch((error) => {
  throw error;
});
