// ponytail: sign-out state tracking — only setSigningOut/getSigningOutState used externally
let isSigningOut = false;
let signOutTimestamp = 0;
const SIGNOUT_SUPPRESSION_WINDOW = 3000;

export function setSigningOut(value: boolean) {
  isSigningOut = value;
  if (value) {
    signOutTimestamp = Date.now();
  }
}

export function getSigningOutState() {
  if (isSigningOut) return true;
  if (signOutTimestamp > 0 && Date.now() - signOutTimestamp < SIGNOUT_SUPPRESSION_WINDOW) {
    return true;
  }
  return false;
}
