'use strict';

// Loads .env so CSC_LINK, CSC_KEY_PASSWORD, and APPLE_* vars are available
// to electron-builder and the notarize afterSign hook.
require('dotenv').config();
const { execSync } = require('child_process');

execSync('electron-builder --mac', { stdio: 'inherit', env: process.env });
