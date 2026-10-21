// live squad map: opt-in location sharing while the site is open
import { configured, db } from "./firebase.js";
import { squad, onSquad, nick, isMember, toast, avatarEl } from "./squad.js";
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// sharing closes the morning after the trip (matches firestore.rules)
const END = Date.parse("2026-10-25T00:00:00Z");
const STALE_MS = 10 * 60 * 1000;
const STOPS = [
  ["Market Market", 14.5498, 121.0557],
  ["SM Aura", 14.5466, 121.0547],
  ["High Street", 14.5507, 121.0505],
  ["Uptown Mall", 14.5565, 121.0540]
];

const $ = (id) => document.getElementById(id);
const btn = $("loc-toggle"), statusEl = $("loc-status"), listEl = $("loc-list");
let map = null, markers = {}, locs = {}, watchId = null, last = null, started = false, resumeWanted = false;
const over = () => Date.now() >= END;

function status(msg){ statusEl.textContent = msg; }
function ago(t){
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : m < 60 ? m + " mins ago" : Math.round(m / 60) + " hr ago";
}
function dist(a, b){
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat/2) ** 2 + Math.cos(a.lat*r) * Math.cos(b.lat*r) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function initMap(){
  if(map || !window.L) return;
  map = L.map("squad-map", { scrollWheelZoom:false }).setView([14.5515, 121.0530], 15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  STOPS.forEach(([name, lat, lng]) => {
    L.marker([lat, lng], { icon: L.divIcon({ className:"stop-pin", html:"<span></span>", iconSize:[14,14] }), keyboard:false })
      .addTo(map).bindTooltip(name, { direction:"top", offset:[0,-6] });
  });
}

function render(){
  if(!map) return;
  const ids = Object.keys(locs).filter((id) => squad.members[id]);
  const seen = {};
  ids.forEach((id) => {
    const l = locs[id], mine = id === squad.uid, stale = Date.now() - l.at > STALE_MS;
    seen[id] = true;
    const label = document.createElement("span"), name = document.createElement("b");
    name.textContent = mine ? "You" : nick(id);
    label.append(avatarEl(id, "small"), name);
    const icon = L.divIcon({
      className: "person-pin" + (mine ? " me" : "") + (stale ? " stale" : ""),
      html: label.outerHTML, iconSize:null, iconAnchor:[0, 0]
    });
    if(markers[id]){ markers[id].setLatLng([l.lat, l.lng]).setIcon(icon); }
    else { markers[id] = L.marker([l.lat, l.lng], { icon }).addTo(map); }
  });
  Object.keys(markers).forEach((id) => { if(!seen[id]){ markers[id].remove(); delete markers[id]; } });

  listEl.textContent = "";
  if(!ids.length){
    const li = document.createElement("li"); li.className = "empty";
    li.textContent = over() ? "Location sharing is closed. Thanks for a fun day!" : "No one is sharing yet. Tap Share my location to show up on the map.";
    listEl.append(li);
  }
  ids.sort((a, b) => locs[b].at - locs[a].at).forEach((id) => {
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button";
    const txt = document.createElement("span");
    txt.textContent = (id === squad.uid ? "You" : nick(id)) + " · " + ago(locs[id].at);
    b.append(avatarEl(id, "small"), txt);
    b.addEventListener("click", () => { map.setView([locs[id].lat, locs[id].lng], 17); });
    li.append(b); listEl.append(li);
  });
}

function setSharing(on){
  btn.textContent = on ? "Stop sharing" : "Share my location";
  btn.classList.toggle("light", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  try{ on ? localStorage.setItem("bgc-sharing", "1") : localStorage.removeItem("bgc-sharing"); }catch(e){}
}

function onPos(p){
  const here = { lat:p.coords.latitude, lng:p.coords.longitude };
  const now = Date.now();
  if(over()){ stop(); return; }
  // every pin update is sent to every open phone, so: at most every 45 s while walking,
  // and every 5 min while staying put
  if(last && now - last.at < 45000) return;
  if(last && dist(last, here) < 40 && now - last.at < 5 * 60 * 1000) return;
  last = { ...here, at:now };
  setDoc(doc(db, "locations", squad.uid), { lat:here.lat, lng:here.lng, acc:Math.round(p.coords.accuracy || 0), at:now })
    .then(() => status("Sharing your location while this page is open. Accuracy about " + Math.round(p.coords.accuracy || 0) + " m."))
    .catch(() => status("Couldn't update your location. Check your connection."));
}
function onErr(e){
  if(e.code === 1){ status("Location is blocked. Allow location for this site in your browser settings, then try again."); stop(true); }
  else status("Still looking for your location. Going outside or near a window helps.");
}
function start(){
  if(!navigator.geolocation){ status("This browser can't share location."); return; }
  if(!isMember()){ toast("Add your nickname first."); return; }
  status("Finding you…");
  watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy:true, maximumAge:15000, timeout:30000 });
  setSharing(true);
}
function stop(silent){
  if(watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; last = null; setSharing(false);
  if(squad.uid) deleteDoc(doc(db, "locations", squad.uid)).catch(() => {});
  if(!silent) status("You stopped sharing. Your pin was removed from the map.");
}
btn.addEventListener("click", () => watchId === null ? start() : stop());

initMap();
setInterval(render, 60000);

if(!configured){
  btn.hidden = true;
  status("The live map turns on once the shared plan is connected.");
} else {
  onSquad((sq) => {
    if(!sq.uid) return;
    btn.hidden = over();
    btn.disabled = !isMember();
    render();
    // pick sharing back up after a reload, once we know this person has joined
    if(resumeWanted && isMember() && watchId === null){ resumeWanted = false; start(); }
    if(started) return;
    started = true;
    if(over()){
      status("Location sharing closed after the trip.");
      deleteDoc(doc(db, "locations", sq.uid)).catch(() => {});
      return;
    }
    status("Only people who tap Share show up. Updates while the page is open.");
    // reconnects on its own if the first try was refused (e.g. rules published later)
    const listen = () => onSnapshot(collection(db, "locations"), (snap) => {
      const l = {};
      snap.forEach((d) => { l[d.id] = d.data(); });
      locs = l; render();
    }, () => { status("Reconnecting the map…"); setTimeout(listen, 10000); });
    listen();
    try{ resumeWanted = localStorage.getItem("bgc-sharing") === "1"; }catch(e){}
    if(resumeWanted && isMember()){ resumeWanted = false; start(); }
  });
}
