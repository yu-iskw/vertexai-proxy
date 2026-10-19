const REGION_PATTERN = /^[a-z]+-[a-z]+[0-9]+$/;
const MULTI_REGION_LOCATIONS = new Set(['us', 'eu']);

export function isSupportedLocation(location: string): boolean {
  return (
    location === 'global' || MULTI_REGION_LOCATIONS.has(location) || REGION_PATTERN.test(location)
  );
}

export function vertexHost(location: string): string {
  if (location === 'global') return 'aiplatform.googleapis.com';
  if (MULTI_REGION_LOCATIONS.has(location)) return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}
