# Notification System Architecture & Anti-IDOR Security Protocol (Forensic Truth)

**Module:** Push Notifications, SMS Emergency Fan-Out, In-App Notifications & Anti-IDOR Gate (`INV-NOTIF-001`)  
**File Authority:** `src/app/api/notifications/`, `src/lib/services/fcm.service.ts`, `src/lib/services/anti-idor.service.ts`  
**Security Invariant:** `INV-NOTIF-001` (Strict recipient user ID verification prevents cross-tenant push notification interception)  

---

# PART 7: Complete Notification System Architecture & Anti-IDOR Protocol (`INV-NOTIF-001`)

### 7.1 Sub-Domain Architecture & Exact Execution Pipeline

#### Batch Mark-All-Read & Pre-Aggregated Recipient Counting
1. **Batch Mark-All-Read (`POST /api/notifications/mark-all-read`):**
   - Updates all unread notifications for the authenticated user in a single atomic SQL query (`id = ANY($1)`), eliminating N+1 round-trip latency.
2. **Pre-Aggregated Recipient Derivation:**
   - When administrators prepare route-wide or system announcements, recipient commuter counts are derived directly from pre-aggregated bus capacity summaries (`morning_load + evening_load`), eliminating full student table downloads.

The notification subsystem delivers in-app and push notifications across 4 recipient strategies:
1. `all_users`: Broadcast to every user.
2. `all_role`: Role-specific broadcast (`student`, `driver`, `moderator`).
3. `route`: Geofenced corridor broadcast targeting commuters assigned to a route.
4. `specific_users`: Targeted array of recipient UIDs.

**Anti-IDOR Protocol (`INV-NOTIF-001`):** When a user requests a notification by ID (`GET /api/notifications/[id]`), the endpoint evaluates `isNotificationVisibleToUser`. If the user is neither the sender, nor an intended recipient, nor an administrator, the server **returns HTTP 404 (Not Found)** rather than HTTP 403 (Forbidden), ensuring that resource existence cannot be enumerated by unauthorized users.

---

### 7.2 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/app/api/notifications/[id]/route.ts (Anti-IDOR Protocol)
// ============================================================================

      if (auth.role === 'student' || auth.role === 'driver') {
        let userRouteId: string | null = null;
        if (auth.role === 'student') {
          try {
            const cachedStudent = await getCachedStudentAssignment(auth.uid);
            if (cachedStudent?.routeId) {
              userRouteId = cachedStudent.routeId;
            } else {
              const student = await getStudentByUid(auth.uid);
              userRouteId = (student as any)?.routeId || (student as any)?.route_id || null;
            }
          } catch {
            userRouteId = null;
          }
        }
        const visibility = Notification.isNotificationVisibleToUser(
          notification,
          auth.uid,
          auth.role as any,
          userRouteId
        );
        if (!visibility.visible) {
          // Anti-IDOR: Return 404 to avoid leaking resource existence
          return NextResponse.json(
            { success: false, error: 'Notification not found' },
            { status: 404 }
          );
        }
      }
```

```typescript
// ============================================================================
// VERBATIM FROM src/app/api/notifications/[id]/read/route.ts (Idempotency & Anti-IDOR)
// ============================================================================

        // Idempotency: if user is already in read_by_user_ids, early exit
        if (notification.readByUserIds?.includes(auth.uid)) {
          return NextResponse.json({ success: true, alreadyRead: true }, { status: 200 });
        }

        let userRouteId: string | null = null;
        if (auth.role === 'student') {
          try {
            const cachedStudent = await getCachedStudentAssignment(auth.uid);
            if (cachedStudent?.routeId) {
              userRouteId = cachedStudent.routeId;
            } else {
              const student = await getStudentByUid(auth.uid);
              userRouteId = (student as any)?.routeId || (student as any)?.route_id || null;
            }
          } catch {
            userRouteId = null;
          }
        }
        const visibility = Notification.isNotificationVisibleToUser(
          notification,
          auth.uid,
          auth.role as any,
          userRouteId
        );
        if (!visibility.visible) {
          return NextResponse.json(
            { success: false, error: 'Notification not found' },
            { status: 404 }
          );
        }

        await Notification.markAsRead(id, auth.uid);
```
```

```typescript
// ============================================================================
// VERBATIM FROM src/lib/services/fcm-notification-service.ts (Dead Token Pruning)
// ============================================================================

          batchResponse.responses.forEach((resp, idx) => {
            if (!resp.success) {
              totalInvalid++;
              const errCode = resp.error?.code;
              if (
                errCode === 'messaging/registration-token-not-registered' ||
                errCode === 'messaging/invalid-registration-token'
              ) {
                const deadToken = batch[idx];
                const studentId = tokenMetaMap.get(deadToken);
                deadTokensToPrune.push({ studentId, token: deadToken });
              }
            }
          });

        if (deadTokensToPrune.length > 0) {
          void (async () => {
            try {
              const { deleteFcmToken } = await import('@/domains/identity');
              const { hashToken } = await import('@/lib/services/fcm-token-service');
              for (const { studentId, token } of deadTokensToPrune) {
                if (studentId) {
                  await deleteFcmToken(studentId, hashToken(token)).catch(() => {});
                } else {
                  const supabase = getSupabaseServer();
                  await supabase.from('fcm_tokens').delete().eq('token_hash', hashToken(token));
                }
              }
            } catch (pruneErr) {
              console.warn('[notifyRoute] Dead token pruning error:', pruneErr);
            }
          })();
        }
```

---

