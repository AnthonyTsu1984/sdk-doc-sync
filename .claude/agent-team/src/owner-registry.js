const { WORK_TYPES } = require('./contracts');

function localizationSurface(config) {
  return {
    workType: WORK_TYPES.LOCALIZATION,
    enabled: config.surfaces.localization.enabled,
    owner: config.surfaces.localization.owner,
    liveWriteEnabled: config.surfaces.localization.enabled,
  };
}

function ownerListSurface(config, workType) {
  const surface = config.surfaces[workType];
  return surface.owners.map(owner => ({
    workType,
    enabled: surface.enabled,
    owner: owner.id,
    repo: owner.repo,
    liveWriteEnabled: false,
  }));
}

function singletonSurface(config, workType) {
  const surface = config.surfaces[workType];
  return [{
    workType,
    enabled: surface.enabled,
    owner: surface.owner,
    liveWriteEnabled: false,
  }];
}

function listOwnerRoutes(config) {
  return [
    localizationSurface(config),
    ...ownerListSurface(config, WORK_TYPES.SDK_REFERENCE),
    ...ownerListSurface(config, WORK_TYPES.REST_REFERENCE),
    ...ownerListSurface(config, WORK_TYPES.CLI_REFERENCE),
    ...singletonSurface(config, WORK_TYPES.GUIDE_DOCS),
    ...singletonSurface(config, WORK_TYPES.VERIFIED_DOCS),
  ];
}

function enabledOwnerRoutes(config) {
  return listOwnerRoutes(config).filter(route => route.enabled);
}

function routeTask(config, task) {
  const route = listOwnerRoutes(config).find(candidate => {
    if (candidate.workType !== task.workType) return false;
    if (task.owner && candidate.owner !== task.owner) return false;
    return true;
  });
  if (!route) throw new Error(`No owner route for workType=${task.workType} owner=${task.owner || ''}`);
  if (!route.enabled) throw new Error(`Owner route is disabled: ${route.owner}`);
  return route;
}

module.exports = {
  listOwnerRoutes,
  enabledOwnerRoutes,
  routeTask,
};
