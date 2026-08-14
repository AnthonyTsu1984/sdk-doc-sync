'use strict';

const path = require('node:path');
const {listCommittedFiles, readCommittedFile} = require('./source-revision');

function globMatch(name, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

function parseJavaStringConstants(source) {
  const constants = new Map();
  for (const match of source.matchAll(/(?:public|private|protected)?\s*static\s+final\s+String\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
    const parts = match[2].split('+').map(part => part.trim());
    let value = '';
    let resolved = true;
    for (const part of parts) {
      const literal = part.match(/^"([^"]*)"$/);
      if (literal) value += literal[1];
      else if (constants.has(part)) value += constants.get(part);
      else resolved = false;
    }
    if (resolved) constants.set(match[1], value);
  }
  return constants;
}

function annotationPaths(args = '', constants = new Map()) {
  const value = args.match(/(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*")/)?.[1] || args.match(/"[^"]*"/)?.[0];
  if (!value) {
    const expression = args.trim();
    if (!expression) return [''];
    let resolved = '';
    for (const part of expression.split('+').map(item => item.trim())) {
      const literal = part.match(/^"([^"]*)"$/);
      const name = part.split('.').at(-1);
      if (literal) resolved += literal[1];
      else if (constants.has(name)) resolved += constants.get(name);
      else return [];
    }
    return [resolved];
  }
  return [...value.matchAll(/"([^"]*)"/g)].map(match => match[1]);
}

function joinPath(left, right) {
  const value = `${left || ''}/${right || ''}`.replace(/\/+/g, '/');
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

function parseSpringController(source, options) {
  const classAt = source.search(/public\s+class\s+/);
  const preamble = classAt < 0 ? source : source.slice(0, classAt);
  const classArgs = [...preamble.matchAll(/@RequestMapping(?:\(([^)]*)\))?/g)].at(-1)?.[1];
  const constants = options.constants || new Map();
  const bases = annotationPaths(classArgs, constants);
  const mapping = /@(Get|Post|Put|Delete|Patch|Request)Mapping(?:\(([^)]*)\))?/g;
  const matches = [...source.matchAll(mapping)].filter(match => match.index > classAt);
  const routes = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const tail = source.slice(match.index + match[0].length, matches[index + 1]?.index || source.length);
    const signature = tail.match(/public\s+([^\s(]+(?:<[^;{]*?>)?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/s);
    if (!signature) continue;
    const methods = match[1] === 'Request'
      ? [...(match[2] || '').matchAll(/RequestMethod\.([A-Z]+)/g)].map(item => item[1])
      : [match[1].toUpperCase()];
    for (const base of bases) for (const child of annotationPaths(match[2], constants)) for (const method of methods) {
      routes.push({
        method, path: joinPath(base, child), handler: signature[2], requestType: signature[3].match(/@RequestBody\s+(?:@\w+\s+)*([\w<>?,.]+)/)?.[1] || null,
        responseType: signature[1].replace(/\s+/g, ' '), serviceId: options.serviceId,
        source: {repository: options.repository, revision: options.revision, file: options.file,
          line: source.slice(0, match.index).split('\n').length},
      });
    }
  }
  return routes;
}

function applyRouteMapping(route, service) {
  const mapping = (service.routeMappings || []).find(item =>
    (!item.method || item.method.toUpperCase() === route.method) &&
    (item.sourcePath === route.path || (item.sourcePrefix && route.path.startsWith(item.sourcePrefix))));
  if (!mapping) return route;
  const publicPath = mapping.publicPath || `${mapping.publicPrefix}${route.path.slice(mapping.sourcePrefix.length)}`;
  return {...route, sourcePath: route.path, path: publicPath};
}

function scanZillizCloudRoutes({repo, revision, config, repository = 'zilliz-cloud'}) {
  const allJavaFiles = listCommittedFiles(repo, revision, ['vdc']).filter(file => file.endsWith('.java'));
  const constantsByBasename = new Map();
  function constantsForController(source) {
    const constants = parseJavaStringConstants(source);
    const mappingArguments = [...source.matchAll(/@(?:Get|Post|Put|Delete|Patch|Request)Mapping(?:\(([^)]*)\))?/g)]
      .map(match => match[1] || '').join(' ');
    const needed = new Set([...mappingArguments.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)].map(match => match[1]));
    const imports = [...source.matchAll(/import\s+static\s+[\w.]+\.([A-Za-z_]\w*)\.([A-Za-z_*]\w*|\*)\s*;/g)]
      .map(match => ({className: match[1], member: match[2]}))
      .filter(item => needed.has(item.member) || (item.member === '*' && /(Constants|Uris|Uri)$/.test(item.className)));
    const importedClasses = [...new Set(imports.map(item => item.className))];
    for (const className of importedClasses) {
      if (!constantsByBasename.has(className)) {
        const file = allJavaFiles.find(candidate => path.basename(candidate) === `${className}.java`);
        constantsByBasename.set(className, file ? parseJavaStringConstants(readCommittedFile(repo, revision, file)) : new Map());
      }
      const selected = imports.filter(item => item.className === className).map(item => item.member);
      for (const [name, value] of constantsByBasename.get(className)) {
        if (selected.includes('*') || selected.includes(name)) constants.set(name, value);
      }
    }
    return constants;
  }
  const services = [];
  for (const service of config.services) {
    const candidates = listCommittedFiles(repo, revision, service.controllerRoots).filter(file =>
      service.controllerPatterns.some(pattern => globMatch(path.basename(file), pattern)));
    const routes = candidates.flatMap(file => {
      const source = readCommittedFile(repo, revision, file);
      return parseSpringController(source, {
      file, revision, repository, serviceId: service.id, constants: constantsForController(source),
    });}).filter(route => !service.sourcePathPrefixes || service.sourcePathPrefixes.some(prefix => route.path.startsWith(prefix)))
      .map(route => applyRouteMapping(route, service));
    services.push({id: service.id, controllers: candidates, routes: routes.sort((a, b) => `${a.path}\0${a.method}`.localeCompare(`${b.path}\0${b.method}`)),
      status: !candidates.length ? 'CONTROLLER_MISSING' : service.mappingStatus || 'SCANNED',
      investigation: service.investigation || null});
  }
  return {schemaVersion: 1, repository, revision, services};
}

module.exports = {annotationPaths, globMatch, parseJavaStringConstants, parseSpringController, scanZillizCloudRoutes};
