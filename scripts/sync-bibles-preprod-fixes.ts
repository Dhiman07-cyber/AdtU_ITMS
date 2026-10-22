import fs from 'fs';
import path from 'path';

function normalizeNewlines(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

function updateFile(filePath: string, replacements: Array<{ find: string; replace: string; label: string }>) {
  console.log(`\n--- Updating ${path.basename(filePath)} ---`);
  const raw = fs.readFileSync(filePath, 'utf8');
  let content = normalizeNewlines(raw);
  let updatedCount = 0;

  for (const r of replacements) {
    const target = normalizeNewlines(r.find);
    const replacement = normalizeNewlines(r.replace);
    if (!content.includes(target)) {
      console.warn(`[WARN] Target not found for: ${r.label}`);
      continue;
    }
    content = content.replace(target, replacement);
    console.log(`[OK] Successfully replaced: ${r.label}`);
    updatedCount++;
  }

  // Preserve original newline format if CRLF was present
  const output = raw.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content;
  fs.writeFileSync(filePath, output, 'utf8');
  console.log(`Completed ${updatedCount} replacements in ${path.basename(filePath)}`);
}

// ── Bible 4: IDENTITY_RBAC_SCANNER_AND_FLEET_OPS_FORENSIC_CODEBASE_TRUTH.md ──
const bible4Path = path.resolve(process.cwd(), 'IDENTITY_RBAC_SCANNER_AND_FLEET_OPS_FORENSIC_CODEBASE_TRUTH.md');

const b4FindDriverUser = `  } else if (user.role === 'driver') {
    const { data: driverProfile } = await db
      .from('driver_profiles')
      .select('status, employee_id, phone, license_number')
      .eq('uid', uid)
      .maybeSingle();

    if (driverProfile) {
      user.status = driverProfile.status || 'active';
      user.employeeId = driverProfile.employee_id;
      user.phone = driverProfile.phone;
      user.licenseNumber = driverProfile.license_number;
    } else {
      user.status = 'active';
    }
  }`;

const b4ReplaceDriverUser = `  } else if (user.role === 'driver') {
    const { data: driverProfile } = await db
      .from('driver_profiles')
      .select('status, employee_id, phone, license_number, bus_id, route_id, shift, trip_active, active_trip_id')
      .eq('uid', uid)
      .maybeSingle();

    if (driverProfile) {
      user.status = driverProfile.status || 'active';
      user.employeeId = driverProfile.employee_id;
      user.phone = driverProfile.phone;
      user.licenseNumber = driverProfile.license_number;
      user.busId = driverProfile.bus_id;
      user.routeId = driverProfile.route_id;
      user.shift = driverProfile.shift;
      user.tripActive = driverProfile.trip_active;
      user.activeTripId = driverProfile.active_trip_id;
    } else {
      user.status = 'active';
    }
  }`;

const b4FindDriverMap = `  approvedBy: 'approved_by',
  dob: 'dob',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const DRIVER_COLUMNS = 'uid, email, full_name, phone, alternate_phone, license_number, aadhar_number, employee_id, address, profile_photo_url, joining_date, status, is_reserved, approved_by, dob, created_at, updated_at';`;

const b4ReplaceDriverMap = `  approvedBy: 'approved_by',
  dob: 'dob',
  busId: 'bus_id',
  assignedBusId: 'bus_id',
  routeId: 'route_id',
  assignedRouteId: 'route_id',
  shift: 'shift',
  assignedShift: 'shift',
  tripActive: 'trip_active',
  activeTripId: 'active_trip_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const DRIVER_COLUMNS = 'uid, email, full_name, phone, alternate_phone, license_number, aadhar_number, employee_id, address, profile_photo_url, joining_date, status, is_reserved, approved_by, dob, bus_id, route_id, shift, trip_active, active_trip_id, created_at, updated_at';`;

const b4FindUpsertToken = `export async function upsertToken(
  userId: string,
  token: string,
  platform: string = 'web'
): Promise<{ success: boolean; error?: string }> {
  const db = getSupabaseServer();
  const tokenHash = hashToken(token);

  const { error } = await db
    .from('fcm_tokens')
    .upsert(
      {
        user_id: userId,
        token_hash: tokenHash,
        token,
        platform,
        last_seen: new Date().toISOString(),
        valid: true,
      },
      { onConflict: 'user_id,token_hash' }
    );

  if (error) {
    console.error('FCM token upsert failed:', error.message);
    return { success: false, error: error.message };
  }
  return { success: true };
}`;

const b4ReplaceUpsertToken = `export async function upsertToken(
  userId: string,
  token: string,
  platform: string = 'web'
): Promise<{ success: boolean; error?: string }> {
  const db = getSupabaseServer();
  const tokenHash = hashToken(token);
  const payload = {
    id: crypto.randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    token,
    platform,
    last_seen: new Date().toISOString(),
    valid: true,
  };

  const { error } = await db
    .from('fcm_tokens')
    .upsert(payload, { onConflict: 'user_id,token_hash' });

  if (error) {
    // If conflict occurs on the primary key \`token\` or constraint differs, fallback to upsert on \`token\`
    const fallback = await db
      .from('fcm_tokens')
      .upsert(payload, { onConflict: 'token' });

    if (fallback.error) {
      console.error('FCM token upsert failed:', fallback.error.message || error.message);
      return { success: false, error: fallback.error.message || error.message };
    }
  }
  return { success: true };
}`;

updateFile(bible4Path, [
  { find: b4FindDriverUser, replace: b4ReplaceDriverUser, label: 'pgFindUserById driver branch' },
  { find: b4FindDriverMap, replace: b4ReplaceDriverMap, label: 'DRIVER_FIELD_MAP and DRIVER_COLUMNS' },
  { find: b4FindUpsertToken, replace: b4ReplaceUpsertToken, label: 'fcm-token upsertToken' },
]);

// ── Bible 5: NOTIFICATIONS_ADMIN_CONFIG_OBSERVABILITY_AND_SRE_FORENSIC_CODEBASE_TRUTH.md ──
const bible5Path = path.resolve(process.cwd(), 'NOTIFICATIONS_ADMIN_CONFIG_OBSERVABILITY_AND_SRE_FORENSIC_CODEBASE_TRUTH.md');

const b5FindMarkAsRead = `  // 1. Try atomic markAsRead / RPC on repository (INV-NOTIF-004)
  if (typeof (notificationRepository as any).markAsRead === 'function') {
    try {
      await (notificationRepository as any).markAsRead(notificationId, userId);
      console.log(\`✅ Notification marked as read: \${notificationId} - \${userId}\`);
      return;
    } catch (rpcErr) {
      console.warn('[markAsRead] Atomic markAsRead failed, falling back to read-modify-write:', rpcErr);
    }
  }`;


const b5ReplaceMarkAsRead = `export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  // 1. Try atomic markAsRead / RPC on repository (INV-NOTIF-004)
  try {
    if (typeof (notificationRepository as any).markAsRead === 'function') {
      await (notificationRepository as any).markAsRead(notificationId, userId);
      console.log(\`✅ Notification marked as read: \${notificationId} - \${userId}\`);
      return;
    }
  } catch (rpcErr) {
    // Falls back to read-modify-write if RPC or markAsRead is unavailable or throws in unit-test mocks
  }

  // 2. Fallback to read-modify-write (e.g., in unit-test mocks where markAsRead is not defined)
  const notification = await notificationRepository.findById(notificationId);
  if (!notification) {
    throw new Error('Notification not found');
  }

  // Idempotency: already read
  const existing = Array.isArray(notification.readByUserIds) ? notification.readByUserIds : [];
  if (existing.includes(userId)) {
    return;
  }

  // Compose new deduplicated array
  const newReadByUserIds = Array.from(new Set([...existing, userId]));

  // Update PG
  await notificationRepository.update(notificationId, {
    readByUserIds: newReadByUserIds,
  });

  console.log(\`✅ Notification marked as read: \${notificationId} - \${userId}\`);
}`;

const b5FindDriverBinding = `    // 2. Check driver profile status (dynamic QR scan system support)
    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('id, user_id, status')
      .or(\`id.eq.\${driverId},user_id.eq.\${driverId}\`)
      .maybeSingle();`;

const b5ReplaceDriverBinding = `    // 2. Check driver profile status (dynamic QR scan system support)
    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('uid, status')
      .eq('uid', driverId)
      .maybeSingle();`;

const b5FindFCMTokenManager = `      // 6. Save to PostgreSQL via API
      const saved = await saveFCMToken(currentUser.uid, fcmToken, 'web', idToken);
      if (saved) {
        localStorage.setItem(lsTokenKey, fcmToken);
        sessionStorage.setItem(ssSyncKey, 'true');`;

const b5ReplaceFCMTokenManager = `      // 6. Save to PostgreSQL via API
      const saved = await saveFCMToken(currentUser.uid, fcmToken, 'web', idToken);
      if (saved) {
        localStorage.setItem(lsTokenKey, fcmToken);
        localStorage.setItem(\`\${LS_LAST_SYNC_PREFIX}\${currentUser.uid}\`, String(Date.now()));
        sessionStorage.setItem(ssSyncKey, 'true');`;

updateFile(bible5Path, [
  { find: b5FindMarkAsRead, replace: b5ReplaceMarkAsRead, label: 'notification.service markAsRead' },
  { find: b5FindDriverBinding, replace: b5ReplaceDriverBinding, label: 'fcm-notification-service driver binding' },
  { find: b4FindUpsertToken, replace: b4ReplaceUpsertToken, label: 'fcm-token upsertToken' },
  { find: b5FindFCMTokenManager, replace: b5ReplaceFCMTokenManager, label: 'FCMTokenManager last sync persistence' },
]);

// ── Bible 6: FRONTEND_RENDERING_CACHING_WEBGL_AND_UX_FORENSIC_CODEBASE_TRUTH.md ──
const bible6Path = path.resolve(process.cwd(), 'FRONTEND_RENDERING_CACHING_WEBGL_AND_UX_FORENSIC_CODEBASE_TRUTH.md');

const b6FindWaitingFlags = `    // Fetch initial flags via supabase (ponytail: one-time query, add dedicated API endpoint if needed)
    const fetchInitial = async () => {
      try {
        const { data, error } = await supabase
          .from('waiting_flags')
          .select('id, student_uid, student_name, bus_id, route_id, stop_name, stop_lat, stop_lng, status, created_at, expires_at')
          .eq('bus_id', busId)
          .in('status', ['raised', 'waiting', 'acknowledged'])
          .order('created_at', { ascending: false });

        if (!isMountedRef.current) return;

        if (error) throw new Error(error.message);

        const formatted: WaitingFlag[] = (data || []).map((f: any) => ({
          id: f.id,
          studentUid: f.student_uid,
          studentName: f.student_name || 'Unknown Student',
          busId: f.bus_id,
          routeId: f.route_id,
          stop_name: f.stop_name,
          stopLat: f.stop_lat,
          stopLng: f.stop_lng,
          status: f.status,
          createdAt: f.created_at,
          expiresAt: f.expires_at || new Date(new Date(f.created_at).getTime() + 20 * 60 * 1000).toISOString(),
        }));

        setFlags(formatted);
      } catch (err: any) {
        console.error('[useWaitingFlags] Error fetching initial flags:', err);
        if (isMountedRef.current) setError(err.message || 'Failed to fetch waiting flags');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };`;

const b6ReplaceWaitingFlags = `    // Fetch initial flags via authenticated API with Supabase fallback
    const fetchInitial = async () => {
      try {
        let fetchedFromApi = false;
        try {
          const token = await getToken();
          if (token) {
            const res = await fetch(\`/api/driver/dashboard-data?busId=\${encodeURIComponent(busId)}\`, {
              headers: {
                Authorization: \`Bearer \${token}\`,
              },
            });
            if (res.ok) {
              const json = await res.json();
              if (isMountedRef.current && Array.isArray(json.waitingFlags)) {
                const formatted: WaitingFlag[] = json.waitingFlags.map((f: any) => ({
                  id: f.id,
                  studentUid: f.studentUid || f.student_uid,
                  studentName: f.studentName || f.student_name || 'Unknown Student',
                  busId: f.busId || f.bus_id,
                  routeId: f.routeId || f.route_id,
                  stop_name: f.stop_name || 'Pickup Point',
                  stopLat: f.stopLat ?? f.stop_lat ?? f.lat ?? 0,
                  stopLng: f.stopLng ?? f.stop_lng ?? f.lng ?? 0,
                  status: f.status,
                  createdAt: f.createdAt || f.created_at || new Date().toISOString(),
                  expiresAt: f.expiresAt || f.expires_at || new Date(new Date(f.createdAt || f.created_at || Date.now()).getTime() + 20 * 60 * 1000).toISOString(),
                  ackByDriverUid: f.ackByDriverUid || f.ack_by_driver_uid,
                }));
                setFlags(formatted);
                fetchedFromApi = true;
              }
            }
          }
        } catch (apiErr) {
          console.warn('[useWaitingFlags] Authenticated API fetch failed, falling back to direct query:', apiErr);
        }

        if (!fetchedFromApi) {
          const { data, error } = await supabase
            .from('waiting_flags')
            .select('id, student_uid, student_name, bus_id, route_id, stop_name, stop_lat, stop_lng, status, created_at, expires_at')
            .eq('bus_id', busId)
            .in('status', ['raised', 'waiting', 'acknowledged'])
            .order('created_at', { ascending: false });

          if (!isMountedRef.current) return;

          if (error) throw new Error(error.message);

          const formatted: WaitingFlag[] = (data || []).map((f: any) => ({
            id: f.id,
            studentUid: f.student_uid,
            studentName: f.student_name || 'Unknown Student',
            busId: f.bus_id,
            routeId: f.route_id,
            stop_name: f.stop_name,
            stopLat: f.stop_lat,
            stopLng: f.stop_lng,
            status: f.status,
            createdAt: f.created_at,
            expiresAt: f.expires_at || new Date(new Date(f.created_at).getTime() + 20 * 60 * 1000).toISOString(),
          }));

          setFlags(formatted);
        }
      } catch (err: any) {
        console.error('[useWaitingFlags] Error fetching initial flags:', err);
        if (isMountedRef.current) setError(err.message || 'Failed to fetch waiting flags');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };`;

updateFile(bible6Path, [
  { find: b6FindWaitingFlags, replace: b6ReplaceWaitingFlags, label: 'useWaitingFlags fetchInitial' },
]);
