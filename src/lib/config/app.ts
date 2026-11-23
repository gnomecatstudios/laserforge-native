/** Single source for the product name and identity. Never hard-code these elsewhere. */
export const APP_NAME = 'Laser Forge';
export const APP_DOMAIN = 'gnomecatstudios.github.io';
export const APP_URL = 'https://gnomecatstudios.github.io/laserforge.app/';
export const APP_TAGLINE = 'Laser control in your browser. Free, open source, and it works offline.';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const REPO_URL = 'https://github.com/gnomecatstudios/laserforge-native';
export const ISSUES_URL = `${REPO_URL}/issues`;

/** Project files: a zip with `project.json` and `assets/`. */
export const PROJECT_EXTENSION = '.olaser';
export const PROJECT_MIME = 'application/x-openlaser-project';
/** Machine profiles are plain JSON files. */
export const MACHINE_EXTENSION = '.json';

export { GCODE_EXTENSIONS, IMAGE_EXTENSIONS } from 'libopenlaser/import';
