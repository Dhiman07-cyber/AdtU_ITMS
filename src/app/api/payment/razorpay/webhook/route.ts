/**
 * Razorpay Webhook Alias Route
 *
 * Delegates directly to the canonical webhook handler at
 * /api/payment/webhook/razorpay so that webhook deliveries configured at
 * either URL path are handled identically with no redirection or payload loss.
 */
export { POST } from '@/app/api/payment/webhook/razorpay/route';
