'use strict';

const {readCommittedFile} = require('./source-revision');

const FILES = [
  'internal/distributed/proxy/httpserver/constant.go',
  'internal/distributed/proxy/httpserver/handler_v1.go',
  'internal/distributed/proxy/httpserver/handler_v2.go',
];

function parseStringConstants(source) {
  const constants = new Map();
  for (const match of source.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*(["`])([^"`]*?)\2(?:\s*\/\/.*)?$/gm)) constants.set(match[1], match[3]);
  return constants;
}

function evaluateGoString(expression, constants) {
  const parts = expression.split('+').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  let value = '';
  for (const part of parts) {
    const literal = part.match(/^(?:"([^"]*)"|`([^`]*)`)$/);
    if (literal) value += literal[1] ?? literal[2];
    else if (constants.has(part)) value += constants.get(part);
    else return null;
  }
  return value;
}

function balancedCall(source, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

function parseMilvusRoutes(source, constants, options) {
  const routes = [];
  const matcher = /router\.(GET|POST|PUT|DELETE|PATCH)\s*\(/g;
  for (const match of source.matchAll(matcher)) {
    const call = balancedCall(source, match.index + match[0].length - 1);
    const comma = call.indexOf(',');
    const routeExpression = call.slice(1, comma).trim();
    const rawPath = evaluateGoString(routeExpression, constants);
    if (!rawPath) continue;
    const requestType = call.match(/return\s+&([A-Za-z_]\w*)\s*\{/s)?.[1] || null;
    const handlers = [...call.matchAll(/(?:h\.)?([A-Za-z_]\w*)\s*\)/g)].map(item => item[1]);
    const handler = handlers.reverse().find(name => !['wrapperTraceLog', 'wrapperPost', 'timeoutMiddleware', 'restfulSizeMiddleware'].includes(name)) || null;
    const prefix = options.file.endsWith('handler_v2.go') && !rawPath.startsWith('/v2/') ? '/v2/vectordb' : '';
    routes.push({
      method: match[1], path: `${prefix}${rawPath}`, handler, requestType,
      source: {repository: options.repository, revision: options.revision, file: options.file,
        line: source.slice(0, match.index).split('\n').length},
    });
  }
  return routes;
}

function scanMilvusRoutes({repo, revision, repository = 'milvus-io/milvus'}) {
  const constants = parseStringConstants(readCommittedFile(repo, revision, FILES[0]));
  return FILES.slice(1).flatMap(file => parseMilvusRoutes(readCommittedFile(repo, revision, file), constants, {file, revision, repository}))
    .sort((a, b) => `${a.path}\0${a.method}`.localeCompare(`${b.path}\0${b.method}`));
}

module.exports = {evaluateGoString, parseMilvusRoutes, parseStringConstants, scanMilvusRoutes};
