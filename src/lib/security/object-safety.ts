const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SAFE_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeObjectKey(key: unknown): key is string {
  return typeof key === 'string' && SAFE_KEY_RE.test(key) && !BLOCKED_KEYS.has(key);
}

export function stripUnsafeObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeObjectKeys(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSafeObjectKey(key)) {
      cleaned[key] = stripUnsafeObjectKeys(child);
    }
  }
  return cleaned as T;
}

export function safeGetNested(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isSafeObjectKey(key) || !current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function safeSetNested(target: Record<string, unknown>, path: string[], value: unknown): boolean {
  if (!path.length || path.some((key) => !isSafeObjectKey(key))) return false;

  let current = target;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[path[path.length - 1]] = value;
  return true;
}

export type LegalConfigSection = {
  title: string;
  content: string;
};

export function sanitizeLegalConfig(raw: unknown, fallbackTitle: string): {
  title: string;
  sections: LegalConfigSection[];
} {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? stripUnsafeObjectKeys(raw as Record<string, unknown>)
    : {};

  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim().slice(0, 200)
    : fallbackTitle;

  const sections = Array.isArray(input.sections)
    ? input.sections.slice(0, 100).map((section) => {
      const safeSection = section && typeof section === 'object'
        ? stripUnsafeObjectKeys(section as Record<string, unknown>)
        : {};
      return {
        title: typeof safeSection.title === 'string' ? safeSection.title.trim().slice(0, 200) : '',
        content: typeof safeSection.content === 'string' ? safeSection.content.slice(0, 20000) : '',
      };
    })
    : [];

  return { title, sections };
}
