import React, { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Tag,
  CheckCircle2,
  Loader2,
  Receipt,
  BookOpen,
  CreditCard,
  AlertTriangle,
} from 'lucide-react';
import { CourseOrderItem, PlatformCourse } from '../types';
import { useAuth } from '../contexts/AuthContext';

export const StoreCartView: React.FC = () => {
  const { user, getIdToken, openAuthModal } = useAuth();
  const [courses, setCourses] = useState<PlatformCourse[]>([]);
  const [enrollments, setEnrollments] = useState<string[]>([]);
  const [orders, setOrders] = useState<CourseOrderItem[]>([]);
  const [cart, setCart] = useState<PlatformCourse[]>([]);
  const [classFilter, setClassFilter] = useState('all');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountAmount: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(true);

  const refreshData = async () => {
    void fetch('/api/platform/courses')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.courses)) setCourses(d.courses);
      })
      .catch(() => {});

    void fetch('/api/platform/setup-status')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setStripeConfigured(Boolean(d.integrations?.stripeConfigured));
      })
      .catch(() => {});

    const token = await getIdToken();
    if (!token) return;
    const [enrRes, ordRes] = await Promise.all([
      fetch('/api/platform/enrollments', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/orders', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const enrData = await enrRes.json().catch(() => ({}));
    const ordData = await ordRes.json().catch(() => ({}));
    if (enrData?.success && Array.isArray(enrData.enrollments)) {
      setEnrollments(enrData.enrollments.map((e: any) => e.courseId));
    }
    if (ordData?.success && Array.isArray(ordData.orders)) {
      setOrders(ordData.orders);
    }
  };

  useEffect(() => {
    void refreshData();
  }, [user]);

  // Verify returning Stripe checkout session if present in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('stripe_session_id');
    if (!sid || !user) return;
    void (async () => {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/payments/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: sid }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.paid) {
        setStatusMsg('Payment verified via Stripe! Course unlocked in your profile.');
        void refreshData();
      } else {
        setErrorMsg(data?.message || 'Could not confirm Stripe payment status.');
      }
    })();
  }, [user, getIdToken]);

  const handleApplyCoupon = async () => {
    setErrorMsg(null);
    const total = cart.reduce((acc, c) => acc + c.price, 0);
    const res = await fetch('/api/payments/validate-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: couponInput.trim(), price: total }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setAppliedCoupon(null);
      setErrorMsg(data?.message || 'Invalid coupon.');
      return;
    }
    setAppliedCoupon({ code: data.coupon.code, discountAmount: data.discountAmount });
    setStatusMsg(`Coupon ${data.coupon.code} applied (-₹${data.discountAmount})!`);
  };

  const handleFreeEnroll = async (course: PlatformCourse) => {
    if (!user) {
      openAuthModal();
      return;
    }
    setBusyCourseId(course.courseId);
    setErrorMsg(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/payments/enroll-free', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ courseId: course.courseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Enrollment failed.');
      setStatusMsg(`Enrolled in ${course.title}!`);
      void refreshData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not enroll.');
    } finally {
      setBusyCourseId(null);
    }
  };

  const handleCheckoutCourse = async (course: PlatformCourse) => {
    if (!user) {
      openAuthModal();
      return;
    }
    setBusyCourseId(course.courseId);
    setErrorMsg(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          courseId: course.courseId,
          couponCode: appliedCoupon?.code || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to start checkout.');
      }
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Checkout failed.');
    } finally {
      setBusyCourseId(null);
    }
  };

  const filteredCourses =
    classFilter === 'all' ? courses : courses.filter((c) => c.classLevel === classFilter);
  const cartTotal = cart.reduce((acc, c) => acc + c.price, 0);
  const finalTotal = Math.max(0, cartTotal - (appliedCoupon?.discountAmount || 0));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-[#22C55E]" />
            <span>Courses, Batches &amp; Checkout</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            Class 9–12, CBSE Boards, JEE &amp; NEET courses with syllabus, timetable, coupons, and Stripe payments.
          </p>
        </div>

        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-bold focus:outline-none"
        >
          <option value="all">All Classes</option>
          <option value="Class 9">Class 9</option>
          <option value="Class 10">Class 10</option>
          <option value="Class 11">Class 11</option>
          <option value="Class 12">Class 12</option>
        </select>
      </div>

      {!stripeConfigured && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <span>
            Paid course checkout requires <code className="font-mono">STRIPE_SECRET_KEY</code> in{' '}
            <code className="font-mono">.env</code> / Secrets. Free courses can be enrolled immediately.
          </span>
        </div>
      )}

      {statusMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-semibold text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Course Catalog */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCourses.map((course) => {
          const enrolled = enrollments.includes(course.courseId);
          const inCart = cart.some((c) => c.courseId === course.courseId);
          return (
            <div
              key={course.courseId}
              className="flex flex-col justify-between rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden shadow-sm"
            >
              <div>
                <div className="aspect-video bg-[var(--bg-tertiary)] overflow-hidden">
                  <img src={course.thumbnail} alt={course.title} className="h-full w-full object-cover" />
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="text-emerald-400">{course.classLevel}</span>
                    <span className="text-[var(--text-secondary)]">{course.category}</span>
                  </div>
                  <h3 className="font-['Sora'] text-base font-extrabold text-[var(--text-primary)]">
                    {course.title}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">{course.facultyName}</p>
                  <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2">{course.syllabus}</p>
                  <div className="text-[11px] font-mono text-emerald-300/90">{course.timetable}</div>
                </div>
              </div>

              <div className="border-t border-[var(--card-border)] p-4 flex items-center justify-between gap-2">
                <div className="font-mono text-base font-extrabold">
                  {course.isFree || course.price === 0 ? 'FREE' : `₹${course.price}`}
                </div>
                {enrolled ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Enrolled
                  </span>
                ) : course.isFree || course.price === 0 ? (
                  <button
                    type="button"
                    disabled={busyCourseId === course.courseId}
                    onClick={() => void handleFreeEnroll(course)}
                    className="rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
                  >
                    {busyCourseId === course.courseId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <BookOpen className="inline h-3.5 w-3.5 mr-1" /> Enroll Free
                      </>
                    )}
                  </button>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setCart((prev) =>
                          inCart ? prev.filter((c) => c.courseId !== course.courseId) : [...prev, course]
                        )
                      }
                      className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs font-bold hover:border-[#22C55E]"
                    >
                      {inCart ? 'In Cart' : 'Add to Cart'}
                    </button>
                    <button
                      type="button"
                      disabled={busyCourseId === course.courseId}
                      onClick={() => void handleCheckoutCourse(course)}
                      className="rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-3.5 py-2 text-xs font-bold text-white transition"
                    >
                      <CreditCard className="inline h-3.5 w-3.5 mr-1" /> Buy
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cart & Coupon Box */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3">
          <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-[#22C55E]" />
            <span>Shopping Cart ({cart.length})</span>
          </h2>
          {cart.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Add paid courses to apply coupon discounts (try <code className="font-mono text-emerald-400">STUDY10</code> or <code className="font-mono text-emerald-400">SCHOLAR20</code>).
            </p>
          ) : (
            <div className="space-y-2.5">
              {cart.map((item) => (
                <div key={item.courseId} className="flex items-center justify-between text-xs border-b border-[var(--card-border)] pb-2">
                  <span className="font-bold">{item.title}</span>
                  <span className="font-mono">₹{item.price}</span>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <div className="relative flex-1">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    placeholder="Coupon code (STUDY10 / SCHOLAR20)"
                    className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] py-2 pl-8 pr-3 text-xs uppercase"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleApplyCoupon()}
                  className="rounded-xl bg-[var(--bg-tertiary)] px-3.5 py-2 text-xs font-bold hover:border-[#22C55E] border border-[var(--card-border)]"
                >
                  Apply
                </button>
              </div>
              <div className="flex items-center justify-between pt-2 text-sm font-extrabold">
                <span>Total Payable</span>
                <span className="font-mono text-emerald-400">₹{finalTotal}</span>
              </div>
              <button
                type="button"
                onClick={() => cart[0] && void handleCheckoutCourse(cart[0])}
                className="w-full rounded-xl bg-[#16A34A] hover:bg-[#22C55E] py-2.5 text-xs font-bold text-white transition"
              >
                Proceed to Stripe Checkout
              </button>
            </div>
          )}
        </div>

        {/* Order History */}
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3">
          <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
            <Receipt className="h-4 w-4 text-[#22C55E]" />
            <span>Order History &amp; Receipts</span>
          </h2>
          {orders.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              No course orders yet. Your purchases and payment statuses appear here.
            </p>
          ) : (
            <div className="space-y-2">
              {orders.map((ord) => (
                <div
                  key={ord.orderId}
                  className="flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2.5 text-xs"
                >
                  <div>
                    <div className="font-bold">{ord.courseTitle}</div>
                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                      {new Date(ord.createdAt).toLocaleDateString()} · #{ord.orderId.slice(-6)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold">₹{ord.amount}</div>
                    <span
                      className={`text-[10px] font-extrabold uppercase ${
                        ord.status === 'paid'
                          ? 'text-emerald-400'
                          : ord.status === 'failed'
                          ? 'text-red-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {ord.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
