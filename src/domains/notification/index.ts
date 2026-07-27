// D10 Notification — public surface. Only this file may be imported by other domains.
//
// Business capabilities only. Permission engines, recipient resolution,
// and visibility logic remain internal implementation details.
//
// D10.4 ACTIVE: All reads and writes go through PostgreSQL.
// Firestore notification collection is now read-only (frozen pending removal).
export {
  createNotification,
  editNotification,
  deleteNotificationGlobally,
  markAsRead,
  findById,
  findByUser,
  isNotificationVisibleToUser,
} from './services/notification.service';
