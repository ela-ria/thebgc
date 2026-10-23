// recap: every POV by stop, chat photos, and wishes, plus a slideshow for the dinner table
import { configured, db, ready } from "./firebase.js";
import { squad, onSquad, nick, avatarEl } from "./squad.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// itinerary stops in order (same titles as the plan, so the keys match)
const STOPS = [
  ["8:30 AM", "Meet at the terminal"], ["9:00 AM", "Bus departs"], ["About 11:30 AM", "Arrive at Market Market"],
  ["11:40 AM", "Walk to SM Aura"], ["12:00 to 1:30 PM", "Lunch and photos at SM Aura"], ["1:30 PM", "Walk to High Street"],
  ["1:50 to 3:30 PM", "Bonifacio High Street"], ["3:30 PM", "Walk to Uptown Mall"], ["3:50 to 4:45 PM", "Quick walk around Uptown"],
  ["4:45 PM", "Check in at TGI Fridays"], ["5:00 to 6:15 PM", "Dinner at TGI Fridays Uptown"], ["6:15 to 7:45 PM", "Walk around Uptown"],
  ["7:45 PM", "Book a Grab"], ["8:00 PM", "Leave Uptown"], ["8:30 PM", "At the Market Market terminal"], ["9:00 PM", "Bus home"]
].map(([t, title]) => ({ t, title, key: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) }));

const $ = (id) => document.getElementById(id);
const pov = (id) => (id === squad.uid ? "Your" : nick(id) + "'s") + " POV";
let photos = [], chatPics = [], wishes = [], items = [];
const fullCache = {}, videoCache = {};

function tile(src, label, isVideo, onClick){
  const b = document.createElement("button");
  b.type = "button"; b.className = "tile" + (isVideo ? " is-video" : "");
  const img = document.createElement("img"); img.src = src; img.alt = (isVideo ? "Video, " : "Photo, ") + label; img.loading = "lazy";
  const tag = document.createElement("span"); tag.className = "pov"; tag.textContent = label;
  b.append(img, tag);
  b.addEventListener("click", onClick);
  return b;
}

function render(){
  // POVs grouped by stop
  const wrap = $("pov-list");
  wrap.textContent = "";
  let any = false;
  STOPS.forEach((s) => {
    const mine = photos.filter((p) => p.step === s.key);
    if(!mine.length) return;
    any = true;
    const block = document.createElement("div"); block.className = "stop-block";
    const h = document.createElement("h3");
    const t = document.createElement("span"); t.className = "t"; t.textContent = s.t;
    h.append(t, s.title);
    const g = document.createElement("div"); g.className = "gallery";
    mine.forEach((p) => g.append(tile(p.thumb, pov(p.by), p.type === "video", () => openAt("p:" + p.id))));
    block.append(h, g);
    wrap.append(block);
  });
  if(!any){
    const p = document.createElement("p"); p.className = "recap-empty";
    p.textContent = "No POVs yet. Post photos and videos at each stop on the plan, and they'll show up here.";
    wrap.append(p);
  }

  // chat photos
  const cg = $("chat-gallery");
  cg.textContent = "";
  chatPics.forEach((c) => cg.append(tile(c.img, "from " + (c.by === squad.uid ? "you" : nick(c.by)), false, () => openAt("c:" + c.id))));
  $("chat-empty").hidden = chatPics.length > 0;

  // wishes
  const wall = $("recap-wall");
  wall.querySelectorAll(".wish").forEach((n) => n.remove());
  wishes.forEach((w) => {
    const card = document.createElement("article"); card.className = "wish";
    const head = document.createElement("header");
    const who = document.createElement("b"); who.textContent = nick(w.id);
    head.append(avatarEl(w.id), who);
    const body = document.createElement("p"); body.textContent = w.text;
    card.append(head, body);
    wall.append(card);
  });
  $("recap-wish-empty").hidden = wishes.length > 0;

  $("st-povs").textContent = photos.length;
  $("st-chat").textContent = chatPics.length;
  $("st-wishes").textContent = wishes.length;
  $("st-squad").textContent = Object.values(squad.members).filter((m) => m.going).length;

  // slideshow order: the day stop by stop, then chat photos, then the wishes, then a finale
  items = [];
  STOPS.forEach((s) => photos.filter((p) => p.step === s.key).forEach((p) =>
    items.push({ id:"p:" + p.id, kind:p.type === "video" ? "video" : "photo", p, where:s.title, cap:pov(p.by) })));
  chatPics.forEach((c) => items.push({ id:"c:" + c.id, kind:"chat", c, where:"Squad chat", cap:"from " + (c.by === squad.uid ? "you" : nick(c.by)) }));
  wishes.forEach((w) => items.push({ id:"w:" + w.id, kind:"wish", w, where:"Birthday wishes", cap:"" }));
  items.push({ id:"end", kind:"end", where:"", cap:"" });
  $("play").disabled = items.length <= 1;
}

