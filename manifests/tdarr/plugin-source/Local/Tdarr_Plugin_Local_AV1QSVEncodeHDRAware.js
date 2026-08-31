/* eslint-disable */

/**
 * Tdarr_Plugin_Local_AV1QSVEncodeHDRAware
 *
 * AV1 QSV encode plugin that reads flow variables set by
 * Tdarr_Plugin_Local_HDRDetectAndTag and injects appropriate
 * HDR metadata flags into the ffmpeg command.
 *
 * Inputs (from Tdarr UI):
 *   - quality:        global_quality value (e.g. 22)
 *   - preset:         QSV preset (e.g. veryslow)
 *   - lookAheadDepth: look_ahead_depth value (e.g. 100)
 *   - bFrames:        bf value (e.g. 8)
 *
 * Reads flow variables:
 *   - hdrFlags: string of ffmpeg flags (set by HDRDetectAndTag)
 *
 * Use via runClassicTranscodePlugin flow node.
 *
 * v1.0.0
 */

const details = () => ({
  id: 'Tdarr_Plugin_Local_AV1QSVEncodeHDRAware',
  Stage: 'Main processing',
  Name: 'AV1 QSV Encode (HDR-Aware)',
  Type: 'Video',
  Operation: 'Transcode',
  Description:
    'Encodes video to AV1 using QSV with automatic HDR metadata injection from flow variables.',
  Version: '1.0.0',
  Tags: 'action,ffmpeg,qsv,av1,hdr',
  Inputs: [
    {
      name: 'quality',
      type: 'string',
      defaultValue: '22',
      inputUI: { type: 'text' },
      tooltip: 'global_quality value (e.g. 18, 22, 28, 32, 36)',
    },
    {
      name: 'preset',
      type: 'string',
      defaultValue: 'veryslow',
      inputUI: { type: 'text' },
      tooltip: 'QSV preset (veryslow, slower, slow, medium)',
    },
    {
      name: 'lookAheadDepth',
      type: 'string',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: 'look_ahead_depth value',
    },
    {
      name: 'bFrames',
      type: 'string',
      defaultValue: '8',
      inputUI: { type: 'text' },
      tooltip: 'bf (B-frame) count',
    },
  ],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);

  const quality = inputs.quality || '22';
  const preset = inputs.preset || 'veryslow';
  const lookAheadDepth = inputs.lookAheadDepth || '100';
  const bFrames = inputs.bFrames || '8';

  // Read HDR flags from flow variables (set by HDRDetectAndTag)
  const hdrFlags =
    (otherArguments && otherArguments.variables && otherArguments.variables.hdrFlags) || '';

  // Build the ffmpeg command
  const baseCmd = [
    '-hwaccel qsv',
    '-hwaccel_output_format qsv',
    '<io>',
    '-map 0:v:0',
    '-map 0:a',
    '-map 0:s?',
    '-map 0:t?',
    '-map_metadata 0',
    '-map_chapters 0',
    '-c:s copy',
    '-c:a copy',
    '-c:v av1_qsv',
    `-preset ${preset}`,
    `-global_quality ${quality}`,
    `-look_ahead_depth ${lookAheadDepth}`,
    '-extbrc 1',
    '-adaptive_i 1',
    '-adaptive_b 1',
    '-b_strategy 1',
    `-bf ${bFrames}`,
    '-g 300',
    '-forced_idr 1',
  ];

  // Inject HDR flags after the encoder params, before output
  if (hdrFlags) {
    baseCmd.push(hdrFlags);
  }

  const fullCmd = baseCmd.join(' ');

  const response = {
    processFile: true,
    preset: fullCmd,
    container: '.mkv',
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: `AV1 QSV Encode: Q${quality}, ${preset}, LA${lookAheadDepth}, bf${bFrames}\n`,
  };

  const hdrType =
    (otherArguments && otherArguments.variables && otherArguments.variables.hdrType) || 'unknown';
  response.infoLog += `HDR type: ${hdrType}\n`;

  if (hdrFlags) {
    response.infoLog += `HDR flags injected: ${hdrFlags}\n`;
  } else {
    response.infoLog += 'No HDR flags (SDR content).\n';
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
