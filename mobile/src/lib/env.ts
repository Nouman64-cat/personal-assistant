import Constants from 'expo-constants';

/** The FastAPI backend always runs on this port in dev — see `backend/`. */
const BACKEND_PORT = 8000;

/**
 * The host Expo's dev tools used to reach this device (e.g. "192.168.1.5:8081"
 * on a physical device over the LAN, "localhost:8081" in the iOS simulator,
 * "10.0.2.2:8081" in the Android emulator). Reusing its hostname means the
 * backend — running on the same dev machine as Metro — is reachable without
 * any manual IP configuration, on every target Expo itself already handles.
 */
function inferDevHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  return host || null;
}

function resolveApiBaseUrl(): string {
  // Set this in mobile/.env (EXPO_PUBLIC_API_BASE_URL=http://<host>:8000) to
  // override — required for a standalone/production build, since there's no
  // Metro dev host to infer from there.
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const host = inferDevHost() ?? 'localhost';
  return `http://${host}:${BACKEND_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
