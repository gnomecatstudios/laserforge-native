<p align="center"><img src="../public/mark.png" width="88" height="88" alt="Laser Forge logo" /></p>

# Raspberry Pi portable offline version

Use Raspberry Pi OS **with a desktop and Chromium installed**. The package
includes the app and a local server, but does not include a browser. Raspberry
Pi OS Lite needs a desktop/browser setup to use the app on the Pi itself.

## Choose your download

In a terminal, run `uname -m`:

| Result | Package |
| --- | --- |
| `aarch64` | [ARM64 ZIP](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.9/LaserForge-Portable-RPi-ARM64-v3.0.9.zip) |
| `armv7l` or `armv6l` | [ARM32 ZIP](https://github.com/gnomecatstudios/laserforge-native/releases/download/v3.0.9/LaserForge-Portable-RPi-ARM32-v3.0.9.zip) |

Choose based on your installed operating system, even if the Pi's processor
supports 64-bit. The ARM32 server targets ARMv6 or newer; browser availability
and performance on older Pi models may limit the app's usability.

## Install from the desktop

The ZIP includes `setup.py`, which installs for your user and
creates menu and desktop shortcuts. Open with Python 3 for the setup dialog,
or run `python3 setup.py --cli` in its folder. The dialog needs Tkinter.
The installer registers the bundled red Laser Forge icon in the standard
Linux icon directory. If an older desktop shortcut shows a generic gear,
reinstall using a new ZIP and `setup.py --cli` to recreate the shortcut. If the desktop still shows a cached icon,
log out and back in. These steps affect launchers, not browser-saved projects.

## Start without installing

Extract the ZIP, open a terminal in the extracted `LaserForge-Portable` folder,
then run:

```sh
chmod +x LaserForge-Portable
./LaserForge-Portable
```

Laser Forge opens in its own Chromium app window, with Web Bluetooth already on
for LaserPecker engravers. Close the window to quit. There is no Node.js or
Python runtime dependency. `python3 setup.py --cli` adds a menu shortcut that
starts it without a terminal.
The server listens only on this Pi; it does not expose the app over your LAN.

## Connect the laser

Use Chromium's USB/Web Serial connection. If your user cannot access the serial
device, add yourself to the serial-device group, usually `dialout`:

```sh
sudo usermod -aG dialout "$USER"
```

Log out and back in after changing group membership. Linux Bluetooth support
may require Chromium's experimental Web Platform features; the app's Bluetooth
connection help describes the setting.

## Offline text and saves

Import the included `Fonts/Geist-500.ttf` through the font picker for offline
text outlines. Other Google Fonts need a first download. Browser autosaves stay
on this Pi; save `.olaser` files to move projects to another device.

## Validation

Both launchers were cross-compiled from the same launcher and embedded app
used by the existing portable packages. Executable architecture headers and
ZIP integrity/checksums were checked. Raspberry Pi execution, Chromium Web
Serial support, and physical laser connections have not been tested on hardware.

See [the portable README](README.md) for source revision and build instructions.
