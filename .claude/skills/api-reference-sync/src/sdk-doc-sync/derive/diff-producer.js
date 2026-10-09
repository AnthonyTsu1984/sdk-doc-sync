'use strict';

// Compile-output diffing (demo two): compare two page-digest maps and report
// exactly which pages changed. Everything else must be byte-identical.

function diffPageDigests(current, previous) {
  const changed = [];
  const added = [];
  const removed = [];
  let unchanged = 0;
  for (const [identity, digest] of Object.entries(current)) {
    if (!(identity in previous)) added.push(identity);
    else if (previous[identity] !== digest) changed.push(identity);
    else unchanged += 1;
  }
  for (const identity of Object.keys(previous)) {
    if (!(identity in current)) removed.push(identity);
  }
  const sort = (list) => list.sort((a, b) => a.localeCompare(b));
  return { changed: sort(changed), added: sort(added), removed: sort(removed), unchanged };
}

module.exports = { diffPageDigests };
