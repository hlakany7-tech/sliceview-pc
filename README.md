# Sliceview PC

Fast DICOM viewer for CT and MRI (MPR, compare, measurements, reports). It runs as a web app (`index.html`, installable as a PWA) and as a **Windows desktop application** built from the same code with Electron.

## Download and install (Windows 10/11, 64-bit)

| File | Use it when |
|---|---|
| `Sliceview-Setup-<version>-x64.exe` | The normal installer. Installs for the current user in `%LOCALAPPDATA%\Programs\Sliceview` and needs no administrator rights. |
| `Sliceview-Setup-AllUsers-<version>-x64.exe` | IT deployment: installs into `Program Files` for every user. Needs administrator rights. |
| `Sliceview-<version>-x64-portable.exe` | No installation: a single exe you can run from a USB stick. |

Both installers can be run silently (`/S`, plus an optional `/D=C:\path` as the last argument). They add:

- Start menu and desktop shortcuts
- an Apps & Features entry with an uninstaller
- **.dcm / .dicom** file association, which Windows lets you confirm the first time you open one
- **Open with Sliceview** on the right-click menu of folders and drives, for DICOM CDs, USB sticks and PACS exports

Updating means running a newer installer over the old one; settings are kept. When you uninstall, you are asked whether to also remove your settings and the saved copy of the last study (`%APPDATA%\Sliceview`).

The builds are not code-signed yet, so Windows SmartScreen will warn on first run ("More info" → "Run anyway"). See *Signing* below.

## What the desktop app adds to the web app

- Native **File** menu: Open Files (`Ctrl+O`), Open Folder (`Ctrl+Shift+O`), Open Recent, DICOMweb server, sample study, report.
- Native Windows open and save dialogs. They remember the last folder, and PDF reports are saved wherever you choose.
- Opening from Explorer: double-click a `.dcm`, use "Open with", right-click a folder, or drag and drop. If Sliceview is already open, the study opens in the existing window.
- Whole folders and CDs are read recursively. A `DICOMDIR` stands for its folder, and non-image files (autorun, viewers, PDFs…) are skipped.
- Works fully offline: fonts are bundled and nothing is loaded from the internet. DICOMweb servers you configure are the only network access.
- Window size, position and maximised state are remembered. Logs are in `%APPDATA%\Sliceview\logs`.
- Chromium page zoom is disabled so `Ctrl +/-/0` and `Ctrl`+wheel zoom the image (RadiAnt-style keys are unchanged). Full screen is `Ctrl+Shift+F`, because `F11` inverts the image.

### Security model

The viewer page runs sandboxed with context isolation and no Node.js, under a strict Content Security Policy, from a private `sliceview://app` origin. The page can read only the files the user picked: it gets opaque ids from the main process, never paths. It cannot navigate away; links open in the default browser, and only `http(s)`/`mailto` links are allowed. Electron fuses are set in release builds: no `RunAsNode`, no `NODE_OPTIONS`, no inspector flags, ASAR integrity validation, and the app loads only from its ASAR archive.

## Project layout

```
index.html, *.png, manifest.webmanifest, sw.js   the web app (unchanged; also served as the PWA)
electron/main.js        main process: window, menus, dialogs, file access, app protocol, settings, log
electron/preload.js     the only bridge the page gets (window.sliceviewDesktop)
electron/lib.js         pure helpers (folder walk, argv, HTML transform, recent list, window bounds, safe paths)
web/desktop-bridge.js   page-side glue: hands chosen files to the viewer, native Save for reports
web/fonts.css           bundled Inter / IBM Plex Mono
build/icon.ico          app icon (npm run icons regenerates it from icon-512.png)
build/installer/        NSIS installer script and wizard image
scripts/                icon, installer and Windows smoke-test scripts
test/unit, test/e2e     node:test unit tests; end-to-end tests that drive the real app with Playwright
.github/workflows/      Windows CI: tests, build, silent install/uninstall check, artifacts
```

## Develop, test, build

Requires Node.js 22.

```bash
npm ci
npm start                 # run the desktop app from source
npm run test:unit         # helpers
npm run test:e2e          # starts the real app and drives it (on Linux without a display: xvfb-run -a npm run test:e2e)
npm run dist              # dist/: win-unpacked, portable exe, both installers
```

`npm run dist` uses electron-builder for the app and the portable exe, then `scripts/build-installer.mjs` compiles the installers with NSIS. Install NSIS first (`makensis` on PATH, or `MAKENSIS=<path>`): on Windows `winget install NSIS.NSIS`, on Ubuntu `apt install nsis`. The whole build works on Linux too, and needs no Wine.

To test a packaged build instead of the sources, run `npm run dist:linux-test` and then `SLICEVIEW_EXE=out/linux-test/linux-unpacked/sliceview-pc npm run test:e2e`.

Every push runs `.github/workflows/windows.yml` on a Windows runner. It runs the unit and end-to-end tests on Windows, builds everything, then installs silently, opens a study with the installed app, and uninstalls. The installers and the portable exe are attached to the run as artifacts.

### Version

Change `version` in `package.json`; it appears in the installer, Apps & Features, the exe properties and Help → About.

### Signing

To avoid SmartScreen warnings, sign `dist/win-unpacked/Sliceview.exe` before `npm run dist:installer`, then sign the installers and the portable exe, using `signtool` with an OV/EV certificate or Azure Trusted Signing. electron-builder can sign the app exe itself if `CSC_LINK`/`CSC_KEY_PASSWORD` (or `win.azureSignOptions`) are set.
