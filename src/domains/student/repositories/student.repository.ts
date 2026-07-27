/**
 * D3 Student Repository — abstraction boundary.
 *
 * Architecture:
 *   Service → Repository (this file) → Repository.pg → PostgreSQL
 *
 * This layer exists so the service never knows whether storage is
 * PostgreSQL, Firestore, MongoDB, or Redis.
 *
 * Migration status: COMPLETED — D3 Student reads and writes from
 * PostgreSQL (Supabase student_profiles table).
 * Firestore (students collection) is no longer used by this domain.
 *
 * ponytail: thin delegation wrapper. Public function signatures are
 * unchanged so StudentService requires zero modification.
 */
import type { Student } from '@/lib/types';
import {
	pgFindAll,
	pgFindByBusId,
	pgFindByEnrollmentId,
	pgFindById,
	pgFindByStatus,
	pgFindByUid,
	pgInsert,
	pgRemove,
	pgUnassignRoute,
	pgUpdate,
	pgUpsert,
} from './student.repository.pg';

export async function findByUid(uid: string): Promise<Student | null> {
  return pgFindByUid(uid);
}

export async function findById(id: string): Promise<Student | null> {
  return pgFindById(id);
}

export async function findAll(): Promise<Student[]> {
  return pgFindAll();
}

export async function findByBusId(busId: string): Promise<Student[]> {
  return pgFindByBusId(busId);
}

export async function findByStatus(status: string): Promise<Student[]> {
  return pgFindByStatus(status);
}

export async function findByEnrollmentId(enrollmentId: string): Promise<Student | null> {
  return pgFindByEnrollmentId(enrollmentId);
}

export async function insert(student: Partial<Student>): Promise<void> {
  return pgInsert(student);
}

export async function update(id: string, data: Partial<Student>): Promise<void> {
  return pgUpdate(id, data);
}

export async function remove(id: string): Promise<void> {
  return pgRemove(id);
}

export async function upsert(student: Partial<Student>): Promise<void> {
  return pgUpsert(student);
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  try {
    await pgUnassignRoute(routeId);
    return true;
  } catch {
    return false;
  }
}


export type { Student };
