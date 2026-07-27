/**
 * Global Error Classification Framework
 */

import { CanonicalErrorClass } from './types';

export class OperationalError extends Error {
  public readonly errorClass: CanonicalErrorClass;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    errorClass: CanonicalErrorClass = CanonicalErrorClass.INTERNAL_ERROR,
    statusCode = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.errorClass = errorClass;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function classifyError(error: unknown): { errorClass: CanonicalErrorClass; message: string; stack?: string } {
  if (error instanceof OperationalError) {
    return {
      errorClass: error.errorClass,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    let errorClass: CanonicalErrorClass = CanonicalErrorClass.INTERNAL_ERROR;

    if (msg.includes('auth') || msg.includes('jwt') || msg.includes('token') || msg.includes('unauthorized')) {
      errorClass = CanonicalErrorClass.AUTHENTICATION_ERROR;
    } else if (msg.includes('forbidden') || msg.includes('permission') || msg.includes('role')) {
      errorClass = CanonicalErrorClass.AUTHORIZATION_ERROR;
    } else if (msg.includes('validation') || msg.includes('invalid') || msg.includes('schema')) {
      errorClass = CanonicalErrorClass.VALIDATION_ERROR;
    } else if (msg.includes('database') || msg.includes('postgres') || msg.includes('supabase') || msg.includes('query')) {
      errorClass = CanonicalErrorClass.DATABASE_ERROR;
    } else if (msg.includes('timeout')) {
      errorClass = CanonicalErrorClass.TIMEOUT_ERROR;
    } else if (msg.includes('network') || msg.includes('fetch')) {
      errorClass = CanonicalErrorClass.NETWORK_ERROR;
    } else if (msg.includes('gps') || msg.includes('location')) {
      errorClass = CanonicalErrorClass.GPS_ERROR;
    } else if (msg.includes('payment') || msg.includes('razorpay')) {
      errorClass = CanonicalErrorClass.PAYMENT_ERROR;
    } else if (msg.includes('websocket') || msg.includes('ws')) {
      errorClass = CanonicalErrorClass.WEBSOCKET_ERROR;
    }

    return {
      errorClass,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    errorClass: CanonicalErrorClass.INTERNAL_ERROR,
    message: String(error),
  };
}
