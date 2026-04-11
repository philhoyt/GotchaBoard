const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../import-review.log');

function logFailed({ pin_url, board_name, title, failure_reason }) {
  const line = `[FAILED] ${pin_url} | reason: ${failure_reason} | board: ${board_name} | title: "${title || ''}"\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (err) {
    // Never crash the import run because of a log write failure
    process.stderr.write(`[logger] Failed to write review log: ${err.message}\n`);
  }
}

module.exports = { logFailed, LOG_PATH };
