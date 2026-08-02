#!/usr/bin/env node
'use strict';

/**
 * Generate CLI command markdown from control-plane.json operations.
 * Usage: node generate-cli-docs.js --resource <name> --operation <name> [--output <file>]
 */

const fs = require('fs');
const path = require('path');

function cliDescription(raw) {
  if (!raw) return '<!-- TODO: description -->';
  let first = raw.trim().replace(/\.$/, '');
  // Ensure third-person singular
  const verbs = ['create', 'delete', 'list', 'describe', 'get', 'update', 'modify', 'start', 'suspend', 'resume', 'restore', 'export', 'apply', 'add', 'bind'];
  for (const v of verbs) {
    if (first.toLowerCase().startsWith(v + ' ')) {
      first = v + 's' + first.slice(v.length);
      break;
    }
  }
  return `This operation ${first.charAt(0).toLowerCase()}${first.slice(1)}.`;
}

function paramDescription(raw) {
  if (!raw) return '<!-- TODO -->';
  let desc = raw.trim();
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  if (!desc.endsWith('.')) desc += '.';
  return desc;
}

function generateMarkdown(resourceName, opName, op) {
  let md = '';

  // Description
  const rawDesc = op.description || `<!-- TODO: description -->`;
  md += `${cliDescription(rawDesc)}\n\n`;

  // Note for dedicated-only
  if (op.dedicatedOnly) {
    md += `> 📖 **Notes**\n>\n> This command is available for Dedicated clusters only.\n\n`;
  }

  // Usage
  const usage = `zilliz ${resourceName} ${opName} [OPTIONS]`;
  md += `## Usage{#usage}\n\n`;
  md += `\`\`\`bash\n${usage}\n\`\`\`\n\n`;

  // Options
  if (op.params && op.params.length > 0) {
    md += `**OPTIONS:**\n\n`;
    for (const p of op.params) {
      const flagName = p.cli || `--${p.name}`;
      const type = p.type || 'string';
      md += `- **${flagName}** (*${type}*) -\n`;

      if (p.required) {
        md += `  **[REQUIRED]**\n`;
      }

      let desc = paramDescription(p.description);

      if (p.choices && p.choices.length > 0) {
        desc += ` Choices: ${p.choices.map(c => `\`${c}\``).join(', ')}.`;
      }

      if (p.default !== null && p.default !== undefined && p.default !== false) {
        desc += ` Default: \`${p.default}\`.`;
      }

      if (p.requiredUnless) {
        desc += ` Required unless \`${p.requiredUnless}\` is provided.`;
      }

      md += `  ${desc}\n`;
    }
    md += '\n';
  }

  // Body param note
  if (op.bodyParam) {
    md += `- **${op.bodyParam}** (*string*) -\n`;
    md += `  Pass a JSON string or a file path (e.g. \`file://body.json\`) as the request body.\n\n`;
  }

  // Example
  md += `## Example{#example}\n\n`;
  if (op.examples && op.examples.length > 0) {
    md += `\`\`\`bash\n${op.examples.join('\n')}\n\`\`\`\n`;
  } else {
    md += `\`\`\`bash\n# TODO: Usage example\nzilliz ${resourceName} ${opName}\n\`\`\`\n`;
  }

  return md;
}

function main() {
  const args = process.argv.slice(2);
  let resource = null;
  let operation = null;
  let output = null;
  let modelPath = '/tmp/control-plane-remote.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resource') resource = args[++i];
    else if (args[i] === '--operation') operation = args[++i];
    else if (args[i] === '--output') output = args[++i];
    else if (args[i] === '--model') modelPath = args[++i];
  }

  if (!resource || !operation) {
    console.error('Usage: node generate-cli-docs.js --resource <name> --operation <name> [--output <file>]');
    process.exit(1);
  }

  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const op = model.resources[resource]?.operations?.[operation];

  if (!op) {
    console.error(`Operation not found: ${resource}.${operation}`);
    process.exit(1);
  }

  const md = generateMarkdown(resource, operation, op);

  if (output) {
    fs.writeFileSync(output, md);
    console.log(`Wrote ${output}`);
  } else {
    console.log(md);
  }
}

main();
