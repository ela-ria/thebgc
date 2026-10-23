// shared squad state: who's signed in, nicknames, toasts, and notifications
import { db, ready } from "./firebase.js";
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const squad = { uid:null, members:{}, presence:{}, loaded:false, failed:false };
const listeners = [];

export function onSquad(fn){ listeners.push(fn); if(squad.uid) fn(squad); }
export function nick(id){ const m = id && squad.members[id]; return (m && m.nickname) || "Someone"; }
export function isMember(){ return !!(squad.uid && squad.members[squad.uid]); }

const emit = () => listeners.forEach((fn) => fn(squad));

// presence: everyone with the site open checks in every 4 min; "online" = seen in the last 6 min
// (every check-in is sent to every open phone, so this stays slow to fit the free plan)
const ONLINE_MS = 6 * 60 * 1000;
export function isOnline(id){ const t = squad.presence[id]; return !!t && Date.now() - t < ONLINE_MS; }
export function onlineIds(){ return Object.keys(squad.members).filter(isOnline); }
function beat(){
  if(!squad.uid || document.hidden) return;
  setDoc(doc(db, "presence", squad.uid), { at:Date.now() }).catch(() => {});
}
function listenPresence(){
  let first = true;
  onSnapshot(collection(db, "presence"), (snap) => {
    const p = {};
    snap.forEach((d) => { p[d.id] = d.data().at || 0; });
    const wasOnline = first ? null : new Set(onlineIds());
    squad.presence = p;
    if(wasOnline){
      onlineIds().forEach((id) => {
        if(id !== squad.uid && !wasOnline.has(id) && !document.hidden) toast(nick(id) + " is here! 👋");
      });
    }
    first = false;
    emit();
  }, () => setTimeout(listenPresence, 10000));
}

function listenMembers(){
  onSnapshot(collection(db, "members"), (snap) => {
    const m = {};
    snap.forEach((d) => { m[d.id] = d.data(); });
    squad.members = m;
    if(!snap.metadata.fromCache) squad.loaded = true;
    squad.failed = false;
    emit();
  }, () => { squad.failed = true; emit(); setTimeout(listenMembers, 10000); });
}

ready.then((uid) => {
  if(!uid){ squad.failed = true; emit(); return; }
  squad.uid = uid;
  listenMembers();
  listenPresence();
  beat();
  setInterval(beat, 4 * 60 * 1000);
  setInterval(emit, 60000); // let "online" dots fade out on time
  document.addEventListener("visibilitychange", () => { if(!document.hidden) beat(); });
  window.addEventListener("pagehide", () => { deleteDoc(doc(db, "presence", uid)).catch(() => {}); });
});

// profile photos: a small square JPEG kept on the member's own record
export async function makeAvatar(file){
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    i.src = url;
  });
  const side = Math.min(img.naturalWidth, img.naturalHeight), out = 128;
  const c = document.createElement("canvas"); c.width = c.height = out;
  c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
  return c.toDataURL("image/jpeg", 0.8);
}
export function saveMyPhoto(photo){
  return setDoc(doc(db, "members", squad.uid), { photo }, { merge:true });
}
// a round face (or initial) with a green dot when that person is online
export function avatarEl(id, extra){
  const m = squad.members[id];
  const el = document.createElement("span");
  el.className = "ava" + (extra ? " " + extra : "") + (isOnline(id) ? " online" : "");
  el.dataset.uid = id || "";
  if(m && m.photo){
    const img = document.createElement("img");
    img.src = m.photo; img.alt = "";
    el.append(img);
  } else {
    el.textContent = (nick(id).trim()[0] || "?").toUpperCase();
  }
  return el;
}

// toast
const toastEl = document.getElementById("toast");
let toastTimer;
export function toast(msg){
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
}

// notifications: a phone/desktop notification while the site is open in the
// background, a toast while it's on screen, and an unread count in the tab title
let swReg = null;
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; }).catch(() => {});
}
const baseTitle = document.title;
let missed = 0;
document.addEventListener("visibilitychange", () => {
  if(!document.hidden){ missed = 0; document.title = baseTitle; }
});

export const notifSupported = "Notification" in window;
export function notifState(){ return notifSupported ? Notification.permission : "unsupported"; }
export function enableNotifs(){
  return notifSupported ? Notification.requestPermission() : Promise.resolve("unsupported");
}
// in-page notification banner (top of the screen, like a chat app); tap to open what it's about
const bannerEl = document.getElementById("banner");
let bannerTimer, bannerTag = "";
function hideBanner(){
  if(!bannerEl) return;
  bannerEl.classList.remove("in");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, 250);
}
export function banner(title, body, tag){
  if(!bannerEl){ toast(body ? title + ": " + body : title); return; }
  bannerTag = tag || "";
  document.getElementById("banner-title").textContent = title;
  document.getElementById("banner-body").textContent = body || "";
  bannerEl.hidden = false;
  clearTimeout(bannerTimer);
  requestAnimationFrame(() => bannerEl.classList.add("in"));
  bannerTimer = setTimeout(hideBanner, 4500);
}
if(bannerEl){
  bannerEl.addEventListener("click", () => {
    hideBanner();
    if(/^(chat|mention|ela)/.test(bannerTag)) document.dispatchEvent(new CustomEvent("bgc:open-chat"));
    else if(/^(photo|tick)/.test(bannerTag)){ const plan = document.getElementById("plan"); if(plan) plan.scrollIntoView({ behavior:"smooth" }); }
    else if(bannerTag === "wish"){ const w = document.getElementById("wishes"); if(w) w.scrollIntoView({ behavior:"smooth" }); }
  });
  // swipe up to dismiss
  let sy = 0;
  bannerEl.addEventListener("touchstart", (e) => { sy = e.touches[0].clientY; }, { passive:true });
  bannerEl.addEventListener("touchend", (e) => { if(sy - e.changedTouches[0].clientY > 25) hideBanner(); });
}

export function notify(title, body, tag){
  if(!document.hidden){ banner(title, body, tag); return; }
  missed++;
  document.title = "(" + missed + ") " + baseTitle;
  if(notifState() !== "granted") return;
  const opts = { body: body || "", tag: tag || undefined };
  if(swReg) swReg.showNotification(title, opts).catch(() => {});
  else { try{ new Notification(title, opts); }catch(e){} }
}