// full-size photo and video loaders (cached)
function fullSrc(p){
  if(!fullCache[p.id]) fullCache[p.id] = getDoc(doc(db, "photoFull", p.id)).then((s) => s.exists() ? s.data().full : p.thumb).catch(() => p.thumb);
  return fullCache[p.id];
}
function videoUrl(p){
  if(!videoCache[p.id]){
    videoCache[p.id] = Promise.all(Array.from({ length:p.chunks || 0 }, (_, i) => getDoc(doc(db, "videoChunks", p.id + "_" + i))))
      .then((snaps) => fetch(snaps.map((x) => x.exists() ? x.data().data : "").join("")))
      .then((r) => r.blob()).then((b) => URL.createObjectURL(b));
  }
  return videoCache[p.id];
}

// slideshow
const show = $("show"), stage = $("show-stage"), bar = $("show-bar"), toggle = $("show-toggle");
let idx = 0, playing = false, timer = null, token = 0;
function schedule(ms){
  clearTimeout(timer);
  bar.classList.remove("run"); void bar.offsetWidth;
  if(!playing || !ms) { bar.style.width = "0"; return; }
  bar.style.width = ""; bar.style.animationDuration = ms + "ms"; bar.classList.add("run");
  timer = setTimeout(() => go(idx + 1), ms);
}
function go(i){
  if(!items.length) return;
  idx = (i + items.length) % items.length;
  const it = items[idx], my = ++token;
  stage.textContent = "";
  $("show-where").textContent = it.where;
  $("show-count").textContent = it.kind === "end" ? "" : (idx + 1) + " / " + (items.length - 1);
  $("show-cap").textContent = it.cap;
  if(it.kind === "photo"){
    const img = new Image(); img.alt = it.cap; img.src = it.p.thumb; stage.append(img);
    fullSrc(it.p).then((src) => { if(my === token) img.src = src; });
    schedule(5000);
  } else if(it.kind === "chat"){
    const img = new Image(); img.alt = it.cap; img.src = it.c.img; stage.append(img);
    schedule(5000);
  } else if(it.kind === "video"){
    const v = document.createElement("video");
    v.poster = it.p.thumb; v.controls = true; v.playsInline = true;
    stage.append(v);
    schedule(0);
    v.addEventListener("ended", () => { if(playing && my === token) go(idx + 1); });
    videoUrl(it.p).then((url) => {
      if(my !== token) return;
      v.src = url;
      if(playing) v.play().catch(() => schedule(6000));
    }).catch(() => { if(my === token){ $("show-cap").textContent = it.cap + " · couldn't load the video"; schedule(4000); } });
  } else if(it.kind === "wish"){
    const card = document.createElement("article"); card.className = "show-wish";
    const head = document.createElement("header");
    const who = document.createElement("span"); who.textContent = nick(it.w.id);
    head.append(avatarEl(it.w.id), who);
    const p = document.createElement("p"); p.textContent = it.w.text;
    card.append(head, p); stage.append(card);
    schedule(Math.min(12000, 5000 + it.w.text.length * 40));
  } else {
    const end = document.createElement("div"); end.className = "show-end";
    const h = document.createElement("h2"); h.append("Happy birthday,");
    const s = document.createElement("span"); s.className = "serif"; s.textContent = "Jaspher! 🎂";
    h.append(s);
    const p = document.createElement("p"); p.textContent = "Love, the squad · BGC gala, October 24";
    end.append(h, p); stage.append(end);
    setPlaying(false);
  }
}
function setPlaying(on){
  playing = on;
  toggle.textContent = on ? "Pause" : "Play";
  const v = stage.querySelector("video");
  if(v){ if(on) v.play().catch(() => {}); else v.pause(); }
  if(!on) schedule(0);
  else if(!v) schedule(items[idx] && items[idx].kind === "wish" ? 7000 : 5000);
}
function openShow(start, autoplay){
  show.hidden = false; requestAnimationFrame(() => show.classList.add("on"));
  document.documentElement.style.overflow = "hidden";
  playing = autoplay; toggle.textContent = autoplay ? "Pause" : "Play";
  go(start);
  toggle.focus();
}
function closeShow(){
  clearTimeout(timer); token++;
  const v = stage.querySelector("video"); if(v) v.pause();
  show.classList.remove("on");
  setTimeout(() => { show.hidden = true; stage.textContent = ""; }, 200);
  document.documentElement.style.overflow = "";
  if(document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function openAt(id){ const i = items.findIndex((x) => x.id === id); openShow(i < 0 ? 0 : i, false); }
$("play").addEventListener("click", () => {
  if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  openShow(0, true);
});
toggle.addEventListener("click", () => {
  if(items[idx] && items[idx].kind === "end"){ go(0); setPlaying(true); return; }
  setPlaying(!playing);
});
$("show-next").addEventListener("click", () => go(idx + 1));
$("show-prev").addEventListener("click", () => go(idx - 1));
$("show-close").addEventListener("click", closeShow);
document.addEventListener("keydown", (e) => {
  if(show.hidden) return;
  if(e.key === "ArrowRight") go(idx + 1);
  else if(e.key === "ArrowLeft") go(idx - 1);
  else if(e.key === "Escape") closeShow();
  else if(e.key === " "){ e.preventDefault(); toggle.click(); }
});
let sx = 0;
stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive:true });
stage.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - sx;
  if(Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1));
});

