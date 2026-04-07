/**
 * cleanup.js
 * Utility helpers for file cleanup.
 *
 * The application uses in-memory (multer.memoryStorage) processing so no
 * temporary files are written to disk during normal operation. This module
 * is provided for future use or optional disk-based workflows.
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Delete a single file, ignoring "not found" errors.
 * @param {string} filePath  Absolute path to the file
 */
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to delete file ${filePath}:`, err.message);
    }
  }
}

/**
 * Remove all files in a directory that are older than `maxAgeMs` milliseconds.
 * @param {string} dirPath   Absolute path to the directory
 * @param {number} maxAgeMs  Maximum allowed age in ms (default: 1 hour)
 */
async function cleanOldFiles(dirPath, maxAgeMs = 60 * 60 * 1000) {
  try {
    const files = await fs.readdir(dirPath);
    const now = Date.now();

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dirPath, file);
        try {
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            await deleteFile(filePath);
          }
        } catch {
          // Ignore stat errors for individual files
        }
      })
    );
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Error cleaning directory:', err.message);
    }
  }
}

module.exports = { deleteFile, cleanOldFiles };
