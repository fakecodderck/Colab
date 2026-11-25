import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Persist Firebase login state across browser reloads
setPersistence(auth, browserLocalPersistence).catch(() => {
  // fallback to Firebase default persistence
});

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// Keep OAuth access token strictly in memory (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

async function establishServerSession(accessToken: string): Promise<void> {
  await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ColabControl',
    },
    body: JSON.stringify({ accessToken }),
  }).catch(() => {
    // Keep working with in-memory token even if session cookie call fails
  });
}

export async function hasActiveServerDriveSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) return false;
    const data = (await res.json()) as { active?: boolean };
    return Boolean(data.active);
  } catch {
    return false;
  }
}

export const initAuth = (
  onUserSignedIn: (user: User, hasDriveSession: boolean) => void,
  onUserSignedOut: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onUserSignedIn(user, true);
      } else {
        const active = await hasActiveServerDriveSession();
        onUserSignedIn(user, active);
      }
    } else {
      cachedAccessToken = null;
      onUserSignedOut();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Failed to retrieve Google access token.');
  }
  cachedAccessToken = credential.accessToken;
  await establishServerSession(cachedAccessToken);
  return { user: result.user, accessToken: cachedAccessToken };
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const logout = async (): Promise<void> => {
  cachedAccessToken = null;
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'ColabControl' },
  }).catch(() => {});
  await auth.signOut();
};
