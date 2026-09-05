# Student Applications, Verification & Digital Bus Passes

## 1. Application Lifecycle

Students enroll in university bus services by completing an online registration form (`/apply`). Each submission creates an immutable record in the `applications` table.

```
       ┌─────────────────────────────┐
       │          SUBMITTED          │
       │ (Student completes form &   │
       │  submits ID / proof of fee) │
       └──────────────┬──────────────┘
                      │
       ┌──────────────┴──────────────┐
       ▼ Moderator checks documents  ▼ Documents invalid
┌─────────────────────────────┐┌─────────────────────────────┐
│          VERIFIED           ││          REJECTED           │
│ (Eligible for seat booking) ││ (Student notified to amend) │
└──────────────┬──────────────┘└─────────────────────────────┘
               │
               ▼ Payment Completed & Seat Allocated
┌─────────────────────────────┐
│          APPROVED           │
│ - student_profiles created  │
│ - Digital QR Pass issued    │
│ - Assigned to Route / Bus   │
└─────────────────────────────┘
```

---

## 2. Dynamic QR Pass Architecture

Once approved, a student's mobile dashboard (`/student`) renders their digital bus pass. The pass contains an encrypted, time-sensitive QR code:

### QR Code Data Contract (`src/domains/trip/qr-contract.ts`):
```json
{
  "studentUid": "usr_stu_109284",
  "enrollmentId": "ADTU/2026/CS/042",
  "busId": "BUS-102",
  "routeId": "ROUTE-01",
  "validUntil": "2027-06-30T00:00:00.000Z",
  "issuedAt": 1772701200000,
  "signature": "hmac_sha256_hash"
}
```

- **Offline Verifiability**: The QR payload includes the student's enrollment ID, bus ID, and a cryptographic HMAC signature generated with server keys. Drivers can scan the QR code even if cellular internet connectivity is temporarily degraded inside rural transit zones.
- **Anti-Screenshot Tampering**: The pass UI displays an animated pulsing security watermark and dynamic system timestamp to prevent students from sharing static screenshots.

---

## 3. Boarding Scanner Workflow (`/api/driver/scan-pass`)

When students board at their morning pickup stop, the driver taps the onboard scanner:

1. **Camera Feed Scanning**: Uses `jsqr` on the driver's mobile browser to read the student's QR pass.
2. **Context Validation**:
   - Compares the pass's `busId` against the driver's current active trip.
   - Verifies that `valid_until > now()`.
   - Checks if `hard_block` has been tripped.
3. **Audio-Visual Feedback**:
   - **Green Beep (`BOARDED`)**: Valid pass matching the bus. Increments onboard student count.
   - **Yellow Beep (`GRACE_PERIOD`)**: Fee payment approaching expiry; warning displayed.
   - **Red Buzzer (`DENIED`)**: Expired pass, wrong bus assignment, or revoked access.
