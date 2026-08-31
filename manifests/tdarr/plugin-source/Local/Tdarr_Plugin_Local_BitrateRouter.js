/* eslint-disable */

/**
 * Tdarr_Plugin_Local_BitrateRouter
 *
 * Codec-aware bitrate router with minimum bitrate skip floor.
 * Replaces file-size-based routing with bitrate-based routing.
 *
 * Supports two modes (set via 'mode' input):
 *
 *   "floor" — Minimum bitrate check only.
 *       output 1: bitrate is ABOVE floor → continue processing
 *       output 2: bitrate is BELOW floor → skip (too compressed)
 *       Sets flow variables: detectedCodec, videoBitrateKbps, skipBitrate, skipReason
 *
 *   "route" — Threshold-based tier routing only (no floor check).
 *       output 1: bitrate BELOW threshold → lower quality tier
 *       output 2: bitrate AT/ABOVE threshold → higher quality tier (or next router)
 *
 * Chain pattern (3 nodes replaces 2 checkFileSize nodes):
 *
 *   [Floor Check (mode=floor)]
 *       output 1 → [Router A (mode=route, low/mid split)]
 *                       output 1 → Stage 1 (low bitrate)
 *                       output 2 → [Router B (mode=route, mid/high split)]
 *                                       output 1 → Stage 2 (mid bitrate)
 *                                       output 2 → Stage 3 (high bitrate)
 *       output 2 → skiplist ("download a higher bitrate version")
 *
 * All thresholds are per-codec (h264/hevc/other) and configurable from UI.
 * Bitrate fallback: container bitrate if per-stream bitrate is unavailable.
 *
 * Use via runClassicFilterPlugin flow node.
 *
 * v1.0.0
 */

