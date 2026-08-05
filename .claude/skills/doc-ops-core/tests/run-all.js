#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const files = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('.test.js'))
  .map(name => path.join(__dirname, name))
  .sort();
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
