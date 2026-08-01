# Supabase Database Setup

## ⚠️ IMPORTANT

**USE ONLY `COMPLETE_SCHEMA.sql` for database setup!**

This single file contains everything you need - no other SQL files are required.

## How to Setup Database

1. Go to your **Supabase Dashboard**
2. Navigate to **SQL Editor**
3. Copy and paste **ALL contents** from `COMPLETE_SCHEMA.sql`
4. Click **Run**
5. Wait for completion (should see success message)

## What COMPLETE_SCHEMA.sql Contains

### Tables (7 total)
| Table | Purpose |
|-------|---------|
| `bus_locations` | Real-time GPS tracking |
| `waiting_flags` | Student waiting signals |
| `driver_location_updates` | Historical location breadcrumbs |
| `reassignment_logs` | Audit logs for assignments |
| `payments` | Immutable financial ledger |
| `active_trips` | Lock management for multi-driver system |
| `device_sessions` | Single-device session locks |

### Security Features
- ✅ **Row Level Security (RLS)** enabled on all tables
- ✅ **Hardened Policies** - Unauthorized reading of sensitive data is restricted
- ✅ **Service role** required for administrative write operations
- ✅ **User-scoped** read access for student/driver personal profiles
- ✅ **Append-Only Policies** - Destructive deletes are blocked on the payments ledger

### Key Security Policies

| Table | Who Can Read |
|-------|--------------|
| `bus_locations` | Anon, Authenticated |
| `waiting_flags` | Student owner, active drivers, or service role |
| `driver_location_updates` | Driver owner or service role |
| `payments` | Student owner or service role |
| `reassignment_logs` | Service role only |
| `active_trips` | Anon, Authenticated (only active status) |
| `device_sessions` | Authenticated session owner or service role |

### Also Includes
- ✅ All performance indexes
- ✅ Helper functions and triggers (including timing-safe triggers and heartbeat utilities)
- ✅ Realtime configuration
- ✅ Documentation comments

## Verification

After running COMPLETE_SCHEMA.sql, verify with:

```sql
-- Check all tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;

-- Check indexes
SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename;
```

## Files in This Directory

| File | Purpose |
|------|---------|
| `COMPLETE_SCHEMA.sql` | **THE ONLY SQL FILE YOU NEED** |
| `config.toml` | Supabase local configuration settings |
| `.gitignore` | Git ignore rules |
| `README.md` | This file |

## ❌ DO NOT

- Do not use old migration files (consolidated into COMPLETE_SCHEMA.sql)
- Do not run migrations multiple times (we use IF NOT EXISTS)
- Do not modify RLS policies without security review
- Do not delete rows from the `payments` table (immutable ledger)

## Migration History

| Date | Change |
|------|--------|
| 2025-12-31 | Consolidated all SQL into COMPLETE_SCHEMA.sql |
| 2025-12-31 | Added security-hardened RLS policies |
| 2025-12-31 | Added payments & reassignment_logs tables |
| 2026-06-24 | Consolidated June 2026 migrations (production optimizations: active_trips lock, rejected payments, RLS policies, trigger function fixes) |
