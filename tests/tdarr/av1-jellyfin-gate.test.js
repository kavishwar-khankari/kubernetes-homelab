'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tdarr-gate-'));
const mediaRoot = path.join(fixture, 'media');
const mediaDir = path.join(mediaRoot, 'series', 'anime', 'Show');
const ffprobePath = path.join(fixture, 'ffprobe');
fs.mkdirSync(mediaDir, { recursive: true });

fs.writeFileSync(ffprobePath, `#!/bin/sh
file=
for arg in "$@"; do file=$arg; done
case "$file" in
  *cover-art*) printf '%s\n' '{"streams":[{"codec_type":"video","codec_name":"av1"},{"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}}]}' ;;
  *two-streams*) printf '%s\n' '{"streams":[{"codec_type":"video","codec_name":"av1"},{"codec_type":"video","codec_name":"h264"}]}' ;;
  *stale-metadata*) printf '%s\n' '{"streams":[{"codec_type":"video","codec_name":"h264"}]}' ;;
  *bad-json*) printf '%s\n' 'not-json' ;;
  *timeout*) sleep 1 ;;
  *hevc*) printf '%s\n' '{"streams":[{"codec_type":"video","codec_name":"hevc"}]}' ;;
  *no-video*) printf '%s\n' '{"streams":[{"codec_type":"audio","codec_name":"aac"}]}' ;;
  *) printf '%s\n' '{"streams":[{"codec_type":"video","codec_name":"av1"}]}' ;;
esac
`);
fs.chmodSync(ffprobePath, 0o755);

process.env.TDARR_GATE_MEDIA_ROOT = mediaRoot;
process.env.TDARR_GATE_FFPROBE = ffprobePath;
process.env.TDARR_GATE_PROBE_TIMEOUT_MS = '100';
const plugin = require('../../manifests/tdarr/plugin-source/video/av1JellyfinGate/1.0.0/index.js');

function mediaFile(name) {
  const file = path.join(mediaDir, name);
  fs.writeFileSync(file, 'fixture');
  return file;
}

function writeMarker(rules) {
  fs.writeFileSync(
    path.join(mediaDir, '.ignore'),
    `# tdarr-av1-jellyfin-gate/v1\n${rules.join('\n')}\n`
  );
}

async function run(file, metadataCodec = 'h264', originalFile = file) {
  const logs = [];
  return plugin.plugin({
    inputFileObj: {
      _id: file,
      ffProbeData: { streams: [{ codec_type: 'video', codec_name: metadataCodec }] },
    },
    originalLibraryFile: { _id: originalFile },
    variables: {},
    jobLog: (message) => logs.push(message),
  });
}

