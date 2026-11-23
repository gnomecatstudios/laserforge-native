LASER FORGE PORTABLE — offline package

The red gear and lightning bolt logo is included as icon.png and LaserForge.ico.
Windows embeds the same icon in LaserForge-Portable.exe.
To create a branded desktop shortcut that launches through the updater, run
Start-LaserForge.cmd --shortcut from Command Prompt in the extracted folder.
Run it again to refresh an existing Laser Forge shortcut.

Source: https://github.com/gnomecatstudios/laserforge-native
Source snapshot: see VERSION.txt (or dist/portable-version.txt in the source ZIP).
App license: MIT; see LICENSE-LaserForge.txt.

UPDATES
Updates come only from https://github.com/gnomecatstudios/laserforge-native/releases,
never from the browser-tab Laser Forge, so the app window is kept.
New native portable builds include a Python-free updater. Open Check for updates
from About or the project menu, choose Download update, save your project, then
choose Install and restart. Disconnect the laser first. Downloads are verified
against the release checksum and installed by a separate native helper after the
launcher exits. An internet connection is required during download and install.
The open app window reloads with the new version after installation.
Older launchers need one manual ZIP download to get this feature.
Start-LaserForge.cmd now opens the native Windows launcher without Python.

Optional legacy Python updater:
With Python 3.9+ installed, open update.py in the extracted portable folder,
or run python3 update.py --launch (Windows: py -3 update.py --launch).
It starts the app, checks for updates in the background, and installs a staged
update before the next launch. Opening update.py without arguments does the same.
On Windows you can also open Start-LaserForge.cmd. Manual update commands: --check, --download, --apply.

Public downloads: https://github.com/gnomecatstudios/laserforge-native/releases/latest
Version 0.2.1 and later check on startup. About and the project menu also offer
Check for updates. The popup waits until the laser is disconnected. Download
the update or choose Later. The popup does not install or restart automatically.
Save your project, close the app and launcher, then extract the new ZIP into
the existing portable folder to replace the application files.
Keep the same browser profile and local address to retain autosaves.

EASY SETUP (RASPBERRY PI / LINUX)
Choose ARM64 for aarch64 Raspberry Pi OS,
ARM32 for armv7l/armv6l, or x64 for Intel/AMD Linux.
The portable ZIP also includes setup.py: open with Python 3 for a setup dialog,
or run python3 setup.py --cli in the extracted folder. It installs for your
user and creates menu/desktop shortcuts without administrator access.
The dialog needs Tkinter; CLI setup uses only Python's standard library.
Your desktop may ask you to allow launching its new shortcut once.

START WITHOUT INSTALLING
Extract the ZIP first. Run the launcher for your system.
Windows: double-click LaserForge-Portable.exe.
Linux: run ./LaserForge-Portable from Terminal.
If needed, run chmod +x LaserForge-Portable on Linux.
Laser Forge opens in its own app window: no browser tabs, address bar or
console. Close the window to quit; the launcher stops with it.
The window uses an installed Chrome, Edge or Chromium engine, which is not
bundled. Edge ships with Windows; desktop Raspberry Pi OS includes Chromium.
On Linux the window turns on Chromium's Web Bluetooth flag for LaserPecker.
Options: --browser-tab (use a normal browser tab), --browser <path> (pick the
browser), --no-browser (serve http://127.0.0.1:5190/ only, Ctrl+C stops it).
No Node.js, Python, package manager, installation, or internet is needed to launch.
The launcher listens only on this computer, at 127.0.0.1:5190.
The app assets are embedded in the executable; keep this license and README too.

OFFLINE FONTS
Interface fonts, app code, presets, image tools and WASM are included.
Google Fonts used for text outlines/previews require internet the first time.
A Geist font is included in Fonts/Geist-500.ttf (OFL license beside it).
For fully offline text creation, import that font or your own TTF/OTF/WOFF using
the font picker. Default text fonts may not outline until a font is available.
Linked documentation and USB driver downloads also require internet.

PROJECT STORAGE
Autosave and machine profiles live in the app window's own profile, not beside
the EXE: %LocalAppData%\LaserForge\AppWindow on Windows and
~/.config/laserforge/app-window on Linux. Autosaves from earlier browser-tab
versions stay in that browser; open your saved .olaser files instead.
Save .olaser projects and export machine profiles to disk before moving to
another computer or clearing browser data. This package does not bundle a
portable browser profile. Existing saves from the public website do not
automatically transfer to this local address.

BUILD / VALIDATION
Production app built with pnpm install --frozen-lockfile and pnpm build.
Launcher source is the .go files and go.mod in the source ZIP. Put the built
app's dist folder beside main.go, then use Go 1.24+ and go build .
Cross builds: GOOS=windows GOARCH=amd64 go build -ldflags="-H windowsgui" -o LaserForge-Portable.exe .
Other supported GOOS/GOARCH combinations: linux/amd64, linux/arm64,
linux/arm (GOARM=6). No CGO is needed.
These executables are unsigned. Physical laser hardware has not been tested.

