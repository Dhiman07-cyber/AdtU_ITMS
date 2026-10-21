# Domain 08: System Settings Persistence, Object Sanitization & Maintenance Mode

## 1. Relational Configuration Storage (`system_settings`)

All system-level administrative parameters, UI configurations, legal terms, and operational flags are persisted in PostgreSQL:

```sql
CREATE TABLE system_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_system_settings_key ON system_settings(key);
```

### 1.1 Canonical Configuration Keys
- `'config'`: Core system configuration (bus fee, calendar deadlines, academic year end, map provider).
- `'landing'`: Public landing page video paths, university emergency numbers, contact email.
- `'ui'`: Client UI version flags, banner toggles.
- `'privacy'`: University transit privacy charter text.
- `'terms'`: Passenger terms of transit service.
- `'activation_{year}'`: Milestone activation markers preventing redundant cron sweeps.

---

## 2. Prototype Pollution Elimination (`stripUnsafeObjectKeys`)

Administrative configuration endpoints accept complex nested JSON payloads. To eliminate Prototype Pollution vulnerabilities (`__proto__`, `constructor`, `prototype`), all incoming payloads pass through recursive key sanitization before reaching the database:

```typescript
export function stripUnsafeObjectKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => stripUnsafeObjectKeys(item)) as unknown as T;
  }

  const cleanObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue; // Drop dangerous prototype keys
    }
    cleanObj[key] = stripUnsafeObjectKeys(value);
  }
  return cleanObj as T;
}
```

---

## 3. Platform Maintenance Mode (`.maintenance-active`)

During major infrastructure upgrades or database migrations, administrators activate maintenance mode via `src/lib/observability/sre/maintenance-mode.ts`:

1. Writes a persistent sentinel file `.maintenance-active` to the server root.
2. The perimeter edge proxy (`src/proxy.ts`) checks for `.maintenance-active`:
   - State-changing requests (`POST`, `PUT`, `DELETE`) are rejected with HTTP 503 `MAINTENANCE_ACTIVE`.
   - Read requests (`GET`) render a persistent university maintenance banner.
3. Health check `/health/ready` switches to `status: 'down'`, causing external load balancers to cease routing traffic to draining pods.
