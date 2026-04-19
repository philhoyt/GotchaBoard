'use strict';

// Signing is handled by electron-builder via CSC_LINK/CSC_KEY_PASSWORD env vars.
// Notarization runs via the afterSign hook in build/notarize.js.
exports.default = async function afterPack() {};
