const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createTaskId(prefix = 'doc-agent') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${stamp}-${suffix}`;
}

class TaskStore {
  constructor(root = process.env.DOC_AGENT_ARTIFACT_DIR || 'tmp/doc-agent') {
    this.root = root;
  }

  taskDir(taskId) {
    return path.join(this.root, taskId);
  }

  writeTask(task) {
    ensureDir(this.taskDir(task.id));
    const filePath = path.join(this.taskDir(task.id), 'task.json');
    fs.writeFileSync(filePath, `${JSON.stringify(task, null, 2)}\n`);
    return filePath;
  }

  readTask(taskId) {
    return JSON.parse(fs.readFileSync(path.join(this.taskDir(taskId), 'task.json'), 'utf8'));
  }

  writeArtifact(taskId, name, data) {
    ensureDir(this.taskDir(taskId));
    const filePath = path.join(this.taskDir(taskId), name);
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, body.endsWith('\n') ? body : `${body}\n`);
    return filePath;
  }
}

module.exports = {
  TaskStore,
  createTaskId,
};
