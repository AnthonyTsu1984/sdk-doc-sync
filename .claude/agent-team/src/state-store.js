const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultState() {
  return {
    version: 1,
    localization: {
      lastHandled: null,
      carryover: [],
    },
    tasks: {},
  };
}

class StateStore {
  constructor(filePath = process.env.DOC_AGENT_STATE || '.claude/agent-team/state/local-state.json') {
    this.filePath = filePath;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return defaultState();
    const persisted = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return {
      ...defaultState(),
      ...persisted,
      localization: {
        ...defaultState().localization,
        ...(persisted.localization || {}),
      },
      tasks: {
        ...defaultState().tasks,
        ...(persisted.tasks || {}),
      },
    };
  }

  write(state) {
    ensureDir(path.dirname(this.filePath));
    fs.writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  merge(patch) {
    const state = this.read();
    const merged = {
      ...state,
      ...patch,
      localization: {
        ...state.localization,
        ...(patch.localization || {}),
      },
      tasks: {
        ...state.tasks,
        ...(patch.tasks || {}),
      },
    };
    return this.write(merged);
  }
}

module.exports = {
  StateStore,
  defaultState,
};
