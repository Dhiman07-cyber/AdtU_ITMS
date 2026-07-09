// D10 Notification — public surface. Only this file may be imported by other domains.
//
// Business capabilities only. Permission engines, recipient resolution,
// and visibility logic remain internal implementation details.
export {
  createNotification,
  editNotification,
  deleteNotificationGlobally,
  markAsRead,
} from './services/notification.service';
