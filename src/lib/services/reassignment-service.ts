import * as fleetService from '@/domains/fleet/services/fleet.service';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { normalizeShift } from '@/lib/utils/shift-utils';
import type { ReassignmentPlan } from '@/app/admin/smart-allocation/page';
import { getDriverUidByBusId } from '@/domains/fleet/repositories/driver-assignment.repository';

interface UndoAction {
  id: string;
  timestamp: number;
  plans: ReassignmentPlan[];
  actor: string;
  reason: string;
  expiresAt: number;
}

export class ReassignmentService {
  private undoHistory: UndoAction[] = [];
  private readonly UNDO_WINDOW = 5 * 60 * 1000; // 5 minutes
  private readonly BATCH_SIZE = 80;

  async executeReassignments(
    plans: ReassignmentPlan[],
    reason: string,
    actorId: string,
    actorName: string
  ): Promise<void> {
    if (plans.length === 0) return;

    const batches = [];
    for (let i = 0; i < plans.length; i += this.BATCH_SIZE) {
      batches.push(plans.slice(i, i + this.BATCH_SIZE));
    }

    console.log(`📦 Executing reassignment in ${batches.length} batch(es)`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`⚡ Processing batch ${i + 1}/${batches.length} (${batch.length} students)`);
      await this.executeBatch(batch);
    }

    const undoAction: UndoAction = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      plans,
      actor: actorName,
      reason,
      expiresAt: Date.now() + this.UNDO_WINDOW
    };

    this.undoHistory = [
      undoAction,
      ...this.undoHistory.filter(a => a.expiresAt > Date.now())
    ].slice(0, 10);

    await this.sendNotifications(plans, reason);
    console.log('✅ Reassignment completed successfully');
  }

  async executeBatch(plans: ReassignmentPlan[]): Promise<void> {
    // Single atomic RPC: decrement source, increment target, update student profile.
    // Matches the original Firestore runTransaction() semantic — all-or-nothing.
    const rpcPlans = plans.map(p => ({
      studentId: p.studentId,
      fromBusId: p.fromBusId,
      toBusId: p.toBusId,
      studentShift: p.studentShift,
    }));

    await fleetService.reassignStudentsAtomically(rpcPlans);
    console.log(`✅ Batch of ${plans.length} students reassigned atomically`);
  }

  async undoReassignment(actionId: string): Promise<void> {
    const action = this.undoHistory.find(a => a.id === actionId);

    if (!action) {
      throw new Error('Undo action not found');
    }

    if (action.expiresAt < Date.now()) {
      throw new Error('Undo window expired');
    }

    console.log(`⏪ Undoing reassignment: ${action.plans.length} students`);

    // Reverse the plans: swap from/to buses
    const reversePlans = action.plans.map(plan => ({
      ...plan,
      fromBusId: plan.toBusId,
      toBusId: plan.fromBusId,
      toBusNumber: 'Original',
      reason: `Undo: ${plan.reason}`
    }));

    await this.executeBatch(reversePlans);

    this.undoHistory = this.undoHistory.filter(a => a.id !== actionId);

    await this.sendUndoNotifications(action.plans);
    console.log('✅ Undo completed successfully');
  }

  async sendNotifications(plans: ReassignmentPlan[], reason: string): Promise<void> {
    try {
      const notificationPromises = [];

      const busPlanGroups = new Map<string, ReassignmentPlan[]>();
      plans.forEach(plan => {
        const existing = busPlanGroups.get(plan.toBusId) || [];
        existing.push(plan);
        busPlanGroups.set(plan.toBusId, existing);
      });

      // Student notifications
      for (const plan of plans) {
        notificationPromises.push(
          pgInsertNotification({
            title: '🚌 Bus Reassignment',
            content: `You have been reassigned to ${plan.toBusNumber}. Reason: ${reason}`,
            sender: { userId: 'system', userName: 'System', userRole: 'admin' },
            target: { type: 'specific_users', specificUserIds: [plan.studentId] },
            recipientIds: [plan.studentId],
            autoInjectedRecipientIds: [],
            readByUserIds: [],
            metadata: { type: 'reassignment', fromBusId: plan.fromBusId, toBusId: plan.toBusId, reason }
          })
        );
      }

      // Driver notifications
      for (const [busId, busPlans] of busPlanGroups) {
        const bus = await fleetService.getBusById(busId);
        const driverUID = await getDriverUidByBusId(busId);
        if (driverUID) {
          notificationPromises.push(
            pgInsertNotification({
              title: '👥 New Students Assigned',
              content: `${busPlans.length} new student(s) have been assigned to your bus. Reason: ${reason}`,
              sender: { userId: 'system', userName: 'System', userRole: 'admin' },
              target: { type: 'specific_users', specificUserIds: [driverUID] },
              recipientIds: [driverUID],
              autoInjectedRecipientIds: [],
              readByUserIds: [],
              metadata: { type: 'reassignment', studentCount: busPlans.length, reason }
            })
          );
        }
      }

      await Promise.all(notificationPromises);
      console.log(`📧 Sent ${notificationPromises.length} notifications`);
    } catch (error) {
      console.error('Failed to send notifications:', error);
    }
  }

  async sendUndoNotifications(plans: ReassignmentPlan[]): Promise<void> {
    try {
      const notificationPromises = [];

      for (const plan of plans) {
        notificationPromises.push(
          pgInsertNotification({
            title: '⏪ Reassignment Undone',
            content: `Your bus reassignment has been undone. You are back on your original bus.`,
            sender: { userId: 'system', userName: 'System', userRole: 'admin' },
            target: { type: 'specific_users', specificUserIds: [plan.studentId] },
            recipientIds: [plan.studentId],
            autoInjectedRecipientIds: [],
            readByUserIds: [],
            metadata: { type: 'reassignment_undo' }
          })
        );
      }

      await Promise.all(notificationPromises);
    } catch (error) {
      console.error('Failed to send undo notifications:', error);
    }
  }

  getUndoHistory(): UndoAction[] {
    this.undoHistory = this.undoHistory.filter(a => a.expiresAt > Date.now());
    return this.undoHistory;
  }

  clearUndoHistory(): void {
    this.undoHistory = [];
  }
}
