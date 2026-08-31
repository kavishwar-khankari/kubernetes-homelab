"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

var details = function () { return ({
  name: 'Check Skip HDR',
  description: 'Checks skipHDR flow variable set by HDR Detect and Tag. '
    + 'Routes DV Profile 5 and other unencodable HDR files to output 2 (skip).',
  style: {
    borderColor: '#FF4444',
  },
  tags: 'video,hdr',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faQuestion',
  inputs: [],
  outputs: [
    {
      number: 1,
      tooltip: 'Safe to encode — HDR will be preserved or content is SDR',
    },
    {
      number: 2,
      tooltip: 'Skip — unsafe HDR (DV Profile 5, no HDR10 fallback)',
    },
  ],
}); };
exports.details = details;

var plugin = function (args) {
  var skipHDR = (args.variables && args.variables.skipHDR) || 'false';
  var hdrType = (args.variables && args.variables.hdrType) || 'unknown';

  if (skipHDR === 'true') {
    args.jobLog('⚠ Skipping — HDR type "' + hdrType + '" cannot be safely re-encoded. '
      + 'Dolby Vision Profile 5 has no HDR10 fallback. '
      + 'Re-encoding would produce washed-out output. '
      + 'Keep original or obtain a DV Profile 7/8 version.');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
    };
  }

  args.jobLog('HDR check passed (type: ' + hdrType + ') — safe to encode.');
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
