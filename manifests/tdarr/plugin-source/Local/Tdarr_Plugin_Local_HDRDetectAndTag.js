/* eslint-disable */

/**
 * Tdarr_Plugin_Local_HDRDetectAndTag
 *
 * Detects HDR type (SDR / HDR10 / HLG / HDR10+ / DV Profile 5/7/8)
 * and extracts static HDR metadata. Sets flow variables:
 *
 *   - hdrType:  sdr | hdr10 | hlg | hdr10plus | dv_profile5 | dv_profile7 | dv_profile8
 *   - hdrFlags: ffmpeg CLI flags to inject into encode commands (empty for SDR)
 *   - skipHDR:  "true" if the file should be skipped (DV Profile 5)
 *
 * Uses:
 *   - file.ffProbeData for basic color properties (already scanned by Tdarr)
 *   - /usr/lib/jellyfin-ffmpeg/ffprobe for side_data (mastering display, CLL, DOVI)
 *   - No mediainfo dependency
 *
 * Use via runClassicTranscodePlugin flow node.
 * Place AFTER backup, BEFORE size router.
 *
 * v2.0.0
 */

const details = () => ({
  id: 'Tdarr_Plugin_Local_HDRDetectAndTag',
  Stage: 'Pre-processing',
  Name: 'HDR Detect and Tag',
  Type: 'Video',
  Operation: 'Transcode',
  Description:
    'Detects HDR type and extracts metadata into flow variables for downstream encode nodes.',
  Version: '2.0.0',
  Tags: 'pre-processing,hdr',
  Inputs: [
    {
      name: 'ffprobePath',
      type: 'string',
      defaultValue: '/usr/lib/jellyfin-ffmpeg/ffprobe',
      inputUI: { type: 'text' },
      tooltip: 'Full path to ffprobe binary.',
    },
  ],
});

