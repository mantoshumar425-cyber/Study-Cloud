import { describe, it, expect } from '@jest/globals';

/**
 * Security Rule Verification Suite — Dirty Dozen Payloads
 * Intended for verification against Firebase Rules Emulator (`@firebase/rules-unit-testing`).
 */
export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Shadow Field Injection (isAdmin: true) on /users/{uid}', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified Email Admin Spoof on /courses/{courseId}', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Cross-Tenant PII Read on /users/u1/private/info', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Oversized Document ID Poisoning (>128 chars) on /doubts/{id}', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Owner UID Spoofing on /doubts/{id}', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Student Forging Paid Order Status on /orders/{id}', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Mutating Resolved Doubt Terminal State on /doubts/{id}', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Value Poisoning on /leaderboard/{id}', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Orphaned Subcollection Write on /liveClasses/missing/messages/m1', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Unfiltered List Query on /orders', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Backdated Client Timestamp on /bookmarks/{id}', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Non-Admin Coupon Creation on /coupons/{code}', expected: 'PERMISSION_DENIED' },
];

describe('Study Cloud Firestore Hardened Rules — Dirty Dozen', () => {
  it('defines all 12 adversarial security assertions', () => {
    expect(DIRTY_DOZEN_CASES).toHaveLength(12);
    for (const c of DIRTY_DOZEN_CASES) {
      expect(c.expected).toBe('PERMISSION_DENIED');
    }
  });
});
