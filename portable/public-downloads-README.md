<p align="center"><img src="logo.png" width="88" height="88" alt="Laser Forge logo" /></p>

# Laser Forge downloads

Design, preview and run laser jobs in your browser, with an offline portable launcher.
This repository hosts packaged apps and update releases. The development repository remains private.

## Downloads

[View all public releases and downloads](https://github.com/gnomecatstudios/laserforge-native/releases).

| Platform | Portable ZIP | Installation |
| --- | --- | --- |
| Windows x64 | [Download](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.1/LaserForge-Portable-windows-x64-v3.0.1.zip) | Extract and run |
| Linux x64 | [Download](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.1/LaserForge-Portable-linux-x64-v3.0.1.zip) | Extract and run |
| RPi ARM64 | [Download](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.1/LaserForge-Portable-RPi-ARM64-v3.0.1.zip) | Extract and run |
| RPi ARM32 | [Download](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.1/LaserForge-Portable-RPi-ARM32-v3.0.1.zip) | Extract and run |

[SHA-256 checksums](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.1/SHA256SUMS.txt)

## Installation

Laser Forge opens in its own app window using an installed Chrome, Edge or Chromium engine (Edge ships with Windows; desktop Raspberry Pi OS includes Chromium). The engine is not bundled.
Download the package for your operating system and processor, then extract the entire ZIP.

- **Windows:** open `LaserForge-Portable.exe` in the extracted folder.
- **Linux:** run `chmod +x LaserForge-Portable`, then `./LaserForge-Portable` in the extracted folder. For a menu shortcut, run `python3 setup.py --cli`. The optional graphical setup requires Tkinter.
- **Raspberry Pi:** use a desktop Pi OS with Chromium installed. Run `uname -m`: choose ARM64 for `aarch64`, ARM32 for `armv7l` or `armv6l`. Then follow the Linux steps.

The app window has no tabs, address bar or console. Close it to quit. The launcher serves only on this
computer at <http://127.0.0.1:5190/>. Run `LaserForge-Portable --browser-tab` to use a normal browser tab instead.

## Updates

Updates come only from [laserforge-native releases](https://github.com/gnomecatstudios/laserforge-native/releases), never from the browser-tab Laser Forge, so the app window is kept. Until that repository publishes a newer release, no update is offered.

Version 0.2.1 and later check for updates at startup when online. An **Update available** popup
appears after the laser is disconnected. Choose **Download update** or **Later**.
You can also use **About → Check for updates**, or **Check for updates** in the project menu.
Checks contact GitHub without an account or token; projects and machine data are not sent.
Offline use continues normally.

Older versions need one manual download from this page to get the popup.
Save your `.olaser` project and export machine profiles before upgrading. Close the app and launcher,
extract the new ZIP into a new folder, and start its launcher. Linux shortcut installations can run
the new `setup.py --cli` again.
The native launcher uses manual updates. The Python launch option described below can download and apply updates on the next launch. If the browser offers a separate Reload update, use it
after disconnecting the laser to load the newly installed app.

### Automatic portable updates (Python 3.9+)

Install a new package containing `update.py` and `release.json` once to enable this.
On Pi/Linux, run its `setup.py` again; menu and desktop shortcuts will then use the
update helper. On Windows, install Python with its `py` launcher and open
`Start-LaserForge.cmd`. Alternatively, run `python3 update.py --launch` on Linux.

The helper downloads matching stable releases in the background, verifies their
SHA-256 checksum, and stages them. Save your projects, disconnect the laser and
close the app and launcher. The update applies before your next launch; the helper
never restarts the app during a laser session. Offline checks leave the installed
version usable. Applying a staged update needs an online recheck. Checksums protect
transfer integrity and trust this repository; packages are not digitally signed.
Use the native executable for manual updates. macOS is no longer a release target.

Autosaves remain in the same browser profile at the same local address. Keep backups before clearing
browser data. Bundled fonts are in `Fonts/`; import `Geist-500.ttf` for offline text outlines.
Other Google Fonts need an initial download.

## Credits

Laser Forge is a fork of [openlaser by Anam Ahmed](https://github.com/theanam/openlaser.app), under the MIT license.
Packages include the app license and the bundled font's OFL license. Windows and Raspberry Pi
builds are cross-compiled; they still need native testing. Physical laser hardware has not been tested.