const details = () => ({
  id: 'Tdarr_Plugin_Local_BitrateRouter',
  Stage: 'Pre-processing',
  Name: 'Bitrate Router (Codec-Aware)',
  Type: 'Video',
  Operation: 'Filter',
  Description:
    'Routes files by video bitrate with codec-aware thresholds. ' +
    'Use mode=floor for minimum bitrate skip, mode=route for tier routing. ' +
    'Chain instances for multi-tier routing.',
  Version: '1.0.0',
  Tags: 'filter,pre-processing,bitrate',
  Inputs: [
    {
      name: 'mode',
      type: 'string',
      defaultValue: 'floor',
      inputUI: {
        type: 'dropdown',
        options: ['floor', 'route'],
      },
      tooltip:
        '"floor" = skip files below minimum bitrate. ' +
        '"route" = split files by bitrate threshold into two tiers.',
    },
    {
      name: 'h264MinKbps',
      type: 'string',
      defaultValue: '4000',
      inputUI: { type: 'text' },
      tooltip:
        '[floor mode] Minimum video bitrate (kbps) for H.264 sources. ' +
        'Files below this are skipped — too compressed to benefit from AV1.',
    },
    {
      name: 'hevcMinKbps',
      type: 'string',
      defaultValue: '3000',
      inputUI: { type: 'text' },
      tooltip:
        '[floor mode] Minimum video bitrate (kbps) for HEVC sources. ' +
        'Files below this are skipped — too compressed to benefit from AV1.',
    },
    {
      name: 'otherMinKbps',
      type: 'string',
      defaultValue: '3000',
      inputUI: { type: 'text' },
      tooltip:
        '[floor mode] Minimum video bitrate (kbps) for other codecs (VC-1, MPEG-2, VP9, etc).',
    },
    {
      name: 'h264ThresholdKbps',
      type: 'string',
      defaultValue: '15000',
      inputUI: { type: 'text' },
      tooltip:
        '[route mode] H.264 bitrate threshold (kbps). ' +
        'Below → output 1 (lower tier). At/above → output 2 (higher tier).',
    },
    {
      name: 'hevcThresholdKbps',
      type: 'string',
      defaultValue: '10000',
      inputUI: { type: 'text' },
      tooltip:
        '[route mode] HEVC bitrate threshold (kbps). ' +
        'Below → output 1 (lower tier). At/above → output 2 (higher tier).',
    },
    {
      name: 'otherThresholdKbps',
      type: 'string',
      defaultValue: '12000',
      inputUI: { type: 'text' },
      tooltip:
        '[route mode] Other codec bitrate threshold (kbps). ' +
        'Below → output 1 (lower tier). At/above → output 2 (higher tier).',
    },
  ],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);

  const mode = inputs.mode || 'floor';

  const response = {
    processFile: true,
    infoLog: '',
  };

  // ─── 1. Identify codec ───
  const videoStream = (file.ffProbeData.streams || []).find(
    (s) => s.codec_type === 'video'
  );

  if (!videoStream) {
    response.processFile = false;
    response.infoLog += 'No video stream found — skipping.\n';
    setVars(otherArguments, 'unknown', 0, true, 'No video stream found');
    return response;
  }

  const codecName = (videoStream.codec_name || '').toLowerCase();
  let codecGroup = 'other';
  if (codecName === 'h264' || codecName === 'avc') {
    codecGroup = 'h264';
  } else if (codecName === 'hevc' || codecName === 'h265') {
    codecGroup = 'hevc';
  }

  response.infoLog += `Codec: ${codecName} (group: ${codecGroup})\n`;

  // ─── 2. Get bitrate ───
  let bitrateKbps = 0;
  let bitrateSource = '';

  if (videoStream.bit_rate) {
    bitrateKbps = parseInt(videoStream.bit_rate, 10) / 1000;
    bitrateSource = 'stream';
  } else if (file.ffProbeData.format && file.ffProbeData.format.bit_rate) {
    // Fallback: container bitrate (overcounts — includes audio/subs)
    bitrateKbps = parseInt(file.ffProbeData.format.bit_rate, 10) / 1000;
    bitrateSource = 'container (approx)';
  }

  const bitrateRounded = Math.round(bitrateKbps);
  response.infoLog += `Video bitrate: ${bitrateRounded} kbps (source: ${bitrateSource || 'unknown'})\n`;

  // If we can't determine bitrate, proceed (route to lower tier as safe default)
  if (bitrateKbps <= 0) {
    response.processFile = true;
    response.infoLog += 'Could not determine bitrate — routing to lower tier (safe default).\n';
    setVars(otherArguments, codecGroup, 0, false, '');
    return response;
  }

  // ─── 3. Mode: floor ───
  if (mode === 'floor') {
    const floors = {
      h264: parseInt(inputs.h264MinKbps, 10) || 4000,
      hevc: parseInt(inputs.hevcMinKbps, 10) || 3000,
      other: parseInt(inputs.otherMinKbps, 10) || 3000,
    };

    const minFloor = floors[codecGroup];

    if (bitrateKbps < minFloor) {
      response.processFile = false;
      const reason =
        `Video bitrate ${bitrateRounded} kbps (${codecName}) is below ` +
        `minimum floor of ${minFloor} kbps for ${codecGroup}. ` +
        `This file is already too compressed to benefit from AV1 re-encoding. ` +
        `Download a higher bitrate version of this file.`;
      response.infoLog += `⚠ SKIP: ${reason}\n`;
      setVars(otherArguments, codecGroup, bitrateRounded, true, reason);
      return response;
    }

    response.processFile = true;
    response.infoLog += `${bitrateRounded} kbps >= ${minFloor} kbps floor (${codecGroup}) → above floor, proceed.\n`;
    setVars(otherArguments, codecGroup, bitrateRounded, false, '');
    return response;
  }

  // ─── 4. Mode: route ───
  const splits = {
    h264: parseInt(inputs.h264ThresholdKbps, 10) || 15000,
    hevc: parseInt(inputs.hevcThresholdKbps, 10) || 10000,
    other: parseInt(inputs.otherThresholdKbps, 10) || 12000,
  };

  const splitPoint = splits[codecGroup];

  if (bitrateKbps < splitPoint) {
    response.processFile = true;
    response.infoLog += `${bitrateRounded} kbps < ${splitPoint} kbps (${codecGroup}) → output 1 (lower tier)\n`;
  } else {
    response.processFile = false;
    response.infoLog += `${bitrateRounded} kbps >= ${splitPoint} kbps (${codecGroup}) → output 2 (higher tier)\n`;
  }

  // Preserve existing vars from floor check, only update if not already set
  if (otherArguments && otherArguments.variables) {
    if (!otherArguments.variables.detectedCodec) {
      otherArguments.variables.detectedCodec = codecGroup;
    }
    if (!otherArguments.variables.videoBitrateKbps) {
      otherArguments.variables.videoBitrateKbps = String(bitrateRounded);
    }
  }

  return response;
};

function setVars(otherArguments, codec, bitrateKbps, skipped, reason) {
  if (otherArguments && otherArguments.variables) {
    otherArguments.variables.detectedCodec = codec;
    otherArguments.variables.videoBitrateKbps = String(bitrateKbps);
    otherArguments.variables.skipBitrate = skipped ? 'true' : 'false';
    otherArguments.variables.skipReason = reason;
  }
}

module.exports.details = details;
module.exports.plugin = plugin;
