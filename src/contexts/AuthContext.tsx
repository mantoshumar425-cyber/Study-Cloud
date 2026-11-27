import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  BOOTSTRAP_ADMIN_EMAIL,
  OperationType,
  handleFirestoreError,
  testConnection,
} from '../lib/firebase';
import { getAdventureMetrics, getAdventureState } from '../services/adventureService';

export interface StudentProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
  targetClass: string;
  targetExam: string;
  email?: string;
  mobile?: string;
  xp: number;
  level: number;
  rankTitle: string;
  currentStreak: number;
  completedCount: number;
}

interface AuthContextValue {
  user: User | null;
  profile: StudentProfile | null;
  authReady: boolean;
  isAdmin: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signupWithEmail: (params: {
    name: string;
    email: string;
    mobile: string;
    password: string;
    targetClass?: string;
    targetExam?: string;
  }) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  reloadSession: () => Promise<boolean>;
  updateStudentProfile: (updates: {
    displayName?: string;
    mobile?: string;
    targetClass?: string;
    targetExam?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const syncUserDocuments = useCallback(
    async (firebaseUser: User, extras?: { name?: string; mobile?: string; targetClass?: string; targetExam?: string }) => {
      const uid = firebaseUser.uid;
      const metrics = getAdventureMetrics(getAdventureState());
      const fallbackName =
        (extras?.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Study Scholar')
          .trim()
          .slice(0, 80);

      let adminFlag =
        firebaseUser.emailVerified &&
        (firebaseUser.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

      try {
        const adminSnap = await getDoc(doc(db, 'admins', uid));
        if (adminSnap.exists() && firebaseUser.emailVerified) {
          adminFlag = true;
        }
      } catch {
        // non-admin read
      }
      setIsAdmin(adminFlag);

      const publicPath = `users/${uid}`;
      const privatePath = `users/${uid}/private/info`;

      let existingPublic: any = null;
      let existingPrivate: any = null;

      try {
        const pubSnap = await getDoc(doc(db, 'users', uid));
        if (pubSnap.exists()) existingPublic = pubSnap.data();
      } catch (err) {
        if (firebaseUser.emailVerified) {
          try {
            handleFirestoreError(err, OperationType.GET, publicPath);
          } catch {
            // logged
          }
        }
      }

      try {
        const privSnap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
        if (privSnap.exists()) existingPrivate = privSnap.data();
      } catch {
        // private doc might not exist yet
      }

      const resolvedProfile: StudentProfile = {
        uid,
        displayName: String(existingPublic?.displayName || fallbackName).slice(0, 80),
        photoURL: existingPublic?.photoURL || firebaseUser.photoURL || undefined,
        targetClass: String(extras?.targetClass || existingPublic?.targetClass || 'Class 12').slice(0, 32),
        targetExam: String(extras?.targetExam || existingPublic?.targetExam || 'IIT-JEE').slice(0, 40),
        email: existingPrivate?.email || firebaseUser.email || undefined,
        mobile: extras?.mobile || existingPrivate?.mobile || '',
        xp: Math.max(Number(existingPublic?.xp || 0), metrics.xp),
        level: Math.max(Number(existingPublic?.level || 1), metrics.level),
        rankTitle: String(existingPublic?.rankTitle || metrics.rank).slice(0, 48),
        currentStreak: Math.max(Number(existingPublic?.currentStreak || 0), metrics.currentStreak),
        completedCount: Math.max(Number(existingPublic?.completedCount || 0), metrics.completedCount),
      };

      setProfile(resolvedProfile);

      if (!firebaseUser.emailVerified) {
        // Security rules require email_verified == true for Firestore writes.
        // Profile stays usable in session until email verification completes.
        return;
      }

      try {
        if (!existingPublic) {
          await setDoc(doc(db, 'users', uid), {
            uid,
            displayName: resolvedProfile.displayName,
            ...(resolvedProfile.photoURL ? { photoURL: resolvedProfile.photoURL.slice(0, 512) } : {}),
            targetClass: resolvedProfile.targetClass,
            targetExam: resolvedProfile.targetExam,
            xp: resolvedProfile.xp,
            level: resolvedProfile.level,
            rankTitle: resolvedProfile.rankTitle,
            currentStreak: resolvedProfile.currentStreak,
            completedCount: resolvedProfile.completedCount,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (!existingPrivate && firebaseUser.email) {
          await setDoc(doc(db, 'users', uid, 'private', 'info'), {
            uid,
            email: firebaseUser.email.slice(0, 160),
            ...(resolvedProfile.mobile ? { mobile: resolvedProfile.mobile.slice(0, 24) } : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, publicPath);
        } catch {
          // keep UI functional while logging diagnostic payload
        }
      }
    },
    []
  );

  useEffect(() => {
    void testConnection();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await syncUserDocuments(u);
      } else {
        setProfile(null);
        setIsAdmin(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [syncUserDocuments]);

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    await syncUserDocuments(cred.user);
    setIsAuthModalOpen(false);
  };

  const loginWithEmail = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    await syncUserDocuments(cred.user);
    setIsAuthModalOpen(false);
  };

  const signupWithEmail = async (params: {
    name: string;
    email: string;
    mobile: string;
    password: string;
    targetClass?: string;
    targetExam?: string;
  }) => {
    const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
    if (params.name.trim()) {
      await updateProfile(cred.user, { displayName: params.name.trim().slice(0, 80) });
    }
    try {
      await sendEmailVerification(cred.user);
    } catch {
      // non-fatal if email verification rate limited
    }
    try {
      localStorage.setItem('studycloud_pending_mobile', params.mobile.trim().slice(0, 24));
      localStorage.setItem('studycloud_player_name_v1', params.name.trim().slice(0, 32));
    } catch {
      // ignore
    }
    await syncUserDocuments(cred.user, {
      name: params.name,
      mobile: params.mobile,
      targetClass: params.targetClass,
      targetExam: params.targetExam,
    });
  };

  const sendVerificationEmail = async () => {
    if (!auth.currentUser) throw new Error('Please sign in first.');
    await sendEmailVerification(auth.currentUser);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const reloadSession = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    setUser(refreshed);
    let pendingMobile = '';
    try {
      pendingMobile = localStorage.getItem('studycloud_pending_mobile') || '';
    } catch {
      // ignore
    }
    await syncUserDocuments(refreshed, pendingMobile ? { mobile: pendingMobile } : undefined);
    return refreshed.emailVerified;
  };

  const updateStudentProfile = async (updates: {
    displayName?: string;
    mobile?: string;
    targetClass?: string;
    targetExam?: string;
  }) => {
    const current = auth.currentUser;
    if (!current) throw new Error('Sign in required.');
    const nextName = (updates.displayName ?? profile?.displayName ?? current.displayName ?? 'Scholar')
      .trim()
      .slice(0, 80);
    if (updates.displayName && updates.displayName.trim()) {
      await updateProfile(current, { displayName: nextName });
    }
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            displayName: nextName,
            mobile: updates.mobile ?? prev.mobile,
            targetClass: updates.targetClass ?? prev.targetClass,
            targetExam: updates.targetExam ?? prev.targetExam,
          }
        : prev
    );

    if (!current.emailVerified) return;

    try {
      await updateDoc(doc(db, 'users', current.uid), {
        displayName: nextName,
        ...(updates.targetClass ? { targetClass: updates.targetClass.slice(0, 32) } : {}),
        ...(updates.targetExam ? { targetExam: updates.targetExam.slice(0, 40) } : {}),
        updatedAt: serverTimestamp(),
      });
      if (updates.mobile !== undefined) {
        await updateDoc(doc(db, 'users', current.uid, 'private', 'info'), {
          mobile: updates.mobile.trim().slice(0, 24),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${current.uid}`);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setProfile(null);
    setIsAdmin(false);
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        isAdmin,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        loginWithGoogle,
        loginWithEmail,
        signupWithEmail,
        sendVerificationEmail,
        resetPassword,
        reloadSession,
        updateStudentProfile,
        logout,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
