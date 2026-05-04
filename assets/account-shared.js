// HiveKeeper Account Pages — Shared JavaScript
// Used by /signin, /account, /subscribe
// ──────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://hknauovhcfsfszyilnrw.sb.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbmF1b3ZoY2ZzZnN6eWlsbnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1Nzg5NDQsImV4cCI6MjA5MTE1NDk0NH0.91IpVcQjz5LG6yhAZFOYtPMVHMUGxUgp7V5sKCCnIAk';
const WORKER_BASE = 'https://flat-bird-f269.chris-culshaw.workers.dev';

// Stripe price IDs — matched to those in worker-v11-complete.js
const STRIPE_PRICES = {
  pro:        { monthly: 'price_1TNCyAAh8P0KJ902MTxVDORr', yearly: 'price_1TNCyAAh8P0KJ902k9tO6tQp' },
  commercial: { monthly: 'price_1TND0jAh8P0KJ902RfPHztx5', yearly: 'price_1TND15Ah8P0KJ902AsaDBIAS' }
};

// Initialise Supabase client (loaded from CDN in HTML).
// IMPORTANT: the CDN library exposes itself as `window.supabase`. We must NOT
// redeclare a top-level `supabase` here — that would shadow / collide with
// the library namespace and break the page. Use `sb` for the client instance
// instead, and expose it on window so inline page scripts can reach it.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.sb = sb;

// ─── AUTH STATE ─────────────────────────────────────────────

async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    console.warn('getSession error:', error.message);
    return null;
  }
  return data.session;
}

async function getUser() {
  const session = await getSession();
  return session ? session.user : null;
}

async function requireAuth(redirectTo = '/signin') {
  // Block page render until we know auth state. If not signed in, redirect.
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo + '?return=' + encodeURIComponent(window.location.pathname);
    return null;
  }
  return session;
}

async function redirectIfAuth(target = '/account') {
  // For /signin — if user is already authed, send to /account
  const session = await getSession();
  if (session) {
    const params = new URLSearchParams(window.location.search);
    const ret = params.get('return');
    window.location.href = ret || target;
  }
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = '/signin';
}

// ─── PROFILE ────────────────────────────────────────────────

async function getProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.warn('getProfile error:', error.message);
    return null;
  }
  return data;
}

// ─── STRIPE CHECKOUT ────────────────────────────────────────

async function startCheckout(tier, period) {
  // tier: 'pro' or 'commercial'
  // period: 'monthly' or 'yearly'
  const session = await getSession();
  if (!session) {
    window.location.href = '/signin?return=/subscribe';
    return;
  }
  const priceId = STRIPE_PRICES[tier] && STRIPE_PRICES[tier][period];
  if (!priceId) {
    showToast('Plan not available — please contact support@gethivekeeper.com', 'error');
    return;
  }

  const successUrl = 'https://gethivekeeper.com/account?upgrade=success';
  const cancelUrl  = 'https://gethivekeeper.com/subscribe?cancelled=1';

  try {
    const resp = await fetch(WORKER_BASE + '/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceId: priceId,
        userId: session.user.id,
        userEmail: session.user.email,
        successUrl: successUrl,
        cancelUrl: cancelUrl
      })
    });
    const data = await resp.json();
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Could not start checkout');
    }
  } catch (err) {
    console.error('startCheckout error:', err);
    showToast('Could not start checkout — please try again or contact support@gethivekeeper.com', 'error');
  }
}

async function openCustomerPortal() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/signin?return=/account';
    return;
  }
  try {
    const resp = await fetch(WORKER_BASE + '/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: session.user.id,
        returnUrl: 'https://gethivekeeper.com/account'
      })
    });
    const data = await resp.json();
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Could not open portal');
    }
  } catch (err) {
    console.error('openCustomerPortal error:', err);
    showToast('Could not open subscription manager — please try again or contact support@gethivekeeper.com', 'error');
  }
}

// ─── ACCOUNT ACTIONS ────────────────────────────────────────

async function changePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

async function deleteAccount() {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const resp = await fetch(WORKER_BASE + '/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token
    },
    body: JSON.stringify({})
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Could not delete account');
  return data;
}

async function exportData() {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const userId = session.user.id;

  const tablesByUserId = [
    'apiaries', 'hives', 'inspections', 'treatments', 'varroa_counts',
    'harvests', 'honey_stock', 'equipment', 'inventory_movements',
    'swarm_catches', 'hive_movements', 'sprays', 'landmarks', 'rows',
    'referrals', 'analytics_events'
  ];

  const data = {
    _meta: {
      exportedAt: new Date().toISOString(),
      userId: userId,
      userEmail: session.user.email,
      source: 'gethivekeeper.com/account',
      note: 'This is a complete export of your HiveKeeper data.'
    }
  };

  const profileRes = await sb.from('profiles').select('*').eq('id', userId).single();
  data.profile = profileRes.data || null;

  for (const t of tablesByUserId) {
    const res = await sb.from(t).select('*').eq('user_id', userId);
    data[t] = res.data || [];
  }

  // apiary_shares — owner OR shared-with
  const sharesAsOwner = await sb.from('apiary_shares').select('*').eq('owner_user_id', userId);
  const sharesAsShared = await sb.from('apiary_shares').select('*').eq('shared_with_user_id', userId);
  data.apiary_shares = {
    owned: sharesAsOwner.data || [],
    shared_with_me: sharesAsShared.data || []
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = 'hivekeeper-export-' + dateStr + '.json';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  return fileName;
}

// ─── TOAST NOTIFICATIONS ────────────────────────────────────

function showToast(message, type = 'info', durationMs = 4000) {
  let toast = document.getElementById('hk-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'hk-toast';
    toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%) translateY(-30px);background:var(--forest);color:var(--cream);padding:14px 22px;border-radius:8px;font-family:var(--ui);font-size:14px;font-weight:500;box-shadow:0 10px 30px rgba(0,0,0,0.2);z-index:300;opacity:0;transition:all 0.3s;max-width:90vw;text-align:center;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  // Type-specific styling
  if (type === 'error') { toast.style.background = '#991b1b'; toast.style.color = '#faf5e9'; }
  else if (type === 'success') { toast.style.background = '#2a7a3e'; toast.style.color = '#faf5e9'; }
  else { toast.style.background = '#1F4E3A'; toast.style.color = '#faf5e9'; }

  // Show
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  // Hide after duration
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-30px)';
  }, durationMs);
}

// ─── HELPERS ────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return '—'; }
}

function formatTier(profile) {
  if (!profile) return { label: 'Unknown', class: 'tier-badge-free' };
  if (profile.is_founding_beekeeper) return { label: 'Founding Beekeeper', class: 'tier-badge-founder' };
  const tier = profile.tier || 'free';
  if (tier === 'pro') return { label: 'Pro', class: 'tier-badge-pro' };
  if (tier === 'commercial') return { label: 'Commercial', class: 'tier-badge-commercial' };
  return { label: 'Free', class: 'tier-badge-free' };
}

function isInTrial(profile) {
  // Mirror the app's trial detection: localStorage hk_trial_start, 14 days
  // For web we read it from profile if available, otherwise approximate from created_at
  if (!profile || !profile.created_at) return false;
  const created = new Date(profile.created_at).getTime();
  const now = Date.now();
  const days = (now - created) / (24 * 60 * 60 * 1000);
  return days < 14 && (profile.tier === 'free' || !profile.tier);
}

function trialDaysLeft(profile) {
  if (!profile || !profile.created_at) return 0;
  const created = new Date(profile.created_at).getTime();
  const elapsed = (Date.now() - created) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(14 - elapsed));
}
