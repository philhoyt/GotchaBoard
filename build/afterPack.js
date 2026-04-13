'use strict';

const { execSync } = require('child_process');
const path = require('path');

/**
 * electron-builder afterPack hook.
 * Ad-hoc signs the macOS .app bundle so Gatekeeper doesn't flag it as "damaged."
 *
 * Runs after electron-builder assembles the .app directory but BEFORE it creates
 * the .dmg / .zip artifacts, so the signature is baked into the distributed files.
 */
exports.default = async function afterPack(context) {
  // Only sign on macOS builds
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`\n  ✦ Ad-hoc signing: ${appPath}\n`);

  try {
    // --force: re-sign even if already signed
    // --deep:  sign all nested frameworks and helpers
    // --sign -: ad-hoc signature (no identity required)
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log('  ✦ Ad-hoc signing complete.\n');
  } catch (err) {
    // Don't fail the build — app is still usable with the xattr workaround
    console.warn('  ⚠ Ad-hoc signing failed (build continues):', err.message);
  }
};
