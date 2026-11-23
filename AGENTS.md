# Laser Forge project conventions

Supported native platforms are Windows x64, Linux x64, and Raspberry Pi OS (ARM64 and ARM32). macOS is unsupported by owner preference. Do not add macOS builds, packaging, downloads, driver setup guides, or compatibility work. Keep macOS detection only where needed to identify an unsupported platform accurately.

Keep platform lists in the portable builder, release publisher, update picker, and download documentation consistent. Preserve the existing text and layout tools when changing packaging.

Unless the user explicitly requests a platform-specific change, apply app features,
fixes, and branding across Windows, Linux, and Raspberry Pi. Rebuild all four
supported portable targets when refreshing packaged downloads; do not ship only
the Linux update. Run the portable parity and branding checks before publishing.

After every push to `main`, refresh the portable builds: run the parity and branding checks
on all four targets (`scripts/build-portable.py`, then `scripts/verify-portable-parity.py` and
`scripts/verify-portable-branding.py`), then dispatch the "Build portable packages" workflow
(`.github/workflows/portable-build.yml`) on `main` with `publish: true`. That run bumps the
version, commits the verified ZIPs to `portable/downloads`, and creates the GitHub release.
A plain push to `main` only builds the packages; it does not publish them.
