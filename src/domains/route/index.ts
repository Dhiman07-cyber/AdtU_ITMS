// D7 Route — public surface. Only this file may be imported by other domains.
export { count,create,getAll,getAllNames,getById,invalidateRouteCache,remove,update,upsert,validateRouteStops } from './services/route.service';
export type { Route } from './services/route.service';
export * from './services/route-alignment-engine';
export * from './data/canonical-route-geometries';

