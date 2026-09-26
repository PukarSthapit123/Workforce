/* A person's capabilities: their user type's template, plus grants, minus revocations.
   A revocation always wins. Pure, so the fake server and later the real one agree. */
export function resolveCapabilities(templateCaps: readonly string[], grants: readonly string[], revocations: readonly string[]): string[] {
  const out = new Set([...templateCaps, ...grants]);
  revocations.forEach(r => out.delete(r));
  return [...out].sort();
}
