#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');

const V14_ROOT = 'LF1Kf54jFllUBydVk7hcha30nUh';

const folders = {
  'Cloud Management': 'QMg2fBP94l5N7VdSwbucwMffnje',
  'Data Operations': 'Ag0Rf5tHcl6Wp7d37lBcUE8LnMg',
  'Configuration': 'DGm8fFP8plvHz5d6sErcKcoLnRh',
};

const subfolders = [
  { parent: folders['Cloud Management'], name: 'Project' },
  { parent: folders['Cloud Management'], name: 'OnDemandCluster' },
  { parent: folders['Cloud Management'], name: 'PrivateLink' },
  { parent: folders['Cloud Management'], name: 'Stage' },
  { parent: folders['Cloud Management'], name: 'Volume' },
  { parent: folders['Data Operations'], name: 'Collection' },
  { parent: folders['Data Operations'], name: 'ExternalCollectionRefresh' },
  { parent: folders['Configuration'], name: 'Context' },
  { parent: folders['Configuration'], name: 'Auth' },
  { parent: folders['Configuration'], name: 'Global' },
];

for (const sf of subfolders) {
  const cmd = `node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js create-folder "${sf.name}" --parent ${sf.parent}`;
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const line = output.split('\n').find(l => l.includes('Created folder:'));
    if (line) {
      const match = line.match(/Created folder:\s+(\S+)\s+/);
      if (match) {
        console.log(`  { parent: '${sf.parent}', name: '${sf.name}', token: '${match[1]}' },`);
      }
    }
  } catch (e) {
    console.error(`Failed to create ${sf.name}:`, e.stderr?.toString() || e.message);
  }
}
