/* eslint-disable */

/**
 * Tdarr_Plugin_Local_CheckSkipHDR
 *
 * Checks the `skipHDR` flow variable set by HDRDetectAndTag.
 * Routes Dolby Vision Profile 5 (and other unencodable HDR) files
 * away from the encode pipeline.
 *
 * Outputs:
 *   output 1 (processFile: true)  → safe to encode, continue
 *   output 2 (processFile: false) → skip this file (DV P5 / unsafe HDR)
 *
 * Use via runClassicFilterPlugin flow node.
 * Place AFTER HDRDetectAndTag, BEFORE bitrate routing.
 *
 * v1.0.0
 */

const details = () => ({
  id: 'Tdarr_Plugin_Local_CheckSkipHDR',
  Stage: 'Pre-processing',
  Name: 'Check Skip HDR',
  Type: 'Video',
  Operation: 'Filter',
  Description:
    'Checks skipHDR flow variable. Routes DV Profile 5 and other ' +
    'unencodable HDR files to skip. Set by HDRDetectAndTag plugin.',
  Version: '1.0.0',
  Tags: 'filter,pre-processing,hdr',
  Inputs: [],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const response = {
    processFile: true,
    infoLog: '',
  };

  const skipHDR =
    (otherArguments &&
      otherArguments.variables &&
      otherArguments.variables.skipHDR) || 'false';

  const hdrType =
    (otherArguments &&
      otherArguments.variables &&
      otherArguments.variables.hdrType) || 'unknown';

  if (skipHDR === 'true') {
    response.processFile = false;
    response.infoLog +=
      `⚠ Skipping file — HDR type "${hdrType}" cannot be safely re-encoded. ` +
      `Dolby Vision Profile 5 has no HDR10 fallback layer. ` +
      `Re-encoding would strip all HDR metadata and produce washed-out output. ` +
      `Keep the original or obtain a DV Profile 7/8 version with HDR10 compatibility.\n`;
  } else {
    response.processFile = true;
    response.infoLog += `HDR check passed (type: ${hdrType}) — safe to encode.\n`;
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
