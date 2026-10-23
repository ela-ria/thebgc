// one Firebase connection shared by check-ins, chat, and the map
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configured = !firebaseConfig.apiKey.startsWith("PASTE");

const app = configured ? initializeApp(firebaseConfig) : null;

// keep a copy of the data on the phone, so a reload only downloads what changed
// (saves the free plan's 50,000 reads a day); falls back if the browser blocks storage
function makeDb(){
  try{
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }catch(e){
    return getFirestore(app);
  }
}
export const db = app ? makeDb() : null;

// a short-lived proof of sign-in, for calls to our own server functions (Ela AI)
export async function idToken(){
  const user = app ? getAuth(app).currentUser : null;
  return user ? user.getIdToken() : null;
}

// resolves with this browser's anonymous user id, or null if sign-in failed
export const ready = app ? new Promise((resolve) => {
  const auth = getAuth(app);
  onAuthStateChanged(auth, (user) => { if(user) resolve(user.uid); });
  signInAnonymously(auth).catch(() => resolve(null));
}) : Promise.resolve(null);
