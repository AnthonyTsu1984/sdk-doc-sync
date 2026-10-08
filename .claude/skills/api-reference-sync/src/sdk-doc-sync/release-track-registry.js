'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', '..', 'config', 'release-tracks.json');
const RELEASE_ROOT_RESOLUTIONS = new Set(['configured-root', 'explicit-child', 'unresolved']);

class ReleaseTrackRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReleaseTrackRegistryError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Effective scan-state key of a registered track: the explicit scanStateKey
// override wins, else <language>-v<major><minor> derivation. Must stay in
// lockstep with scripts/dashboard/ledger.js registryTrackKey — the dashboard
// keys campaign counts by this value, so two tracks resolving to the same
// key would silently drop one track's counts.
function trackScanStateKey(language, version) {
  const match = /^v(\d+)\.(\d+)\./.exec(String(version || ''));
  return match ? `${language}-v${match[1]}${match[2]}` : language;
}

// Identity values are literals or { env: 'VAR' } references resolved lazily so
// a registry can stay committable while a deployment overrides tokens.
function resolveIdentity(value, env = process.env) {
  if (nonEmptyString(value)) return value;
  if (value && typeof value === 'object' && nonEmptyString(value.env)) {
    const resolved = env[value.env];
    return nonEmptyString(resolved) ? resolved : null;
  }
  return null;
}

function validateReleaseTrackRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== 'object' || registry.schemaVersion !== 1) {
    return { valid: false, errors: [{ code: 'TRACK_REGISTRY_SCHEMA_INVALID', path: '$.schemaVersion' }] };
  }
  if (!registry.languages || typeof registry.languages !== 'object' || Object.keys(registry.languages).length === 0) {
    errors.push({ code: 'TRACK_REGISTRY_LANGUAGES_REQUIRED', path: '$.languages' });
  }
  const seenKeys = new Map(); // effective scan-state key → track path (global: dashboard byKey is cross-language)
  for (const [language, entry] of Object.entries(registry.languages || {})) {
    if (!Array.isArray(entry?.tracks) || entry.tracks.length === 0) {
      errors.push({ code: 'TRACK_REGISTRY_TRACKS_REQUIRED', path: `$.languages.${language}.tracks` });
      continue;
    }
    const seen = new Set();
    entry.tracks.forEach((track, index) => {
      const trackPath = `$.languages.${language}.tracks[${index}]`;
      if (!nonEmptyString(track?.version)) {
        errors.push({ code: 'TRACK_REGISTRY_VERSION_REQUIRED', path: `${trackPath}.version` });
      } else if (seen.has(track.version)) {
        errors.push({ code: 'TRACK_REGISTRY_VERSION_DUPLICATE', path: `${trackPath}.version` });
      } else {
        seen.add(track.version);
      }
      if (track?.scanStateKey !== undefined && !nonEmptyString(track.scanStateKey)) {
        errors.push({ code: 'TRACK_REGISTRY_SCANSTATEKEY_INVALID', path: `${trackPath}.scanStateKey` });
      }
      const effectiveKey = nonEmptyString(track?.scanStateKey)
        ? track.scanStateKey
        : trackScanStateKey(language, track?.version);
      if (nonEmptyString(track?.version)) {
        if (seenKeys.has(effectiveKey)) {
          errors.push({
            code: 'TRACK_REGISTRY_SCANSTATEKEY_DUPLICATE',
            path: `${trackPath}.scanStateKey`,
            details: { key: effectiveKey, firstSeen: seenKeys.get(effectiveKey) },
          });
        } else {
          seenKeys.set(effectiveKey, trackPath);
        }
      }
      if (!nonEmptyString(resolveIdentity(track?.bitable?.baseToken))) {
        errors.push({ code: 'TRACK_REGISTRY_BASE_TOKEN_REQUIRED', path: `${trackPath}.bitable.baseToken` });
      }
      if (track?.bitable?.tableId !== null && track?.bitable?.tableId !== undefined
        && !nonEmptyString(resolveIdentity(track.bitable.tableId))) {
        errors.push({ code: 'TRACK_REGISTRY_TABLE_ID_INVALID', path: `${trackPath}.bitable.tableId` });
      }
      const resolution = track?.drive?.releaseRoot?.resolution;
      if (resolution !== undefined && !RELEASE_ROOT_RESOLUTIONS.has(resolution)) {
        errors.push({ code: 'TRACK_REGISTRY_RELEASE_ROOT_INVALID', path: `${trackPath}.drive.releaseRoot.resolution` });
      }
      if (resolution && resolution !== 'unresolved' && !nonEmptyString(resolveIdentity(track?.drive?.releaseRoot?.token))) {
        errors.push({ code: 'TRACK_REGISTRY_RELEASE_ROOT_INVALID', path: `${trackPath}.drive.releaseRoot.token` });
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

function loadReleaseTrackRegistry(filePath = DEFAULT_REGISTRY_PATH, { env = process.env } = {}) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new ReleaseTrackRegistryError(
      'TRACK_REGISTRY_UNREADABLE',
      `Release track registry is unreadable at ${filePath}: ${error.message}`,
      { filePath },
    );
  }
  const validation = validateReleaseTrackRegistry(registry, { env });
  if (!validation.valid) {
    throw new ReleaseTrackRegistryError(
      'TRACK_REGISTRY_INVALID',
      `Release track registry at ${filePath} is invalid: ${JSON.stringify(validation.errors)}`,
      { filePath, errors: validation.errors },
    );
  }
  return registry;
}

function listLanguageTracks(registry, language) {
  const entry = registry?.languages?.[language];
  if (!entry || !Array.isArray(entry.tracks)) {
    throw new ReleaseTrackRegistryError(
      'TRACK_REGISTRY_LANGUAGE_NOT_REGISTERED',
      `Language ${language || '(missing)'} is not registered in the release track registry`,
      { language: language || null },
    );
  }
  return entry.tracks;
}

function getTrack(registry, language, version) {
  return listLanguageTracks(registry, language).find((track) => track.version === version) || null;
}

function requireTrack(registry, language, version) {
  const track = getTrack(registry, language, version);
  if (!track) {
    throw new ReleaseTrackRegistryError(
      'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
      `Track ${language}/${version || '(missing)'} is not registered in the release track registry`,
      { language, version: version || null },
    );
  }
  return track;
}

// Tracks are ordered oldest first; every other track of the language can hold
// records that reference this track's documents (older docs are inherited by
// newer tracks, and newer-tree records point back at unchanged older docs).
function adjacentTracks(registry, language, version) {
  return listLanguageTracks(registry, language).filter((track) => track.version !== version);
}

function trackBaseToken(track, env = process.env) {
  return resolveIdentity(track?.bitable?.baseToken, env);
}

function trackTableId(track, env = process.env) {
  return resolveIdentity(track?.bitable?.tableId, env);
}

function trackReleaseRootToken(track, env = process.env) {
  const resolution = track?.drive?.releaseRoot?.resolution;
  if (!resolution || resolution === 'unresolved') return null;
  return resolveIdentity(track.drive.releaseRoot.token, env);
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  RELEASE_ROOT_RESOLUTIONS,
  ReleaseTrackRegistryError,
  adjacentTracks,
  getTrack,
  listLanguageTracks,
  loadReleaseTrackRegistry,
  requireTrack,
  resolveIdentity,
  trackBaseToken,
  trackReleaseRootToken,
  trackScanStateKey,
  trackTableId,
  validateReleaseTrackRegistry,
};
