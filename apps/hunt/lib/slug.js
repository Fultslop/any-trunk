// apps/hunt/lib/slug.js

export function toSlug(name) {
  return name.toLowerCase().replaceAll(/[^\da-z]+/g, '-').replaceAll(/^-|-$/g, '');
}

export function uniqueSlug(name, existing = []) {
  const base = toSlug(name);
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
