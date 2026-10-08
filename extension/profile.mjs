import { PROFILE_FIELDS } from './matching.mjs';
export function definitionsFor(custom = []) {
  const definitions = { ...PROFILE_FIELDS };
  for (const item of custom.slice(0, 20)) {
    if (/^custom_[a-z0-9-]{1,64}$/.test(item.key) && typeof item.label === 'string' && item.label.trim()) definitions[item.key] = [item.label.trim().slice(0, 80)];
  }
  return definitions;
}
