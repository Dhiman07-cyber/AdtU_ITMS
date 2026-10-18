import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function check() {
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  console.log('Testing Supabase connection to:', url);

  // 1. Inspect routes
  const { data: routes, error: rErr } = await supabase.from('routes').select('*').limit(3);
  if (rErr) {
    console.error('Routes select * error:', rErr.message);
  } else if (routes && routes.length > 0) {
    console.log('Routes row keys:', Object.keys(routes[0]));
    console.log('First route sample:', {
      id: routes[0].id,
      route_name: (routes[0] as any).route_name,
      routeName: (routes[0] as any).routeName,
      stops: (routes[0] as any).stops
    });
  }

  // 2. Query all routes IDs and names
  const { data: allRoutes } = await supabase.from('routes').select('*');
  console.log('Total routes in DB:', allRoutes?.length);
  allRoutes?.forEach((r: any) => {
    console.log(`- ID: ${r.id} | route_name: ${r.route_name || r.name || r.routeName} | stops length: ${Array.isArray(r.stops) ? r.stops.length : 'none'}`);
  });

  // 3. Check system_settings
  const { data: ss, error: ssErr } = await supabase.from('system_settings').select('key').limit(5);
  console.log('system_settings table:', ssErr ? 'MISSING (' + ssErr.message + ')' : 'OK (' + (ss?.length || 0) + ' rows)');

  // 4. Check stop_dwell_logs
  const { data: sdl, error: sdlErr } = await supabase.from('stop_dwell_logs').select('id').limit(1);
  console.log('stop_dwell_logs table:', sdlErr ? 'MISSING (' + sdlErr.message + ')' : 'OK');

  // 5. Test exec_sql
  const { data: es, error: esErr } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
  console.log('RPC exec_sql:', esErr ? 'NOT FOUND (' + esErr.message + ')' : 'OK');
}

check().catch(console.error);
