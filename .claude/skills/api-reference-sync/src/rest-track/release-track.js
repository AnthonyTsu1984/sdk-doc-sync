'use strict';

const TRACK_PATTERN = /^v?(\d+)\.(\d+)\.x$/u;

function parseReleaseTrack(value) {
  const match = TRACK_PATTERN.exec(String(value || ''));
  if (!match) throw new Error(`REST_RELEASE_TRACK_INVALID: ${JSON.stringify(value)}`);
  return {major: Number(match[1]), minor: Number(match[2])};
}

function normalizeReleaseTrack(value) {
  const {major, minor} = parseReleaseTrack(value);
  return `${major}.${minor}.x`;
}

function compareReleaseTracks(left, right) {
  const a = parseReleaseTrack(left);
  const b = parseReleaseTrack(right);
  return Math.sign(a.major - b.major || a.minor - b.minor);
}

module.exports = {compareReleaseTracks, normalizeReleaseTrack, parseReleaseTrack};
