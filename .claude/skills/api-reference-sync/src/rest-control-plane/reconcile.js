'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {digestSemantic} = require('../../../doc-ops-core/src/digest');

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function fragmentRoutes(file) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const routes = [];
  for (const [routePath, item] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(item || {})) if (HTTP_METHODS.has(method.toLowerCase())) {
      routes.push({method: method.toUpperCase(), path: routePath});
    }
  }
  return routes;
}

function routeKey(route) { return `${route.method} ${route.path}`; }

function routeShapeKey(route) {
  return `${route.method} ${route.path.replace(/\{[^}]+\}/g, '{}')}`;
}

function parameterNames(routePath) {
  return [...routePath.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
}

function reconcileControlPlane({inventory, config, zdocRoot}) {
  const services = inventory.services.map(sourceService => {
    const configured = config.services.find(service => service.id === sourceService.id);
    const files = (configured.zdocFragments || []).map(file => path.join(zdocRoot, file));
    const missingFragments = files.filter(file => !fs.existsSync(file)).map(file => path.relative(zdocRoot, file));
    const zdocRoutes = files.filter(file => fs.existsSync(file)).flatMap(fragmentRoutes);
    const source = new Map(sourceService.routes.map(route => [routeShapeKey(route), route]));
    const zdoc = new Map(zdocRoutes.map(route => [routeShapeKey(route), route]));
    const sharedShapes = [...source.keys()].filter(key => zdoc.has(key));
    const matched = sharedShapes.map(key => routeKey(source.get(key))).sort();
    const parameterNameDifferences = sharedShapes.map(key => {
      const sourceRoute = source.get(key);
      const zdocRoute = zdoc.get(key);
      const sourceNames = parameterNames(sourceRoute.path);
      const zdocNames = parameterNames(zdocRoute.path);
      return sourceNames.join('\0') === zdocNames.join('\0') ? null : {
        method: sourceRoute.method, sourcePath: sourceRoute.path, zdocPath: zdocRoute.path,
        parameters: sourceNames.map((name, index) => ({source: name, zdoc: zdocNames[index]})),
      };
    }).filter(Boolean).sort((a, b) => `${a.sourcePath}\0${a.method}`.localeCompare(`${b.sourcePath}\0${b.method}`));
    const sourceOnly = [...source.entries()].filter(([key]) => !zdoc.has(key)).map(([, route]) => routeKey(route)).sort();
    const zdocOnly = [...zdoc.entries()].filter(([key]) => !source.has(key)).map(([, route]) => routeKey(route)).sort();
    let status = 'MATCHED';
    if (['CONTROLLER_MISSING', 'MAPPING_REQUIRED', 'OWNERSHIP_AMBIGUOUS'].includes(sourceService.status)) status = sourceService.status;
    else if (missingFragments.length) status = 'FRAGMENT_MISSING';
    else if (sourceOnly.length || zdocOnly.length) status = 'DIFF';
    return {id: sourceService.id, status, controllers: sourceService.controllers, fragmentFiles: configured.zdocFragments || [],
      counts: {source: source.size, zdoc: zdoc.size, matched: matched.length, sourceOnly: sourceOnly.length, zdocOnly: zdocOnly.length},
      matched, parameterNameDifferences, sourceOnly, zdocOnly, missingFragments,
      investigation: sourceService.investigation || null};
  });
  const report = {schemaVersion: 1, source: {repository: inventory.repository, revision: inventory.revision},
    configDigest: digestSemantic(config), services,
    summary: {services: services.length, matched: services.filter(item => item.status === 'MATCHED').length,
      blockers: services.filter(item => item.status !== 'MATCHED').length}};
  return {...report, reportDigest: digestSemantic(report)};
}

module.exports = {fragmentRoutes, parameterNames, reconcileControlPlane, routeKey, routeShapeKey};
