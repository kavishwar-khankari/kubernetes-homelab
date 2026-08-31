"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

var details = function () { return ({
  name: 'HDR Detect and Tag',
  description: 'Detects HDR type (SDR/HDR10/HLG/HDR10+/DV) and extracts metadata. '
    + 'Sets flow variables hdrType, hdrFlags, skipHDR for downstream plugins. '
    + 'hdrFlags contains only color signaling args — mastering display and '
    + 'content light level metadata is passed automatically by av1_qsv via '
    + 'frame side data.',
  style: {
    borderColor: '#FF8C00',
  },
  tags: 'video,hdr',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faEye',
  inputs: [
    {
      label: 'FFprobe Path',
      name: 'ffprobePath',
      type: 'string',
      defaultValue: '/usr/lib/jellyfin-ffmpeg/ffprobe',
      inputUI: { type: 'text' },
      tooltip: 'Full path to ffprobe binary on the worker node.',
    },
  ],
  outputs: [
    {
      number: 1,
      tooltip: 'HDR detection complete (check hdrType variable)',
    },
  ],
}); };
exports.details = details;

var plugin = function (args) {
  return new Promise(function (resolve) {
    var execSync = require('child_process').execSync;
    var FFPROBE = String(args.inputs.ffprobePath || '/usr/lib/jellyfin-ffmpeg/ffprobe');
    var filePath = args.inputFileObj._id;

    // ─── 1. Get color properties from Tdarr's existing scan ───
    var videoStream = (args.inputFileObj.ffProbeData.streams || []).find(
      function (s) { return s.codec_type === 'video'; }
    );

    if (!videoStream) {
      args.jobLog('No video stream found. Defaulting to SDR.');
      resolve({
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: setVars(args.variables, 'sdr', '', false),
      });
      return;
    }

    var colorTransfer = (videoStream.color_transfer || '').toLowerCase();
    var colorPrimaries = (videoStream.color_primaries || '').toLowerCase();
    var colorSpace = (videoStream.color_space || '').toLowerCase();
    var colorRange = (videoStream.color_range || 'tv').toLowerCase();

    args.jobLog('From Tdarr scan: color_transfer=' + videoStream.color_transfer
      + ', color_primaries=' + videoStream.color_primaries
      + ', color_space=' + videoStream.color_space);

    // ─── 2. Quick SDR check ───
    var isPQ = colorTransfer === 'smpte2084';
    var isHLG = colorTransfer === 'arib-std-b67';
    var isBT2020 = colorPrimaries === 'bt2020';

    if (!isPQ && !isHLG && !isBT2020) {
      args.jobLog('SDR content — no HDR handling needed.');
      resolve({
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: setVars(args.variables, 'sdr', '', false),
      });
      return;
    }

    args.jobLog('HDR indicators found — running ffprobe for side data...');

    // ─── 3. Frame side data (mastering display + CLL) ───
    var sideDataList = [];
    try {
      var frameCmd = FFPROBE
        + ' -v quiet -print_format json'
        + ' -select_streams v:0'
        + ' -read_intervals "%+#1"'
        + ' -show_frames'
        + ' -show_entries frame=side_data_list'
        + ' ' + JSON.stringify(filePath);

      var frameRaw = execSync(frameCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
      }).toString();

      var frameData = JSON.parse(frameRaw);
      var frames = frameData.frames || [];
      sideDataList = (frames[0] || {}).side_data_list || [];

      args.jobLog('Found ' + sideDataList.length + ' side_data entries in first frame.');
      sideDataList.forEach(function (sd) {
        args.jobLog('  side_data: ' + (sd.side_data_type || 'unknown'));
      });
    } catch (err) {
      args.jobLog('ffprobe frame scan error: ' + err.message);
    }

    // ─── 4. DOVI detection via stream side data ───
    var doviProfile = null;
    try {
      var streamCmd = FFPROBE
        + ' -v quiet -print_format json'
        + ' -select_streams v:0'
        + ' -show_streams'
        + ' -show_entries stream_side_data'
        + ' ' + JSON.stringify(filePath);

      var streamRaw = execSync(streamCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
      }).toString();

      var streamData = JSON.parse(streamRaw);
      var streams = streamData.streams || [];
      var vStream = streams[0] || {};
      var streamSideData = vStream.side_data_list || [];

      streamSideData.forEach(function (sd) {
        var sdType = (sd.side_data_type || '').toLowerCase();
        if (sdType.includes('dovi') || sdType.includes('dolby vision')) {
          if (sd.dv_profile !== undefined) {
            doviProfile = parseInt(sd.dv_profile, 10);
            args.jobLog('DOVI config: profile=' + doviProfile
              + ', bl_compat=' + sd.dv_bl_signal_compatibility_id
              + ', level=' + sd.dv_level);
          } else {
            args.jobLog('DOVI side_data found but no profile: ' + JSON.stringify(sd));
          }
        }
        // Merge into sideDataList if not already there
        if (!sideDataList.find(function (e) { return e.side_data_type === sd.side_data_type; })) {
          sideDataList.push(sd);
        }
      });
    } catch (err) {
      args.jobLog('ffprobe stream side_data error: ' + err.message);
    }

    // ─── 5. Fallback DOVI from codec tags ───
    if (doviProfile === null) {
      var tagStr = (videoStream.codec_tag_string || '').toLowerCase();
      var profile = (videoStream.profile || '').toLowerCase();
      if (tagStr.includes('dvhe') || tagStr.includes('dvh1') || tagStr.includes('dvav')) {
        doviProfile = -1;
        args.jobLog('DV detected from codec_tag_string: ' + tagStr + ' (profile unknown)');
      } else if (profile.includes('dolby vision')) {
        doviProfile = -1;
        args.jobLog('DV detected from profile: ' + profile + ' (profile unknown)');
      }
    }

    // ─── 6. Log mastering display + CLL (for debugging only) ───
    // NOTE: av1_qsv reads this metadata automatically from frame side data.
    // We log it here for visibility but do NOT add it to hdrFlags.
    sideDataList.forEach(function (sd) {
      var sdType = sd.side_data_type || '';

      if (/mastering display/i.test(sdType)) {
        args.jobLog('Mastering display: green=' + sd.green_x + ',' + sd.green_y
          + ' blue=' + sd.blue_x + ',' + sd.blue_y
          + ' red=' + sd.red_x + ',' + sd.red_y
          + ' wp=' + sd.white_point_x + ',' + sd.white_point_y
          + ' lum=' + sd.min_luminance + '-' + sd.max_luminance);
        args.jobLog('  (Passed to av1_qsv automatically via frame side data)');
      }

      if (/content light/i.test(sdType)) {
        var cll = sd.max_content || sd.max_content_light_level || '0';
        var fall = sd.max_average || sd.max_frame_average_light_level || '0';
        args.jobLog('Content light level: MaxCLL=' + cll + ', MaxFALL=' + fall);
        args.jobLog('  (Passed to av1_qsv automatically via frame side data)');
      }
    });

    // ─── 7. Classify HDR type ───
    var hdrType = 'sdr';
    var skipHDR = false;

    if (doviProfile === 5) {
      hdrType = 'dv_profile5';
      skipHDR = true;
      args.jobLog('⚠ Dolby Vision Profile 5 — NO HDR10 fallback. Skipping.');
    } else if (doviProfile === 7) {
      hdrType = 'dv_profile7';
      args.jobLog('Dolby Vision Profile 7 (HDR10 compatible) — will preserve HDR10 base.');
    } else if (doviProfile === 8) {
      hdrType = 'dv_profile8';
      args.jobLog('Dolby Vision Profile 8 (HDR10 compatible) — will preserve HDR10 base.');
    } else if (doviProfile === -1) {
      hdrType = 'dv_profile5';
      skipHDR = true;
      args.jobLog('⚠ Dolby Vision detected but profile unknown — skipping for safety.');
    } else if (doviProfile !== null && doviProfile !== 7 && doviProfile !== 8) {
      hdrType = 'dv_profile5';
      skipHDR = true;
      args.jobLog('⚠ Dolby Vision Profile ' + doviProfile + ' — unsupported, skipping.');
    } else if (isHLG) {
      hdrType = 'hlg';
      args.jobLog('HLG content detected.');
    } else if (isPQ || isBT2020) {
      var hasHdr10Plus = sideDataList.some(function (sd) {
        var t = (sd.side_data_type || '').toLowerCase();
        return t.includes('hdr10+') || t.includes('dynamic')
          || t.includes('itut_t35') || t.includes('itu_t_t35');
      });
      if (hasHdr10Plus) {
        hdrType = 'hdr10plus';
        args.jobLog('HDR10+ detected — dynamic metadata lost, HDR10 base preserved.');
      } else {
        hdrType = 'hdr10';
        args.jobLog('HDR10 content detected.');
      }
    }

    // ─── 8. Build ffmpeg color signaling flags ───
    // Only color_primaries, color_trc, colorspace, color_range.
    // Mastering display + CLL are handled by av1_qsv frame side data passthrough.
    var hdrFlags = '';

    if (hdrType !== 'sdr' && !skipHDR) {
      if (hdrType === 'hlg') {
        hdrFlags = '-color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc -color_range tv';
      } else {
        var cs = colorSpace === 'bt2020c' ? 'bt2020c' : 'bt2020nc';
        var cr = colorRange === 'pc' ? 'pc' : 'tv';
        hdrFlags = '-color_primaries bt2020 -color_trc smpte2084 -colorspace ' + cs + ' -color_range ' + cr;
      }
    }

    args.jobLog('→ hdrType=' + hdrType);
    args.jobLog('→ skipHDR=' + skipHDR);
    args.jobLog('→ hdrFlags=' + hdrFlags);

    resolve({
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: setVars(args.variables, hdrType, hdrFlags, skipHDR),
    });
  });
};
exports.plugin = plugin;

// ─── Helpers ───

function setVars(variables, hdrType, hdrFlags, skipHDR) {
  var v = variables || {};
  v.hdrType = hdrType;
  v.hdrFlags = hdrFlags;
  v.skipHDR = skipHDR ? 'true' : 'false';
  return v;
}
