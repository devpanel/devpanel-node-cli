import { clearCredentials, loadCredentials } from '../config/store';

export function logoutCommand(): void {
  const existing = loadCredentials();
  if (!existing) {
    console.log('Not logged in.');
    return;
  }

  clearCredentials();
  console.log(`Logged out (was ${existing.email}).`);
}
