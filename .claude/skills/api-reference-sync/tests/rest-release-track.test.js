const test = require('node:test');
const assert = require('node:assert/strict');
const {compareReleaseTracks, normalizeReleaseTrack, parseReleaseTrack} =
  require('../src/rest-track/release-track');

test('normalizes tracks and compares major/minor numerically', () => {
  assert.deepEqual(parseReleaseTrack('v2.6.x'), {major: 2, minor: 6});
  assert.equal(normalizeReleaseTrack('v2.6.x'), '2.6.x');
  assert.equal(compareReleaseTracks('2.10.x', '2.6.x'), 1);
  assert.equal(compareReleaseTracks('3.0.x', '3.0.x'), 0);
});

test('rejects patch and non-track values', () => {
  for (const value of ['2.6.22', '2.6', 'v2.x', 'latest', '']) {
    assert.throws(() => parseReleaseTrack(value), /REST_RELEASE_TRACK_INVALID/);
  }
});
