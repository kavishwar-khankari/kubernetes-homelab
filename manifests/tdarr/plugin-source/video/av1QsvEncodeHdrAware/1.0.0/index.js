"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

var details = function () { return ({
  name: 'AV1 QSV Encode (HDR-Aware)',
  description: 'Encodes video to AV1 using QSV hardware acceleration. '
    + 'Reads hdrFlags flow variable from HDR Detect and Tag plugin '
    + 'and injects color signaling into the ffmpeg command. '
    + 'Automatically falls back to software decoding for codecs/profiles '
    + 'that QSV cannot hardware decode (VC-1, H.264 10-bit, etc). '
    + 'Mastering display and content light level metadata are passed '
    + 'automatically by av1_qsv via frame side data (no CLI flags needed). '
    + 'By default promotes 8-bit sources to 10-bit AV1 output to eliminate '
    + 'quantization noise and banding on flat surfaces (near-zero cost '
    + 'bit-shift via vpp_qsv on GPU).',
  style: {
    borderColor: '#6efefc',
  },
  tags: 'video,ffmpeg,qsv,av1,hdr',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Quality (global_quality)',
      name: 'quality',
      type: 'string',
      defaultValue: '22',
      inputUI: { type: 'text' },
      tooltip: 'QSV global_quality value. Lower = higher quality. (18/22/28/32/36)',
    },
    {
      label: 'Preset',
      name: 'preset',
      type: 'string',
      defaultValue: 'veryslow',
      inputUI: {
        type: 'dropdown',
        options: ['veryslow', 'slower', 'slow', 'medium', 'fast', 'faster', 'veryfast'],
      },
      tooltip: 'QSV encoder preset.',
    },
    {
      label: 'Look Ahead Depth',
      name: 'lookAheadDepth',
      type: 'string',
      defaultValue: '100',
      inputUI: { type: 'text' },
      tooltip: 'look_ahead_depth value. Higher = better quality, slower. (20/40/60/100)',
    },
    {
      label: 'B-Frames',
      name: 'bFrames',
      type: 'string',
      defaultValue: '8',
      inputUI: { type: 'text' },
      tooltip: 'Number of B-frames (bf). (3/5/7/8)',
    },
    {
      label: 'Force 10-bit Output',
      name: 'force10Bit',
      type: 'string',
      defaultValue: 'true',
      inputUI: {
        type: 'dropdown',
        options: ['true', 'false'],
      },
      tooltip: 'Promote 8-bit sources to 10-bit AV1 output. Near-zero cost '
        + '(GPU bit-shift via vpp_qsv) and dramatically reduces banding and '
        + 'quantization noise on flat surfaces. 10-bit sources pass through '
        + 'unchanged. Recommended: true.',
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

/**
 * Detect source bit depth from ffprobe video stream.
 * Checks bits_per_raw_sample, pix_fmt, and profile.
 */
function detectBitDepth(videoStream) {
  if (!videoStream) return 8;
  var bitDepth = Number(videoStream.bits_per_raw_sample) || 8;
  var pixFmt = (videoStream.pix_fmt || '').toLowerCase();
  var profile = (videoStream.profile || '').toLowerCase();
  if (bitDepth === 8 && (pixFmt.includes('10le') || pixFmt.includes('10be')
      || pixFmt.includes('p010') || profile.includes('10'))) {
    bitDepth = 10;
  }
  if (bitDepth === 8 && (pixFmt.includes('12le') || pixFmt.includes('12be'))) {
    bitDepth = 12;
  }
  return bitDepth;
}

/**
 * Check if QSV can hardware decode the given codec/profile.
 * Arc B570 (Battlemage) QSV decode support:
 *   - H.264/AVC:   8-bit only (High, Main, Baseline — NOT High 10)
 *   - HEVC/H.265:  8/10/12-bit
 *   - VP9:         8/10-bit
 *   - AV1:         8/10-bit
 *   - MPEG-2:      8-bit
 *   - MJPEG:       8-bit
 * Everything else (VC-1, MPEG-4 ASP, VP8, WMV3, etc.) = no QSV decode.
 */
function canQsvDecode(videoStream) {
  if (!videoStream) return false;

  var codec = (videoStream.codec_name || '').toLowerCase();
  var bitDepth = detectBitDepth(videoStream);

  switch (codec) {
    case 'h264':
      return bitDepth <= 8;
    case 'hevc':
      return bitDepth <= 12;
    case 'vp9':
      return bitDepth <= 10;
    case 'av1':
      return bitDepth <= 10;
    case 'mpeg2video':
      return bitDepth <= 8;
    case 'mjpeg':
      return bitDepth <= 8;
    default:
      return false;
  }
}

var plugin = function (args) {
  return new Promise(function (resolve, reject) {
    var quality = String(args.inputs.quality || '22');
    var preset = String(args.inputs.preset || 'veryslow');
    var lookAheadDepth = String(args.inputs.lookAheadDepth || '100');
    var bFrames = String(args.inputs.bFrames || '8');

    // Parse force10Bit safely (handles string 'true'/'false', bool, undefined)
    var force10BitRaw = args.inputs.force10Bit;
    var force10Bit;
    if (force10BitRaw === undefined || force10BitRaw === null || force10BitRaw === '') {
      force10Bit = true; // default ON
    } else {
      force10Bit = String(force10BitRaw).toLowerCase() === 'true';
    }

    // Read HDR flags from flow variables
    var hdrFlags = (args.variables && args.variables.hdrFlags) || '';
    var hdrType = (args.variables && args.variables.hdrType) || 'unknown';

    args.jobLog('AV1 QSV Encode: Q' + quality + ', ' + preset
      + ', LA' + lookAheadDepth + ', bf' + bFrames);
    args.jobLog('HDR type: ' + hdrType);

    if (hdrFlags) {
      args.jobLog('Color signaling flags: ' + hdrFlags);
    } else {
      args.jobLog('No HDR flags (SDR content).');
    }

    // Find the real video stream (skip cover art/mjpeg attachments)
    var streams = (args.inputFileObj.ffProbeData && args.inputFileObj.ffProbeData.streams) || [];
    var videoStream = streams.find(function (s) {
      return s.codec_type === 'video'
        && s.codec_name !== 'mjpeg'
        && !(s.disposition && s.disposition.attached_pic === 1);
    });

    // Determine decode path and bit depth
    var useHwDecode = canQsvDecode(videoStream);
    var sourceBitDepth = detectBitDepth(videoStream);
    var codecInfo = videoStream
      ? (videoStream.codec_name || 'unknown') + ' / ' + (videoStream.profile || 'unknown')
        + ' / ' + (videoStream.pix_fmt || 'unknown')
      : 'no video stream found';

    args.jobLog('Source codec: ' + codecInfo);
    args.jobLog('Source bit depth: ' + sourceBitDepth + '-bit');
    args.jobLog('QSV HW decode: ' + (useHwDecode ? 'YES' : 'NO (software fallback)'));

    // Decide whether to promote to 10-bit
    var promoteTo10Bit = force10Bit && sourceBitDepth < 10;
    if (!force10Bit) {
      args.jobLog('10-bit promotion: DISABLED (force10Bit=false)');
    } else if (promoteTo10Bit) {
      args.jobLog('10-bit promotion: ENABLED ('
        + sourceBitDepth + '-bit source → 10-bit AV1 output)');
    } else {
      args.jobLog('10-bit promotion: skipped (source already '
        + sourceBitDepth + '-bit)');
    }

    // Build ffmpeg command parts
    var inputArgs = [];

    if (useHwDecode) {
      inputArgs.push('-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv');
    }
    // SW decode path: no hwaccel flags. av1_qsv handles upload automatically.

    // Build video filter chain
    var videoFilters = [];
    if (promoteTo10Bit) {
      if (useHwDecode) {
        // HW decode: frames are qsv surfaces on GPU. Convert on-GPU via VPP.
        videoFilters.push('vpp_qsv=format=p010le');
      } else {
        // SW decode: frames in system memory. av1_qsv will upload p010 to GPU.
        videoFilters.push('format=p010le');
      }
    }

    var outputArgs = [
      '-map', '0:v:0',
      '-map', '0:a',
      '-map', '0:s?',
      '-map', '0:t?',
      '-map_metadata', '0',
      '-map_chapters', '0',
      '-c:s', 'copy',
      '-c:a', 'copy',
    ];

    if (videoFilters.length > 0) {
      outputArgs.push('-vf', videoFilters.join(','));
      args.jobLog('Video filters: ' + videoFilters.join(','));
    }

    outputArgs = outputArgs.concat([
      '-c:v', 'av1_qsv',
      '-preset', preset,
      '-global_quality', quality,
      '-look_ahead_depth', lookAheadDepth,
      '-extbrc', '1',
      '-adaptive_i', '1',
      '-adaptive_b', '1',
      '-b_strategy', '1',
      '-bf', bFrames,
      '-g', '300',
      '-forced_idr', '1',
    ]);

    // Inject color signaling flags
    if (hdrFlags) {
      var parts = hdrFlags.trim().split(/\s+/);
      outputArgs = outputArgs.concat(parts);
      args.jobLog('Color signaling args injected: ' + JSON.stringify(parts));
    }

    // Safety: ensure max_muxing_queue_size for HDR content with many streams
    if (hdrType !== 'sdr' && hdrType !== 'unknown') {
      outputArgs = outputArgs.concat(['-max_muxing_queue_size', '4096']);
    }

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
        args.jobLog('FFmpeg encode failed with exit code ' + res.cliExitCode);
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
      args.jobLog('FFmpeg encode error: ' + err.message);
      resolve({
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
      });
    });
  });
};
exports.plugin = plugin;
