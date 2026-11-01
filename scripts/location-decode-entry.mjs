import { decode } from 'geobuf';
import Pbf from 'pbf';
import inside from '@turf/boolean-point-in-polygon';

export function zonesInFeatures(bytes, latitude, longitude) {
  const collection = decode(new Pbf(new Uint8Array(bytes)));
  return collection.features.filter(feature => inside([longitude, latitude], feature))
    .map(feature => feature.properties.tzid);
}
