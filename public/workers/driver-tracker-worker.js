/**
 * Driver Tracker Web Worker Ticker
 * 
 * Provides an unthrottled 3-second background interval ticker that does not
 * get suspended or throttled to 1 minute by mobile browsers (Safari / Chrome)
 * when the driver switches to another app (e.g. phone call, navigation, WhatsApp).
 */
let timer = null;

self.onmessage = function (e) {
  const data = e.data;
  const command = typeof data === 'string' ? data : data?.command;

  if (command === 'start' || command === 'START_TICKER') {
    if (timer) clearInterval(timer);
    const intervalMs = (typeof data === 'object' && data.intervalMs) || 3000;
    timer = setInterval(function () {
      self.postMessage('tick');
    }, intervalMs);
  } else if (command === 'stop' || command === 'STOP_TICKER') {
    if (timer) clearInterval(timer);
    timer = null;
  }
};