const plugin = async (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  const { execSync } = require('child_process');

  const FFPROBE = inputs.ffprobePath || '/usr/lib/jellyfin-ffmpeg/ffprobe';

  // Ensure variables object exists
  if (otherArguments && !otherArguments.variables) {
    otherArguments.variables = {};
  }

  const response = {
    processFile: false,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: '',
  };

  const filePath = file._id || file.file;

  // ─── 1. Get color properties from Tdarr's existing ffProbeData ───
  const videoStream = (file.ffProbeData.streams || []).find(
    (s) => s.codec_type === 'video'
  );

  if (!videoStream) {
    response.infoLog += 'No video stream found. Defaulting to SDR.\n';
    setVars(otherArguments, 'sdr', '', false);
    return response;
  }

  const colorTransfer = (videoStream.color_transfer || '').toLowerCase();
  const colorPrimaries = (videoStream.color_primaries || '').toLowerCase();
  const colorSpace = (videoStream.color_space || '').toLowerCase();
  const colorRange = (videoStream.color_range || 'tv').toLowerCase();

  response.infoLog += `From Tdarr scan: color_transfer=${videoStream.color_transfer}, ` +
    `color_primaries=${videoStream.color_primaries}, ` +
    `color_space=${videoStream.color_space}\n`;

  // ─── 2. Quick SDR check — skip ffprobe call entirely for SDR content ───
  const isPQ = colorTransfer === 'smpte2084';
  const isHLG = colorTransfer === 'arib-std-b67';
  const isBT2020 = colorPrimaries === 'bt2020';

  if (!isPQ && !isHLG && !isBT2020) {
    response.infoLog += 'SDR content detected (no PQ/HLG/BT.2020). No HDR handling needed.\n';
    setVars(otherArguments, 'sdr', '', false);
    return response;
  }

  response.infoLog += 'HDR indicators found — running detailed ffprobe for side data...\n';

  // ─── 3. Run ffprobe for side_data (mastering display, CLL, DOVI) ───
  let sideDataList = [];
  let doviProfile = null;

  try {
    // First: get frame side data (mastering display + CLL)
    const frameCmd = [
      JSON.stringify(FFPROBE),
      '-v quiet -print_format json',
      '-select_streams v:0',
      '-read_intervals "%+#1"',
      '-show_frames',
      '-show_entries frame=side_data_list',
      JSON.stringify(filePath),
    ].join(' ');

    const frameRaw = execSync(frameCmd, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    }).toString();

    const frameData = JSON.parse(frameRaw);
    const frames = frameData.frames || [];
    sideDataList = (frames[0] || {}).side_data_list || [];

    response.infoLog += `Found ${sideDataList.length} side_data entries in first frame.\n`;

    // Log what we found
    for (const sd of sideDataList) {
      response.infoLog += `  side_data: ${sd.side_data_type || 'unknown'}\n`;
    }
  } catch (err) {
    response.infoLog += `ffprobe frame scan error: ${err.message}\n`;
    response.infoLog += 'Continuing with stream-level data only.\n';
  }

  // ─── 4. Check for DOVI via ffprobe stream side data ───
  try {
    const streamCmd = [
      JSON.stringify(FFPROBE),
      '-v quiet -print_format json',
      '-select_streams v:0',
      '-show_streams',
      '-show_entries stream_side_data',
      JSON.stringify(filePath),
    ].join(' ');

    const streamRaw = execSync(streamCmd, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    }).toString();

    const streamData = JSON.parse(streamRaw);
    const streams = streamData.streams || [];
    const vStream = streams[0] || {};
    const streamSideData = vStream.side_data_list || [];

    for (const sd of streamSideData) {
      const sdType = (sd.side_data_type || '').toLowerCase();

      if (sdType.includes('dovi') || sdType.includes('dolby vision')) {
        // ffprobe reports dv_profile as an integer
        if (sd.dv_profile !== undefined) {
          doviProfile = parseInt(sd.dv_profile, 10);
          response.infoLog += `DOVI config record found: profile=${doviProfile}, ` +
            `bl_present=${sd.dv_bl_signal_compatibility_id}, ` +
            `level=${sd.dv_level}\n`;
        } else {
          response.infoLog += `DOVI side_data found but no profile field: ${JSON.stringify(sd)}\n`;
        }
      }
    }

    // Also merge any frame-level side data we might have missed
    for (const sd of streamSideData) {
      if (!sideDataList.find((e) => e.side_data_type === sd.side_data_type)) {
        sideDataList.push(sd);
      }
    }
  } catch (err) {
    response.infoLog += `ffprobe stream side_data scan error: ${err.message}\n`;
  }

  // ─── 5. Fallback DOVI detection from codec profile string ───
  if (doviProfile === null) {
    // Some files expose DV in the codec_tag_string like "dvhe" or "dvh1"
    const tagStr = (videoStream.codec_tag_string || '').toLowerCase();
    const codecProfile = (videoStream.profile || '').toLowerCase();

    if (tagStr.includes('dvhe') || tagStr.includes('dvh1') || tagStr.includes('dvav')) {
      // Can't determine exact profile without DOVI config, treat as unknown → skip
      doviProfile = -1; // sentinel for "DV detected but profile unknown"
      response.infoLog += `DV detected from codec_tag_string: ${tagStr} (profile unknown)\n`;
    } else if (codecProfile.includes('dolby vision')) {
      doviProfile = -1;
      response.infoLog += `DV detected from profile string: ${codecProfile} (profile unknown)\n`;
    }
  }

  // ─── 6. Extract HDR10 static metadata from side_data ───
  let masterDisplay = null;
  let maxCLL = null;
  let maxFALL = null;

  for (const sd of sideDataList) {
    const sdType = sd.side_data_type || '';

    if (/mastering display/i.test(sdType)) {
      const g = parseChromaticity(sd.green_x, sd.green_y);
      const b = parseChromaticity(sd.blue_x, sd.blue_y);
      const r = parseChromaticity(sd.red_x, sd.red_y);
      const wp = parseChromaticity(sd.white_point_x, sd.white_point_y);
      const lumMax = parseLuminance(sd.max_luminance);
      const lumMin = parseLuminance(sd.min_luminance);

      if (g && b && r && wp && lumMax !== null && lumMin !== null) {
        masterDisplay = `G(${g})B(${b})R(${r})WP(${wp})L(${lumMax},${lumMin})`;
      }
      response.infoLog += `Mastering display: green=${sd.green_x},${sd.green_y} ` +
        `blue=${sd.blue_x},${sd.blue_y} red=${sd.red_x},${sd.red_y} ` +
        `wp=${sd.white_point_x},${sd.white_point_y} ` +
        `lum=${sd.min_luminance}-${sd.max_luminance}\n`;
      if (masterDisplay) {
        response.infoLog += `  → Formatted: ${masterDisplay}\n`;
      } else {
        response.infoLog += `  → Could not format mastering display (some values missing)\n`;
      }
    }

    if (/content light/i.test(sdType)) {
      maxCLL = parseInt(sd.max_content || sd.max_content_light_level || '0', 10);
      maxFALL = parseInt(sd.max_average || sd.max_frame_average_light_level || '0', 10);
      response.infoLog += `Content light level: MaxCLL=${maxCLL}, MaxFALL=${maxFALL}\n`;
    }
  }

  // ─── 7. Classify HDR type ───
  let hdrType = 'sdr';
  let skipHDR = false;

  if (doviProfile === 5) {
    hdrType = 'dv_profile5';
    skipHDR = true;
    response.infoLog += '⚠ Dolby Vision Profile 5 — NO HDR10 fallback. Skipping.\n';
  } else if (doviProfile === 7) {
    hdrType = 'dv_profile7';
    response.infoLog += 'Dolby Vision Profile 7 (HDR10 compatible) — will preserve HDR10 base.\n';
  } else if (doviProfile === 8) {
    hdrType = 'dv_profile8';
    response.infoLog += 'Dolby Vision Profile 8 (HDR10 compatible) — will preserve HDR10 base.\n';
  } else if (doviProfile === -1) {
    // DV detected but unknown profile — skip for safety
    hdrType = 'dv_profile5';
    skipHDR = true;
    response.infoLog += '⚠ Dolby Vision detected but profile unknown — skipping for safety.\n';
  } else if (doviProfile !== null && doviProfile !== 7 && doviProfile !== 8) {
    // Known but unsupported DV profile
    hdrType = 'dv_profile5';
    skipHDR = true;
    response.infoLog += `⚠ Dolby Vision Profile ${doviProfile} — unsupported, skipping.\n`;
  } else if (isHLG) {
    hdrType = 'hlg';
    response.infoLog += 'HLG content detected.\n';
  } else if (isPQ || isBT2020) {
    // Check for HDR10+ dynamic metadata
    const hasHdr10Plus = sideDataList.some(
      (sd) => {
        const t = (sd.side_data_type || '').toLowerCase();
        return t.includes('hdr10+') || t.includes('dynamic') ||
               t.includes('itut_t35') || t.includes('itu_t_t35');
      }
    );
    if (hasHdr10Plus) {
      hdrType = 'hdr10plus';
      response.infoLog += 'HDR10+ detected — dynamic metadata will be lost, HDR10 base preserved.\n';
    } else {
      hdrType = 'hdr10';
      response.infoLog += 'HDR10 content detected.\n';
    }
  }

  // ─── 8. Build FFmpeg HDR flags ───
  let hdrFlags = '';

  if (hdrType !== 'sdr' && !skipHDR) {
    const parts = [];

    if (hdrType === 'hlg') {
      parts.push('-color_primaries bt2020');
      parts.push('-color_trc arib-std-b67');
      parts.push('-colorspace bt2020nc');
      parts.push('-color_range tv');
    } else {
      // HDR10, HDR10+, DV P7/P8 — all use PQ + BT.2020
      parts.push('-color_primaries bt2020');
      parts.push('-color_trc smpte2084');
      parts.push(`-colorspace ${colorSpace === 'bt2020c' ? 'bt2020c' : 'bt2020nc'}`);
      parts.push(`-color_range ${colorRange === 'pc' ? 'pc' : 'tv'}`);
    }

    // Static metadata
    if (hdrType !== 'hlg') {
      if (masterDisplay) {
        parts.push(`-master_display "${masterDisplay}"`);
      }
      if (maxCLL !== null && maxFALL !== null) {
        parts.push('-max_muxing_queue_size 4096');
        parts.push(`-content_light_level "${maxCLL},${maxFALL}"`);
      }
    }

    hdrFlags = parts.join(' ');
  }

  response.infoLog += `\n→ hdrType=${hdrType}\n→ skipHDR=${skipHDR}\n→ hdrFlags=${hdrFlags}\n`;

  // ─── 9. Set flow variables ───
  setVars(otherArguments, hdrType, hdrFlags, skipHDR);

  return response;
};

