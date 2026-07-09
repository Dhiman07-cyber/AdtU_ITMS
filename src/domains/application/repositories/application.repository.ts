/**
 * D4 Application Repository
 *
 * Persistence only — no business logic. Thin delegation layer over PG repository.
 *
 * Architecture: Service → Repository (this file) → Repository.pg → PostgreSQL
 *
 * This layer exists so the service never knows whether storage is PostgreSQL,
 * Firestore, MongoDB, or Redis.
 */
import {
  pgFindByApplicationId,
  pgFindByApplicantUid,
  pgFindAll,
  pgFindAllByState,
  pgFindAllByStateAndType,
  pgInsert,
  pgUpdate,
  pgRemove,
  pgUpsert,
  pgCount,
} from './application.repository.pg';
import type { Application, ApplicationState, ApplicationType } from '@/lib/types/application';

export async function findByApplicationId(applicationId: string): Promise<Application | null> {
  return pgFindByApplicationId(applicationId);
}

export async function findByApplicantUid(applicantUid: string): Promise<Application | null> {
  return pgFindByApplicantUid(applicantUid);
}

export async function findAll(): Promise<Application[]> {
  return pgFindAll();
}

export async function findAllByState(state: ApplicationState): Promise<Application[]> {
  return pgFindAllByState(state);
}

export async function findAllByStateAndType(
  state: ApplicationState,
  applicationType: ApplicationType
): Promise<Application[]> {
  return pgFindAllByStateAndType(state, applicationType);
}

export async function insert(application: Partial<Application>): Promise<void> {
  return pgInsert(application);
}

export async function update(applicationId: string, data: Partial<Application>): Promise<void> {
  return pgUpdate(applicationId, data);
}

export async function remove(applicationId: string): Promise<void> {
  return pgRemove(applicationId);
}

export async function upsert(application: Partial<Application>): Promise<void> {
  return pgUpsert(application);
}

export async function count(): Promise<number> {
  return pgCount();
}

export type { Application };
