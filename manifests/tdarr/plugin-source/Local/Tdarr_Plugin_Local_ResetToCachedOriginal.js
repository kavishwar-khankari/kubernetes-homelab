/* eslint-disable */

/**
 * Tdarr_Plugin_Local_ResetToCachedOriginal  v4.0.0
 *
 * Drop-in replacement for setOriginalFile (used via runClassicTranscodePlugin).
 *
 * TWO MODES:
 *   BACKUP MODE  — no .tdarr_original found in work root → create it
 *   RESTORE MODE — .tdarr_original exists → copy it to current working path
 *
 * KEY INSIGHT: Tdarr uses a root work directory per job (e.g.
 *   /temp/tdarr-workDir2-JOBID/) and encode stages create timestamped
 *   subdirectories within it (e.g. /temp/tdarr-workDir2-JOBID/1772537800633/).
 *   The backup must live in the ROOT work dir so it can be found regardless
 *   of which subdirectory the current stage is working in.
 */

const details = () => ({
  id: 'Tdarr_Plugin_Local_ResetToCachedOriginal',
  Stage: 'Pre-processing',
  Name: 'Reset to Cached Original (NAS-safe)',
  Type: 'Any',
  Operation: 'None',
  Description:
    'On first call, backs up the pristine cache copy to the work root dir. '
    + 'On subsequent calls, restores from that backup to the current working '
    + 'directory. All I/O stays on local cache disk.',
  Version: '4.0.0',
  Tags: 'pre-processing',
  Inputs: [],
});

// eslint-disable-next-line no-unused-vars
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  const fs = require('fs');
  const path = require('path');

  const response = {
    processFile: false,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: '',
  };

  // --- Identify paths ---
  const origLibFile = otherArguments?.originalLibraryFile;
  const nasOriginalPath = origLibFile?._id || file._id;
  const currentWorkingFile = file.file;

  response.infoLog += `NAS original: ${nasOriginalPath}\n`;
  response.infoLog += `Current working file: ${currentWorkingFile}\n`;

  // --- Find the work ROOT directory ---
  // Tdarr work dirs follow the pattern:
  //   /temp/tdarr-workDir2-JOBID/                    (root)
  //   /temp/tdarr-workDir2-JOBID/file.mkv            (after copyToWorkDir)
  //   /temp/tdarr-workDir2-JOBID/1772537800633/file.mkv (after encode stage)
  //
  // We find the root by looking for the "tdarr-workDir" pattern in the path.
  let workRoot = '';

  if (currentWorkingFile && currentWorkingFile !== nasOriginalPath) {
    const parts = currentWorkingFile.split(path.sep);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes('tdarr-workDir')) {
        // The work root is everything up to and including this directory
        workRoot = parts.slice(0, i + 1).join(path.sep);
        break;
      }
    }
  }

  if (!workRoot) {
    response.infoLog += 'ERROR: Cannot find tdarr-workDir in path.\n';
    response.infoLog += 'Falling back to NAS original.\n';
    file.file = nasOriginalPath;
    return response;
  }

  response.infoLog += `Work root: ${workRoot}\n`;

  // --- Backup path (always in work root) ---
  const originalBasename = path.basename(nasOriginalPath);
  const originalExt = path.extname(nasOriginalPath);
  const originalName = path.basename(nasOriginalPath, originalExt);
  const backupName = `${originalName}.tdarr_original${originalExt}`;
  const backupPath = path.join(workRoot, backupName);

  response.infoLog += `Backup path: ${backupPath}\n`;

  // --- Current working directory (where encode stages read/write) ---
  const currentDir = path.dirname(currentWorkingFile);
  const workingPath = path.join(currentDir, originalBasename);

  response.infoLog += `Working path: ${workingPath}\n`;

  // =========================================================
  //  MODE 1: BACKUP — no backup exists yet
  // =========================================================
  if (!fs.existsSync(backupPath)) {
    response.infoLog += `--- BACKUP MODE ---\n`;

    if (fs.existsSync(currentWorkingFile)) {
      try {
        fs.copyFileSync(currentWorkingFile, backupPath);
        const stat = fs.statSync(backupPath);
        response.infoLog += `Created backup: ${backupPath} `
          + `(${(stat.size / 1048576).toFixed(1)} MB)\n`;
        response.infoLog += `Working file unchanged.\n`;
      } catch (err) {
        response.infoLog += `ERROR creating backup: ${err.message}\n`;
      }
    } else {
      // Fallback: copy from NAS
      response.infoLog += `Working file not found. Copying from NAS...\n`;
      if (fs.existsSync(nasOriginalPath)) {
        try {
          fs.copyFileSync(nasOriginalPath, backupPath);
          response.infoLog += `Created backup from NAS (fallback).\n`;
        } catch (err) {
          response.infoLog += `ERROR: ${err.message}\n`;
          file.file = nasOriginalPath;
        }
      } else {
        response.infoLog += `ERROR: NAS original not found either.\n`;
        file.file = nasOriginalPath;
      }
    }

    return response;
  }

  // =========================================================
  //  MODE 2: RESTORE — backup exists, restore from it
  // =========================================================
  response.infoLog += `--- RESTORE MODE ---\n`;

  const backupStat = fs.statSync(backupPath);
  response.infoLog += `Backup: ${(backupStat.size / 1048576).toFixed(1)} MB\n`;

  try {
    // Ensure target directory exists
    if (!fs.existsSync(currentDir)) {
      fs.mkdirSync(currentDir, { recursive: true });
      response.infoLog += `Created dir: ${currentDir}\n`;
    }

    fs.copyFileSync(backupPath, workingPath);
    const restoredStat = fs.statSync(workingPath);
    response.infoLog += `Restored to: ${workingPath} `
      + `(${(restoredStat.size / 1048576).toFixed(1)} MB)\n`;
    file.file = workingPath;
    response.infoLog += `Zero NAS reads.\n`;
  } catch (err) {
    response.infoLog += `ERROR restoring: ${err.message}\n`;
    response.infoLog += `Falling back to NAS.\n`;
    file.file = nasOriginalPath;
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
