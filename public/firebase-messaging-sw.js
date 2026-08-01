// Firebase Cloud Messaging Service Worker
// This file MUST be accessible at /firebase-messaging-sw.js (root path).

// Import Firebase SDK - version MUST match client firebase package.
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js');

function toSafeAppPath(value) {
  if (typeof value !== 'string') return '/';

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.startsWith('/api/')) {
    return '/';
  }

  try {
    const url = new URL(trimmed, self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

const urlParams = new URL(location).searchParams;
const firebaseConfig = {
  apiKey: urlParams.get('apiKey'),
  authDomain: urlParams.get('authDomain'),
  projectId: urlParams.get('projectId'),
  storageBucket: urlParams.get('storageBucket'),
  messagingSenderId: urlParams.get('messagingSenderId'),
  appId: urlParams.get('appId'),
};

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    firebase.initializeApp(firebaseConfig);
  } else {
    console.warn('Firebase config missing in SW. Push notifications may fail.');
  }
} catch {
  console.error('Firebase init failed in SW.');
}

let messaging;
try {
  messaging = firebase.messaging();
} catch {
  console.error('Firebase Messaging init failed.');
}

// When the app is not in focus, FCM delivers data-only messages here.
if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    try {
      const data = payload.data || {};

      // If FCM SDK will auto-show a notification payload, skip manual display.
      if (payload.notification) {
        return;
      }

      let title = 'Bus Notification';
      let body = 'You have a new notification';
      let clickUrl = '/';

      if (data.type === 'TRIP_STARTED' || data.type === 'trip_started') {
        title = 'Bus Journey Started!';
        body = data.routeName
          ? `Your bus for ${data.routeName} has started its journey. Track it live now!`
          : 'Your bus has started its journey. Track it live now!';
        clickUrl = '/student/track-bus';
      } else if (data.type === 'TRIP_ENDED' || data.type === 'trip_ended') {
        title = 'Trip Ended';
        body = data.routeName
          ? `Your bus trip for ${data.routeName} has ended.`
          : 'Your bus trip has ended.';
        clickUrl = '/student';
      }

      const options = {
        body,
        icon: data.icon || '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: String(data.tripId || `bus-${data.type || 'notification'}`).slice(0, 80),
        requireInteraction: data.type === 'TRIP_STARTED',
        data: { ...data, click_action: toSafeAppPath(clickUrl) },
      };

      if (data.type === 'TRIP_STARTED' || data.type === 'trip_started') {
        options.actions = [{ action: 'open', title: 'Track Bus' }];
      }

      return self.registration.showNotification(title, options);
    } catch {
      console.error('Error showing notification.');
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let clickUrl = '/';

  if (data.click_action) {
    clickUrl = toSafeAppPath(data.click_action);
  } else if (data.FCM_MSG?.data) {
    const fcmData = data.FCM_MSG.data;
    if (fcmData.type === 'TRIP_STARTED' || fcmData.type === 'trip_started') {
      clickUrl = '/student/track-bus';
    }
  } else if (data.type === 'TRIP_STARTED' || data.type === 'trip_started') {
    clickUrl = '/student/track-bus';
  }

  clickUrl = toSafeAppPath(clickUrl);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          try {
            return client.focus().then(() => client.navigate(clickUrl));
          } catch {
            continue;
          }
        }
        return clients.openWindow(clickUrl);
      })
      .catch(() => clients.openWindow('/'))
  );
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
