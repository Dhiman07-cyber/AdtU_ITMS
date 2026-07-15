import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  getDoc,
  updateDoc,
  addDoc
} from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { getShiftDeltas, normalizeShift } from '@/lib/utils/shift-utils';
import type { ReassignmentPlan } from '@/app/admin/smart-allocation/page';

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

    // Group plans by batch
    const batches = [];
    for (let i = 0; i < plans.length; i += this.BATCH_SIZE) {
      batches.push(plans.slice(i, i + this.BATCH_SIZE));
    }

    console.log(`📦 Executing reassignment in ${batches.length} batch(es)`);

    // Execute each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`⚡ Processing batch ${i + 1}/${batches.length} (${batch.length} students)`);

      await this.executeBatch(batch);
    }

    // Create undo action
    const undoAction: UndoAction = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      plans,
      actor: actorName,
      reason,
      expiresAt: Date.now() + this.UNDO_WINDOW
    };

    // Add to history and cleanup expired
    this.undoHistory = [
      undoAction,
      ...this.undoHistory.filter(a => a.expiresAt > Date.now())
    ].slice(0, 10); // Keep max 10 actions

    // Send notifications
    await this.sendNotifications(plans, reason);

    console.log('✅ Reassignment completed successfully');
  }

  async executeBatch(plans: ReassignmentPlan[]): Promise<void> {
    try {
      // Use transaction for atomic updates
      await runTransaction(db, async (transaction) => {
        // Track load changes per bus by shift
        const busLoadChanges = new Map<string, {
          totalDelta: number;
          morningDelta: number;
          eveningDelta: number;
        }>();

        // Read student documents to get ORIGINAL shifts for source bus decrement.
        // The TARGET shift (plan.studentShift) is used for destination bus increment.
        const studentOriginalShifts = new Map<string, string>();
        for (const plan of plans) {
          const studentDoc = await transaction.get(doc(db, 'students', plan.studentId));
          if (studentDoc.exists()) {
            // Original Shift: what the student currently has in Firestore
            studentOriginalShifts.set(plan.studentId, normalizeShift(studentDoc.data().shift || 'Morning'));
          }
        }

        // Pre-calculate bus load changes using Original Shift vs Target Shift
        for (const plan of plans) {
          // Original Shift: used for SOURCE bus DECREMENT
          const originalShift = studentOriginalShifts.get(plan.studentId) || 'Morning';
          // Target Shift: used for DESTINATION bus INCREMENT
          const targetShift = normalizeShift(plan.studentShift || originalShift);

          // Initialize changes for buses
          if (!busLoadChanges.has(plan.fromBusId)) {
            busLoadChanges.set(plan.fromBusId, { totalDelta: 0, morningDelta: 0, eveningDelta: 0 });
          }
          if (!busLoadChanges.has(plan.toBusId)) {
            busLoadChanges.set(plan.toBusId, { totalDelta: 0, morningDelta: 0, eveningDelta: 0 });
          }

          const fromChanges = busLoadChanges.get(plan.fromBusId)!;
          const toChanges = busLoadChanges.get(plan.toBusId)!;

          // Update total delta (1 head goes from source to target)
          fromChanges.totalDelta -= 1;
          toChanges.totalDelta += 1;

          // Source bus: DECREMENT using ORIGINAL shift
          const srcDeltas = getShiftDeltas(originalShift);
          if (srcDeltas.affectsMorning) fromChanges.morningDelta -= 1;
          if (srcDeltas.affectsEvening) fromChanges.eveningDelta -= 1;

          // Destination bus: INCREMENT using TARGET shift
          const dstDeltas = getShiftDeltas(targetShift);
          if (dstDeltas.affectsMorning) toChanges.morningDelta += 1;
          if (dstDeltas.affectsEvening) toChanges.eveningDelta += 1;
        }

        // Read all affected bus documents (must be done before writes in transaction)
        const busSnapshots = new Map<string, any>();
        for (const busId of busLoadChanges.keys()) {
          const busRef = doc(db, 'buses', busId);
          const busSnap = await transaction.get(busRef);
          if (busSnap.exists()) {
            busSnapshots.set(busId, { ref: busRef, data: busSnap.data() });
          }
        }

        // Validate capacity before executing
        for (const [busId, changes] of busLoadChanges) {
          const busInfo = busSnapshots.get(busId);
          if (!busInfo) {
            throw new Error(`Bus ${busId} not found`);
          }

          const busData = busInfo.data;
          const currentLoad = busData.load || { morningCount: 0, eveningCount: 0 };

          // Calculate new counts
          const newMorning = Math.max(0, (currentLoad.morningCount || 0) + changes.morningDelta);
          const newEvening = Math.max(0, (currentLoad.eveningCount || 0) + changes.eveningDelta);

          // Validate capacity for increases (per-shift: independent trips)
          if (changes.morningDelta > 0 && newMorning > busData.capacity) {
            throw new Error(`Bus ${busData.busNumber} would exceed morning capacity (${newMorning}/${busData.capacity})`);
          }
          if (changes.eveningDelta > 0 && newEvening > busData.capacity) {
            throw new Error(`Bus ${busData.busNumber} would exceed evening capacity (${newEvening}/${busData.capacity})`);
          }
        }

        // Update all bus documents with new load counts
        for (const [busId, changes] of busLoadChanges) {
          const busInfo = busSnapshots.get(busId)!;
          const busData = busInfo.data;
          const currentLoad = busData.load || { morningCount: 0, eveningCount: 0 };

          const newMorningCount = Math.max(0, (currentLoad.morningCount || 0) + changes.morningDelta);
          const newEveningCount = Math.max(0, (currentLoad.eveningCount || 0) + changes.eveningDelta);

          transaction.update(busInfo.ref, {
            'load.morningCount': newMorningCount,
            'load.eveningCount': newEveningCount,
            currentMembers: newMorningCount + newEveningCount,
            updatedAt: serverTimestamp()
          });

          console.log(`🚌 Bus ${busId}: morning ${currentLoad.morningCount || 0}→${newMorningCount}, evening ${currentLoad.eveningCount || 0}→${newEveningCount}`);
        }

        // Update student documents — including the NEW shift
        for (const plan of plans) {
          const studentRef = doc(db, 'students', plan.studentId);

          // Get target bus info for routeId
          const targetBusInfo = busSnapshots.get(plan.toBusId);
          const targetRouteId = targetBusInfo?.data?.route?.routeId || targetBusInfo?.data?.routeId || '';

          // Target Shift: what the student will now have
          const targetShift = normalizeShift(plan.studentShift || studentOriginalShifts.get(plan.studentId) || 'Morning');

          transaction.update(studentRef, {
            busId: plan.toBusId,
            routeId: targetRouteId,
            shift: targetShift,
            updatedAt: serverTimestamp()
          });

          console.log(`👤 Student ${plan.studentId}: moved to bus ${plan.toBusId}, shift → ${targetShift}`);
        }
      });

      console.log('✅ Batch transaction completed successfully');

    } catch (error) {
      console.error('Batch execution failed:', error);
      throw error;
    }
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
    // Each plan stores: studentShift = TARGET shift (what the student now has)
    // For undo: we need to restore the student to their ORIGINAL bus and shift.
    // The ORIGINAL shift is not stored in the plan, so we must read it from Firestore.
    const reversePlans = action.plans.map(plan => ({
      ...plan,
      fromBusId: plan.toBusId,
      toBusId: plan.fromBusId,
      toBusNumber: 'Original',
      // studentShift will be resolved from Firestore in executeBatch (original shift)
      reason: `Undo: ${plan.reason}`
    }));

    // Execute reversal
    await this.executeBatch(reversePlans);

    // Remove from history
    this.undoHistory = this.undoHistory.filter(a => a.id !== actionId);

    // Send undo notifications
    await this.sendUndoNotifications(action.plans);

    console.log('✅ Undo completed successfully');
  }

  async sendNotifications(plans: ReassignmentPlan[], reason: string): Promise<void> {
    try {
      const notificationPromises = [];

      // Group by target bus for driver notifications
      const busPlanGroups = new Map<string, ReassignmentPlan[]>();
      plans.forEach(plan => {
        const existing = busPlanGroups.get(plan.toBusId) || [];
        existing.push(plan);
        busPlanGroups.set(plan.toBusId, existing);
      });

      // Send student notifications
      for (const plan of plans) {
        const notification = {
          title: '🚌 Bus Reassignment',
          content: `You have been reassigned to ${plan.toBusNumber}. Reason: ${reason}`,
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'system'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [plan.studentId]
          },
          recipientIds: [plan.studentId],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          isEdited: false,
          isDeletedGlobally: false,
          createdAt: serverTimestamp(),
          metadata: {
            type: 'reassignment',
            fromBusId: plan.fromBusId,
            toBusId: plan.toBusId,
            reason
          }
        };

        notificationPromises.push(
          this.createNotification(notification)
        );
      }

      // Send driver notifications
      for (const [busId, busPlans] of busPlanGroups) {
        const busDoc = await getDoc(doc(db, 'buses', busId));
        if (busDoc.exists() && busDoc.data().driverId) {
          const notification = {
            title: '👥 New Students Assigned',
            content: `${busPlans.length} new student(s) have been assigned to your bus. Reason: ${reason}`,
            sender: {
              userId: 'system',
              userName: 'System',
              userRole: 'system'
            },
            target: {
              type: 'specific_users',
              specificUserIds: [busDoc.data().driverId]
            },
            recipientIds: [busDoc.data().driverId],
            autoInjectedRecipientIds: [],
            readByUserIds: [],
            isEdited: false,
            isDeletedGlobally: false,
            createdAt: serverTimestamp(),
            metadata: {
              type: 'reassignment',
              studentCount: busPlans.length,
              reason
            }
          };

          notificationPromises.push(
            this.createNotification(notification)
          );
        }
      }

      await Promise.all(notificationPromises);
      console.log(`📧 Sent ${notificationPromises.length} notifications`);

    } catch (error) {
      console.error('Failed to send notifications:', error);
      // Don't throw - notifications are not critical
    }
  }

  async sendUndoNotifications(plans: ReassignmentPlan[]): Promise<void> {
    try {
      const notificationPromises = [];

      for (const plan of plans) {
        const notification = {
          title: '⏪ Reassignment Undone',
          content: `Your bus reassignment has been undone. You are back on your original bus.`,
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'system'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [plan.studentId]
          },
          recipientIds: [plan.studentId],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          isEdited: false,
          isDeletedGlobally: false,
          createdAt: serverTimestamp(),
          metadata: {
            type: 'reassignment_undo'
          }
        };

        notificationPromises.push(
          this.createNotification(notification)
        );
      }

      await Promise.all(notificationPromises);

    } catch (error) {
      console.error('Failed to send undo notifications:', error);
    }
  }

  private async createNotification(notification: any): Promise<void> {
    try {
      const notificationsRef = collection(db, 'notifications');
      await addDoc(notificationsRef, notification);
    } catch (error) {
      console.error('Failed to create notification:', error);
      throw error;
    }
  }

  getUndoHistory(): UndoAction[] {
    // Clean up expired actions
    this.undoHistory = this.undoHistory.filter(a => a.expiresAt > Date.now());
    return this.undoHistory;
  }

  clearUndoHistory(): void {
    this.undoHistory = [];
  }
}
