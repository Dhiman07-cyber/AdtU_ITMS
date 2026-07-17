-- Index optimization for Phase 5.4 Production Convergence
-- Create indexes on frequently queried columns in student_profiles and driver_profiles to optimize queries, JOINs, and aggregates.

-- 1. Optimize queries for expired student cleanups, soft-blocking, and list checks
CREATE INDEX IF NOT EXISTS idx_student_profiles_status_valid_until 
ON public.student_profiles(status, valid_until);

-- 2. Optimize bus assignment check-ups and load counts/JOINs
CREATE INDEX IF NOT EXISTS idx_student_profiles_assigned_bus_shift
ON public.student_profiles(assigned_bus_id, shift)
WHERE assigned_bus_id IS NOT NULL;

-- 3. Optimize route allocations and filtering
CREATE INDEX IF NOT EXISTS idx_student_profiles_route_id
ON public.student_profiles(route_id)
WHERE route_id IS NOT NULL;

-- 4. Optimize driver lookups by assigned bus
CREATE INDEX IF NOT EXISTS idx_driver_profiles_assigned_bus_id
ON public.driver_profiles(assigned_bus_id)
WHERE assigned_bus_id IS NOT NULL;

-- 5. Optimize user queries by role
CREATE INDEX IF NOT EXISTS idx_users_role
ON public.users(role);

-- 6. View to calculate bus occupancy counts natively in PostgreSQL
CREATE OR REPLACE VIEW public.bus_occupancy_counts_view AS
SELECT 
  assigned_bus_id as bus_id,
  COUNT(*) as total_count,
  SUM(CASE WHEN (shift = 'Morning' OR shift = 'Both') THEN 1 ELSE 0 END) as morning_count,
  SUM(CASE WHEN (shift = 'Evening' OR shift = 'Both') THEN 1 ELSE 0 END) as evening_count
FROM public.student_profiles
WHERE (status = 'active') 
   OR (status IN ('soft_blocked', 'pending_deletion') AND seat_released_at IS NULL)
GROUP BY assigned_bus_id;

-- 7. View to calculate stop counts per bus natively in PostgreSQL
CREATE OR REPLACE VIEW public.bus_stop_counts_view AS
SELECT 
  assigned_bus_id as bus_id,
  stop_id,
  COUNT(*) as stop_count
FROM public.student_profiles
WHERE ((status = 'active') 
   OR (status IN ('soft_blocked', 'pending_deletion') AND seat_released_at IS NULL))
  AND stop_id IS NOT NULL
GROUP BY assigned_bus_id, stop_id;
