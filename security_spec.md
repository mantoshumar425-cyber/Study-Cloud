# Study Cloud — Firestore Security Architecture & Specification

## 1. Data Invariants & Master Gate Boundaries
1. **Default Deny**: Root `match /{document=**} { allow read, write: if false; }` is enforced first.
2. **PII Isolation**: Emails and mobile numbers live exclusively in `/users/{userId}/private/info` and are strictly readable/writable only by `isOwner(userId)` or `isAdmin()`. Public leaderboard entries live in `/leaderboard/{playerId}` without any email or mobile fields.
3. **Verified Identity & Anti-Spoofing**: All authenticated writes require `request.auth.token.email_verified == true`. Bootstrap admin check requires BOTH `request.auth.token.email == 'mantoshumar425@gmail.com'` AND `request.auth.token.email_verified == true`.
4. **Master Gates**:
   - `/courses/{courseId}/enrollments/{userId}` verifies `exists(/databases/$(database)/documents/courses/$(courseId))` on create.
   - `/liveClasses/{classId}/attendance/{userId}` and `/liveClasses/{classId}/messages/{messageId}` verify `exists(/databases/$(database)/documents/liveClasses/$(classId))`.
   - `/dpps/{dppId}/submissions/{userId}` verifies `exists(/databases/$(database)/documents/dpps/$(dppId))`.
   - `/tests/{testId}/attempts/{attemptId}` verifies `exists(/databases/$(database)/documents/tests/$(testId))`.
5. **Terminal State Locking**:
   - `/doubts/{doubtId}` with `status == 'resolved'` cannot be mutated by non-admins.
   - `/orders/{orderId}` with `status == 'paid'` cannot be mutated by non-admins.
6. **Temporal Integrity & Immortals**:
   - `createdAt == request.time` on create; `incoming().createdAt == existing().createdAt` and `incoming().updatedAt == request.time` on update.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on User Profile**: `{ uid: "u1", displayName: "Alice", xp: 100, level: 1, createdAt: serverTimestamp, updatedAt: serverTimestamp, isAdmin: true, role: "superadmin" }` -> Rejected by `keys().hasOnly(...)`.
2. **Unverified Admin Email Spoof**: Token `{ uid: "evil", email: "mantoshumar425@gmail.com", email_verified: false }` creating `/courses/c1` -> Rejected by `isVerified()`.
3. **Cross-Tenant PII Read**: User `u2` calling `get(/users/u1/private/info)` -> Rejected by `isOwner(userId) || isAdmin()`.
4. **Oversized Document ID Poisoning**: Creating `/doubts/${"A".repeat(200)}` -> Rejected by `isValidId(doubtId)`.
5. **Owner UID Spoofing on Doubt Ticket**: User `u1` creating `/doubts/d1` with `{ userId: "u2", ... }` -> Rejected by `incoming().userId == request.auth.uid`.
6. **Student Self-Resolving Paid Order**: User `u1` updating `/orders/ord1` to `{ status: "paid" }` -> Rejected (only admin or server verifies Stripe payment; student cannot forge `paid` status).
7. **Mutating Terminal Resolved Doubt**: User `u1` updating `/doubts/d1` after `existing().status == "resolved"` -> Rejected by terminal lock.
8. **Invalid Type/Value Poisoning on Leaderboard**: User `u1` updating `/leaderboard/u1` with `{ xp: "999999999", extra: 1 }` -> Rejected by `isValidLeaderboardSummary()`.
9. **Orphaned Live Class Message**: User `u1` creating `/liveClasses/nonexistent/messages/m1` -> Rejected by Master Gate `exists(/databases/$(database)/documents/liveClasses/nonexistent)`.
10. **Blanket List Query Scraping on Orders**: User `u1` calling `list(/orders)` without `where("userId", "==", "u1")` -> Rejected by `resource.data.userId == request.auth.uid || isBootstrapAdmin()`.
11. **Backdated Timestamp Tampering**: Creating `/bookmarks/b1` with `createdAt: Timestamp(2020-01-01)` -> Rejected by `incoming().createdAt == request.time`.
12. **Client-Side Coupon Creation**: Regular student `u1` creating `/coupons/FREE100` -> Rejected by `isAdmin()`.
