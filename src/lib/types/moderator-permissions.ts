/**
 * Moderator Permission Configuration
 * 
 * This defines all granular permissions that an admin can configure
 * for each moderator. Stored in Firestore at `moderators/{modId}/permissions`.
 * 
 * Security Note: These permissions are enforced BOTH client-side (for UX) 
 * AND server-side (in API routes) to prevent bypass.
 */

export interface ModeratorPermissions {
  // ═══════════════════════════════════════════════
  // STUDENT OPERATIONS
  // ═══════════════════════════════════════════════
  students: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Student reassignment (smart-allocation)
  };

  // ═══════════════════════════════════════════════
  // DRIVER OPERATIONS
  // ═══════════════════════════════════════════════
  drivers: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Driver reassignment (driver-assignment)
  };

  // ═══════════════════════════════════════════════
  // BUS OPERATIONS
  // ═══════════════════════════════════════════════
  buses: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Bus route reassignment (route-allocation)
  };

  // ═══════════════════════════════════════════════
  // ROUTE OPERATIONS
  // ═══════════════════════════════════════════════
  routes: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };

  // ═══════════════════════════════════════════════
  // APPLICATION & VERIFICATION OPERATIONS
  // ═══════════════════════════════════════════════
  applications: {
    canView: boolean;
    canApprove: boolean;       // Approve student application forms
    canReject: boolean;         // Reject student application forms
    canGenerateVerificationCode: boolean;  // Generate/manage verification codes
    canAppearInModeratorList: boolean;      // Show in student apply form's moderator dropdown
  };

  // ═══════════════════════════════════════════════
  // OFFLINE PAYMENT OPERATIONS
  // ═══════════════════════════════════════════════
  payments: {
    canApproveOfflinePayment: boolean;   // Approve offline payments
    canRejectOfflinePayment: boolean;    // Reject offline payments
  };
}

/**
 * Default permissions for a newly added moderator.
 * By default, moderators can view everything but cannot modify or approve anything.
 * Admin must explicitly grant write/approve permissions.
 */
export const DEFAULT_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  drivers: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  buses: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  routes: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
  },
  applications: {
    canView: true,
    canApprove: false,
    canReject: false,
    canGenerateVerificationCode: false,
    canAppearInModeratorList: false,
  },
  payments: {
    canApproveOfflinePayment: false,
    canRejectOfflinePayment: false,
  },
};

/**
 * Full permissions preset - grants all permissions.
 * Used for trusted, senior moderators.
 */
export const FULL_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canReassign: true,
  },
  drivers: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canReassign: true,
  },
  buses: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canReassign: true,
  },
  routes: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
  },
  applications: {
    canView: true,
    canApprove: true,
    canReject: true,
    canGenerateVerificationCode: true,
    canAppearInModeratorList: true,
  },
  payments: {
    canApproveOfflinePayment: true,
    canRejectOfflinePayment: true,
  },
};

/**
 * Zero permissions preset - all actions revoked/disabled.
 * Used when moderator access is suspended or revoked.
 */
export const ZERO_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  drivers: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  buses: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  routes: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
  },
  applications: {
    canView: false,
    canApprove: false,
    canReject: false,
    canGenerateVerificationCode: false,
    canAppearInModeratorList: false,
  },
  payments: {
    canApproveOfflinePayment: false,
    canRejectOfflinePayment: false,
  },
};

/**
 * Merge partial permissions with defaults for backward compatibility.
 */
export function mergeWithDefaults(partial?: Partial<ModeratorPermissions>): ModeratorPermissions {
  return {
    students: { ...DEFAULT_MODERATOR_PERMISSIONS.students, ...(partial?.students || {}) },
    drivers: { ...DEFAULT_MODERATOR_PERMISSIONS.drivers, ...(partial?.drivers || {}) },
    buses: { ...DEFAULT_MODERATOR_PERMISSIONS.buses, ...(partial?.buses || {}) },
    routes: { ...DEFAULT_MODERATOR_PERMISSIONS.routes, ...(partial?.routes || {}) },
    applications: { ...DEFAULT_MODERATOR_PERMISSIONS.applications, ...(partial?.applications || {}) },
    payments: { ...DEFAULT_MODERATOR_PERMISSIONS.payments, ...(partial?.payments || {}) },
  };
}

/**
 * Permission category labels for the UI
 */
export const PERMISSION_CATEGORIES = {
  students: {
    label: 'Student Management',
    icon: 'Users',
    color: 'blue',
    permissions: {
      canView: 'View Students',
      canAdd: 'Add Students',
      canEdit: 'Edit Students',
      canDelete: 'Delete Students',
      canReassign: 'Student Reassignment',
    },
  },
  drivers: {
    label: 'Driver Management',
    icon: 'UserCog',
    color: 'indigo',
    permissions: {
      canView: 'View Drivers',
      canAdd: 'Add Drivers',
      canEdit: 'Edit Drivers',
      canDelete: 'Delete Drivers',
      canReassign: 'Driver Reassignment',
    },
  },
  buses: {
    label: 'Bus Management',
    icon: 'Bus',
    color: 'amber',
    permissions: {
      canView: 'View Buses',
      canAdd: 'Add Buses',
      canEdit: 'Edit Buses',
      canDelete: 'Delete Buses',
      canReassign: 'Bus Route Reassignment',
    },
  },
  routes: {
    label: 'Route Management',
    icon: 'MapPin',
    color: 'emerald',
    permissions: {
      canView: 'View Routes',
      canAdd: 'Add Routes',
      canEdit: 'Edit Routes',
      canDelete: 'Delete Routes',
    },
  },
  applications: {
    label: 'Applications & Verification',
    icon: 'ClipboardCheck',
    color: 'orange',
    permissions: {
      canView: 'View Applications',
      canApprove: 'Approve Applications',
      canReject: 'Reject Applications',
      canGenerateVerificationCode: 'Generate Verification Codes',
      canAppearInModeratorList: 'Available for Student Application Review',
    },
  },
  payments: {
    label: 'Payment Operations',
    icon: 'CreditCard',
    color: 'purple',
    permissions: {
      canApproveOfflinePayment: 'Approve Offline Payments',
      canRejectOfflinePayment: 'Reject Offline Payments',
    },
  },
} as const;