// load once; the recap doesn't need live updates
async function load(){
  const [ps, cs, ws] = await Promise.all([
    getDocs(collection(db, "photos")),
    getDocs(query(collection(db, "chat"), where("img", ">", ""))),
    getDocs(collection(db, "wishes"))
  ]);
  photos = ps.docs.map((d) => ({ id:d.id, ...d.data() })).sort((a, b) => a.at - b.at);
  chatPics = cs.docs.map((d) => ({ id:d.id, ...d.data() })).sort((a, b) => a.at - b.at);
  wishes = ws.docs.map((d) => ({ id:d.id, ...d.data() })).filter((w) => w.text).sort((a, b) => a.at - b.at);
  render();
}

if(!configured){
  $("pov-status").textContent = "The recap needs the shared plan connected.";
} else {
  let loaded = false, namesKey = "";
  ready.then((uid) => {
    if(!uid){ $("pov-status").textContent = "Couldn't connect. Reload the page to try again."; }
  });
  onSquad(() => {
    if(!loaded){
      loaded = true;
      load().catch(() => { $("pov-list").textContent = ""; const p = document.createElement("p"); p.className = "recap-empty"; p.textContent = "Couldn't load the recap. Reload the page to try again."; $("pov-list").append(p); });
    } else {
      // re-draw only when someone's nickname or photo changes, not on every online ping
      const k = Object.entries(squad.members).map(([id, m]) => id + m.nickname + (m.photo ? m.photo.length : 0) + m.going).join("|");
      if(k !== namesKey){ namesKey = k; render(); }
    }
  });
}