// ─── Helpers ───

function setVars(otherArguments, hdrType, hdrFlags, skipHDR) {
  if (otherArguments) {
    if (!otherArguments.variables) {
      otherArguments.variables = {};
    }
    otherArguments.variables.hdrType = hdrType;
    otherArguments.variables.hdrFlags = hdrFlags;
    otherArguments.variables.skipHDR = skipHDR ? 'true' : 'false';
  }
}

function parseChromaticity(xVal, yVal) {
  const x = parseRational(xVal);
  const y = parseRational(yVal);
  if (x === null || y === null) return null;
  // ffprobe gives chromaticity as rationals (e.g., "13250/1" meaning 0.265)
  // master_display expects values as integers in 1/50000 scale
  // If values are already large (>1), they're likely already in the correct scale
  let xInt, yInt;
  if (x > 1) {
    xInt = Math.round(x);
    yInt = Math.round(y);
  } else {
    xInt = Math.round(x * 50000);
    yInt = Math.round(y * 50000);
  }
  return `${xInt},${yInt}`;
}

function parseLuminance(val) {
  const v = parseRational(val);
  if (v === null) return null;
  // ffprobe gives luminance as rationals (e.g., "10000000/1" or "50/1")
  // master_display expects integers in 1/10000 scale
  // If value is already large (>100), it's likely already in the correct scale
  if (v > 100) {
    return Math.round(v);
  }
  return Math.round(v * 10000);
}

function parseRational(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (s === '') return null;
  if (s.includes('/')) {
    const [num, den] = s.split('/').map(Number);
    if (den === 0 || isNaN(num) || isNaN(den)) return null;
    return num / den;
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}

module.exports.details = details;
module.exports.plugin = plugin;
