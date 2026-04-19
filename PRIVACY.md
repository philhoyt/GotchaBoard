# Privacy Policy — Save to Gotcha (Chrome Extension)

**Last updated: April 19, 2026**

## Overview

Save to Gotcha is a Chrome extension that works with GotchaBoard, a self-hosted image bookmarking application. All data stays on your computer. The extension does not collect, transmit, or store any personal information on external servers.

## What the extension does

- Scans the currently active browser tab for images when you click the extension icon
- Saves selected image URLs to your locally running GotchaBoard server (on your own machine)
- Stores your local server URL preference in Chrome's local storage

## Data collected

**None.** The extension does not collect any personal data, browsing history, or usage analytics. No information is sent to the developer or any third party.

## Permissions and why they are required

| Permission | Why it's needed |
|---|---|
| **activeTab** | Reads image URLs from the page you are currently viewing, only when you click the extension icon |
| **scripting** | Executes a script in the active tab to find images on the page |
| **tabs** | Identifies the active tab so the script runs on the correct page |
| **contextMenus** | Adds a "Save to Gotcha" option when you right-click an image |
| **storage** | Saves your local server URL preference in Chrome so you don't have to re-enter it |
| **localhost access** | Allows the extension to communicate with your locally running GotchaBoard server |

## Data storage

The only data stored by the extension is your GotchaBoard server URL (default: `http://localhost:47315`), saved in Chrome's local storage on your device. This never leaves your machine.

Image URLs passed to the extension are sent directly to your local GotchaBoard server and are never transmitted to any external server.

## Third parties

The extension does not use any third-party services, analytics, advertising networks, or external APIs.

## Changes to this policy

If this policy changes, the updated version will be committed to this repository with a new "Last updated" date.

## Contact

For questions, open an issue at [github.com/philhoyt/GotchaBoard](https://github.com/philhoyt/GotchaBoard/issues).
