/* ============================================================
   AUTH.JS — Firebase Authentication for PrepTare
   ============================================================
   Handles: sign-up, sign-in, SSO (Google/Apple/Facebook),
   sign-out, password reset, and Firestore profile management.

   SETUP REQUIRED:
   1. Go to https://console.firebase.google.com
   2. Create a project called "PrepTare"
   3. Add a Web app → copy the firebaseConfig object below
   4. In Authentication → Sign-in method, enable:
        Email/Password, Google, Apple, Facebook
   5. In Firestore Database, create a database (production mode)
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyAN_edabxX5JP4eZU_sGjqbcqRYbpfKa9c',
  authDomain:        'preptare.firebaseapp.com',
  projectId:         'preptare',
  storageBucket:     'preptare.firebasestorage.app',
  messagingSenderId: '750579781191',
  appId:             '1:750579781191:web:913659fc4871c36914ab62',
  measurementId:     'G-JL1EYKYKW2',
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

// Currently signed-in user and their Firestore profile
let currentUser    = null;
let currentProfile = null;

/* ── Auth state router ───────────────────────────────────── */

auth.onAuthStateChanged(async (user) => {
  hideLoadingScreen();
  if (!user) {
    showAuthScreen();
    return;
  }
  currentUser = user;
  try {
    const profile = await loadUserProfile(user.uid);
    currentProfile = profile;
    if (!profile || !profile.onboardingComplete) {
      showOnboardingScreen(user, profile);
    } else {
      hideAuthScreen();
      initMainApp(profile);
    }
  } catch (err) {
    console.error('PrepTare: profile load failed', err);
    showAuthError('Could not load your profile. Please try again.');
    showAuthScreen();
  }
});

/* ── Email / Password ────────────────────────────────────── */

async function authSignUp(email, password, displayName) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  if (displayName) await cred.user.updateProfile({ displayName });
  return cred.user;
}

async function authSignIn(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

async function authSendPasswordReset(email) {
  await auth.sendPasswordResetEmail(email);
}

/* ── SSO providers ───────────────────────────────────────── */

async function authSignInWithGoogle() {
  // On Capacitor iOS/Android: swap this for
  //   import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
  //   const result = await FirebaseAuthentication.signInWithGoogle();
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await auth.signInWithPopup(provider);
  return cred.user;
}

async function authSignInWithApple() {
  // Apple Sign-In is required for App Store submissions on iOS.
  // Additional setup: register your app in Apple Developer portal and
  // configure the Apple provider in Firebase Console.
  const provider = new firebase.auth.OAuthProvider('apple.com');
  provider.addScope('name');
  provider.addScope('email');
  const cred = await auth.signInWithPopup(provider);
  return cred.user;
}

async function authSignInWithFacebook() {
  // Facebook requires a Meta developer app + Facebook Login product.
  const provider = new firebase.auth.FacebookAuthProvider();
  const cred = await auth.signInWithPopup(provider);
  return cred.user;
}

async function authSignOut() {
  await auth.signOut();
  currentUser    = null;
  currentProfile = null;
  hideMainApp();
  showAuthScreen();
}

/* ── Firestore profile ───────────────────────────────────── */

async function loadUserProfile(uid) {
  const doc = await db.collection('users').doc(uid).get();
  return doc.exists ? doc.data() : null;
}

async function saveUserProfile(uid, data) {
  await db.collection('users').doc(uid).set(data, { merge: true });
}

/* ── Auth form UI ────────────────────────────────────────── */

let _authMode = 'signin'; // 'signin' | 'signup'

function switchAuthTab(mode) {
  _authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  document.getElementById('auth-name-row').classList.toggle('hidden', mode !== 'signup');
  document.getElementById('auth-forgot-btn').classList.toggle('hidden', mode !== 'signin');
  document.getElementById('auth-submit-btn').textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
  const pwdInput = document.getElementById('auth-password');
  pwdInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  clearAuthError();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  clearAuthError();
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name     = document.getElementById('auth-name').value.trim();
  const btn      = document.getElementById('auth-submit-btn');

  btn.disabled    = true;
  btn.textContent = _authMode === 'signup' ? 'Creating account…' : 'Signing in…';

  try {
    if (_authMode === 'signup') {
      await authSignUp(email, password, name);
    } else {
      await authSignIn(email, password);
    }
    // onAuthStateChanged fires next and handles routing
  } catch (err) {
    showAuthError(friendlyAuthError(err));
    btn.disabled    = false;
    btn.textContent = _authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
}

async function handleSSOSignIn(provider) {
  clearAuthError();
  try {
    if (provider === 'google')   await authSignInWithGoogle();
    if (provider === 'apple')    await authSignInWithApple();
    if (provider === 'facebook') await authSignInWithFacebook();
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAuthError(friendlyAuthError(err));
    }
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) {
    showAuthError('Enter your email address first, then click "Forgot password?"');
    return;
  }
  try {
    await authSendPasswordReset(email);
    showAuthError('Password reset email sent — check your inbox.', 'success');
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  }
}

function friendlyAuthError(err) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/too-many-requests':    'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/account-exists-with-different-credential':
      'An account already exists with this email using a different sign-in method.',
  };
  return map[err.code] || err.message || 'Something went wrong. Please try again.';
}

function showAuthError(msg, type = 'error') {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.className = `auth-error auth-error--${type}`;
}

function clearAuthError() {
  const el = document.getElementById('auth-error');
  el.textContent = '';
  el.className = 'auth-error hidden';
}

/* ── Screen visibility helpers ───────────────────────────── */

function showLoadingScreen() {
  document.getElementById('loading-screen').classList.remove('hidden');
}

function hideLoadingScreen() {
  document.getElementById('loading-screen').classList.add('hidden');
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  hideMainApp();
}

function hideAuthScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('app-wrapper').classList.remove('hidden');
}

function hideMainApp() {
  document.getElementById('app-wrapper').classList.add('hidden');
}
