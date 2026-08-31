"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

var details = function () { return ({
  name: 'AV1 SVT Encode (HDR-Aware)',
  description: 'SVT-AV1 software encode via libsvtav1. HDR-aware using hdrFlags '
    + 'flow variable from hdrDetectAndTag. Designed for quality-critical '
    + 'content where QSV quality is insufficient. '
    + 'Reads flow variables: '
    + '- hdrFlags: color signaling flags (-color_primaries, -color_trc, etc.) '
    + '- hdrType: "HDR10", "HLG", "DV", "SDR" (for logging)',
  style: {
    borderColor: '#6abb7f',
  },
  tags: 'video,ffmpeg,svt,av1,hdr,software',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'CRF',
      name: 'crf',
      type: 'string',
      defaultValue: '22',
      inputUI: { type: 'text' },
      tooltip: 'Constant Rate Factor (0-63). Lower = higher quality. 18-24 for high quality, 25-30 balanced.',
    },
    {
      label: 'Preset',
      name: 'preset',
      type: 'string',
      defaultValue: '4',
      inputUI: { type: 'text' },
      tooltip: 'SVT-AV1 preset (0-13). Lower = slower/better. 4 = high quality, 6 = balanced.',
    },
    {
      label: 'Logical Processors (threads)',
      name: 'lp',
      type: 'string',
      defaultValue: '4',
      inputUI: { type: 'text' },
      tooltip: 'Number of threads for SVT-AV1. Maps to --lp parameter.',
    },
    {
      label: 'Film Grain Synthesis',
      name: 'filmGrain',
      type: 'string',
      defaultValue: '0',
      inputUI: { type: 'text' },
      tooltip: 'Film grain synthesis level (0-50). 0 = disabled. 8-12 useful for grainy anime/film.',
    },
    {
      label: 'Film Grain Denoise',
      name: 'filmGrainDenoise',
      type: 'string',
      defaultValue: '0',
      inputUI: { type: 'text' },
      tooltip: '0 or 1. If 1, denoises source before applying grain synthesis. Only relevant if filmGrain > 0.',
    },
    {
      label: 'Keyframe Interval',
      name: 'keyint',
      type: 'string',
      defaultValue: '240',
      inputUI: { type: 'text' },
      tooltip: 'Keyframe interval in frames. 240 = ~10s at 24fps. -1 for auto.',
    },
  ],
  outputs: [
    {
      number: 1,
      tooltip: 'Encode successful',
    },
    {
      number: 2,
      tooltip: 'Encode failed',
    },
  ],
}); };
exports.details = details;

var plugin = function (args) {
  return new Promise(function (resolve, reject) {
    var crf = String(args.inputs.crf || '22');
    var preset = String(args.inputs.preset || '4');
    var lp = String(args.inputs.lp || '4');
    var filmGrain = String(args.inputs.filmGrain || '0');
    var filmGrainDenoise = String(args.inputs.filmGrainDenoise || '0');
    var keyint = String(args.inputs.keyint || '240');

    // Read HDR flags from flow variables
    var hdrFlags = (args.variables && args.variables.hdrFlags) || '';
    var hdrType = (args.variables && args.variables.hdrType) || 'unknown';

    args.jobLog('SVT-AV1 Encode: CRF ' + crf + ', preset ' + preset
      + ', threads ' + lp + ', film-grain ' + filmGrain);
    args.jobLog('HDR type: ' + hdrType);

    if (hdrFlags) {
      args.jobLog('Color signaling flags: ' + hdrFlags);
    } else {
      args.jobLog('No HDR flags (SDR content).');
    }

    // Build SVT-AV1 params string (colon-separated for -svtav1-params)
    var svtParams = 'lp=' + lp + ':pin=1'
      + ':film-grain=' + filmGrain
      + ':film-grain-denoise=' + filmGrainDenoise;

    // Build ffmpeg command parts
    // No hardware accel — this is a pure software encode
    var inputArgs = [
      '-ignore_unknown',
    ];

    var outputArgs = [
      '-map', '0:v:0',
      '-map', '0:a',
      '-map', '0:s?',
      '-map', '0:t?',
      '-map_metadata', '0',
      '-map_chapters', '0',
      '-c:s', 'copy',
      '-c:a', 'copy',
      '-c:v', 'libsvtav1',
      '-crf', crf,
      '-preset', preset,
      '-g', keyint,
      '-pix_fmt', 'p010le',
      '-threads', lp,
      '-svtav1-params', svtParams,
    ];

    // Inject color signaling flags
    if (hdrFlags) {
      var parts = hdrFlags.trim().split(/\s+/);
      outputArgs = outputArgs.concat(parts);
      args.jobLog('Color signaling args injected: ' + JSON.stringify(parts));
    }

    // Safety: max_muxing_queue_size for complex files
    outputArgs = outputArgs.concat(['-max_muxing_queue_size', '9999']);

    // Build output file path
    var container = (0, fileUtils_1.getContainer)(args.inputFileObj._id);
    var cacheFilePath = (0, fileUtils_1.getPluginWorkDir)(args)
      + '/' + (0, fileUtils_1.getFileName)(args.inputFileObj._id) + '.' + container;

    // Assemble full command
    var spawnArgs = inputArgs.concat([
      '-i', args.inputFileObj._id,
    ]).concat(outputArgs).concat([
      cacheFilePath,
    ]);

    args.jobLog('Running: ' + args.ffmpegPath + ' ' + spawnArgs.join(' '));

    var cli = new cliUtils_1.CLI({
      cli: args.ffmpegPath,
      spawnArgs: spawnArgs,
      spawnOpts: {},
      jobLog: args.jobLog,
      outputFilePath: cacheFilePath,
      inputFileObj: args.inputFileObj,
      logFullCliOutput: args.logFullCliOutput,
      updateWorker: args.updateWorker,
      args: args,
    });

    cli.runCli().then(function (res) {
      if (res.cliExitCode !== 0) {
        args.jobLog('FFmpeg SVT-AV1 encode failed with exit code ' + res.cliExitCode);
        resolve({
          outputFileObj: args.inputFileObj,
          outputNumber: 2,
          variables: args.variables,
        });
        return;
      }

      args.logOutcome('tSuc');
      resolve({
        outputFileObj: { _id: cacheFilePath },
        outputNumber: 1,
        variables: args.variables,
      });
    }).catch(function (err) {
      args.jobLog('FFmpeg SVT-AV1 encode error: ' + err.message);
      resolve({
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
      });
    });
  });
};
exports.plugin = plugin;