async function main() {
  const coverArtFile = mediaFile('cover-art.mkv');
  const coverArtStatBefore = fs.statSync(coverArtFile);
  writeMarker(['cover-art.*']);
  let result = await run(coverArtFile);
  assert.equal(result.outputNumber, 1);
  assert.equal(fs.existsSync(path.join(mediaDir, '.ignore')), false);
  const coverArtStatAfter = fs.statSync(coverArtFile);
  assert.ok(Math.abs(coverArtStatAfter.atimeMs - coverArtStatBefore.atimeMs) < 1000);
  assert.ok(Math.abs(coverArtStatAfter.mtimeMs - coverArtStatBefore.mtimeMs) < 1000);

  const twoStreamFile = mediaFile('two-streams.mkv');
  writeMarker(['two-streams.*']);
  result = await run(twoStreamFile, 'av1');
  assert.equal(result.outputNumber, 2);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /two-streams/);

  const staleMetadataFile = mediaFile('stale-metadata.mkv');
  writeMarker(['stale-metadata.*']);
  result = await run(staleMetadataFile, 'av1');
  assert.equal(result.outputNumber, 2);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /stale-metadata/);

  const badJsonFile = mediaFile('bad-json.mkv');
  writeMarker(['bad-json.*']);
  result = await run(badJsonFile);
  assert.equal(result.outputNumber, 2);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /bad-json/);

  const timeoutFile = mediaFile('timeout.mkv');
  writeMarker(['timeout.*']);
  result = await run(timeoutFile);
  assert.equal(result.outputNumber, 2);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /timeout/);

  const hevcFile = mediaFile('hevc.mkv');
  writeMarker(['hevc.*']);
  result = await run(hevcFile);
  assert.equal(result.outputNumber, 2);

  const noVideoFile = mediaFile('no-video.mkv');
  writeMarker(['no-video.*']);
  result = await run(noVideoFile);
  assert.equal(result.outputNumber, 2);

  const cacheFallbackFile = mediaFile('cache-fallback.mkv');
  writeMarker(['cache-fallback.*']);
  result = await run('/temp/tdarr-workDir-cache-fallback/cache-fallback.mkv', 'h264', cacheFallbackFile);
  assert.equal(result.outputNumber, 1);
  assert.equal(fs.existsSync(path.join(mediaDir, '.ignore')), false);

  const cacheOnlyFile = mediaFile('cache-only.mkv');
  writeMarker(['cache-only.*']);
  const markerBeforeCacheOnly = fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8');
  result = await run('/temp/tdarr-workDir-cache-only/cache-only.mkv');
  assert.equal(result.outputNumber, 2);
  assert.equal(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), markerBeforeCacheOnly);

  const multiFile = mediaFile('multi.mkv');
  writeMarker(['multi.*', 'other.*']);
  result = await run(multiFile);
  assert.equal(result.outputNumber, 1);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /other\.\*/);
  assert.doesNotMatch(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /multi\.\*/);

  const escapedFile = mediaFile('special [#]!.mkv');
  writeMarker([plugin._test.gateRule(path.basename(escapedFile))]);
  result = await run(escapedFile);
  assert.equal(result.outputNumber, 1);
  assert.equal(fs.existsSync(path.join(mediaDir, '.ignore')), false);

  const legacyFile = mediaFile('legacy.mkv');
  writeMarker(['/legacy.*', '/remaining.*']);
  result = await run(legacyFile);
  assert.equal(result.outputNumber, 1);
  const normalizedLegacyMarker = fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8');
  assert.match(normalizedLegacyMarker, /remaining\.\*/);
  assert.doesNotMatch(normalizedLegacyMarker, /\/remaining\.\*/);
  assert.doesNotMatch(normalizedLegacyMarker, /\/legacy\.\*/);

  const headerOnlyFile = mediaFile('header-only.mkv');
  fs.writeFileSync(
    path.join(mediaDir, '.ignore'),
    '# tdarr-av1-jellyfin-gate/v1\n# all media has finished processing\n\n'
  );
  result = await run(headerOnlyFile);
  assert.equal(result.outputNumber, 1);
  assert.equal(fs.existsSync(path.join(mediaDir, '.ignore')), false);

  const eventFailureFile = mediaFile('event-failure.mkv');
  writeMarker(['event-failure.*']);
  const originalUtimes = fs.utimesSync;
  fs.utimesSync = () => {
    throw new Error('fixture watcher failure');
  };
  result = await run(eventFailureFile);
  fs.utimesSync = originalUtimes;
  assert.equal(result.outputNumber, 2);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /event-failure/);

  const userMarkerFile = mediaFile('user-marker.mkv');
  fs.writeFileSync(path.join(mediaDir, '.ignore'), '# user-owned\n/user-marker.*\n');
  result = await run(userMarkerFile);
  assert.equal(result.outputNumber, 2);
  assert.equal(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), '# user-owned\n/user-marker.*\n');

  const invalidOwnedMarkerFile = mediaFile('invalid-owned-marker.mkv');
  fs.writeFileSync(path.join(mediaDir, '.ignore'), '# tdarr-av1-jellyfin-gate/v1\n/child/invalid.*\n');
  result = await run(invalidOwnedMarkerFile);
  assert.equal(result.outputNumber, 2);
  assert.match(fs.readFileSync(path.join(mediaDir, '.ignore'), 'utf8'), /child\/invalid/);

  const symlinkMarkerFile = mediaFile('symlink-marker.mkv');
  const outsideMarker = path.join(fixture, 'outside.ignore');
  fs.writeFileSync(outsideMarker, '# tdarr-av1-jellyfin-gate/v1\n/symlink-marker.*\n');
  fs.unlinkSync(path.join(mediaDir, '.ignore'));
  fs.symlinkSync(outsideMarker, path.join(mediaDir, '.ignore'));
  result = await run(symlinkMarkerFile);
  assert.equal(result.outputNumber, 2);
  assert.equal(fs.readlinkSync(path.join(mediaDir, '.ignore')), outsideMarker);
  fs.unlinkSync(path.join(mediaDir, '.ignore'));

  const historicalFile = mediaFile('historical.mkv');
  result = await run(historicalFile);
  assert.equal(result.outputNumber, 1);

  const outsideFile = path.join(fixture, 'outside.mkv');
  fs.writeFileSync(outsideFile, 'fixture');
  result = await run(outsideFile);
  assert.equal(result.outputNumber, 2);

  fs.rmSync(fixture, { recursive: true, force: true });
  process.stdout.write('tdarr gate fixture tests passed\n');
}

main().catch((error) => {
  fs.rmSync(fixture, { recursive: true, force: true });
  throw error;
});
