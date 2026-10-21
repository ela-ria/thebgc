// shared check-ins: nicknames, photo duty, photos, and done ticks (Firebase)
import { configured, db } from "./firebase.js";
import { squad, onSquad, nick, toast, notify, avatarEl, onlineIds, makeAvatar, saveMyPhoto } from "./squad.js";
import { collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { compressVideo, canCompress, blobToDataUrl, MAX_SECONDS } from "./video.js";

const pov = (id) => nick(id) + "'s POV";
const CHUNK = 700000; // characters per video piece; each database record must stay under 1 MB

const $ = (id) => document.getElementById(id);
const progress = $("plan-progress"), note = $("collab-note");
const S = { db, uid:null, canWrite:false, members:{}, steps:{}, photos:[], membersLoaded:false, gateOpen:false };

function slug(t){ return t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || "stop"; }
function setNote(msg){ note.textContent = msg; note.hidden = !msg; }

// build the per-stop controls once
const ui = Array.from(document.querySelectorAll(".timeline .step"), (step) => {
  const title = step.querySelector("h3").textContent;
  const key = slug(title);
  const done = document.createElement("label"), box = document.createElement("input");
  done.className = "done"; box.type = "checkbox"; box.id = "done-" + key; box.disabled = true;
  box.setAttribute("aria-label", "Done: " + title);
  done.append(box, "Done");

  const c = document.createElement("div"); c.className = "collab"; c.hidden = true;
  const duty = document.createElement("div"); duty.className = "duty";
  const dl = document.createElement("label"); dl.htmlFor = "duty-" + key; dl.textContent = "Photo duty";
  const sel = document.createElement("select"); sel.id = "duty-" + key;
  duty.append(dl, sel);

  const shots = document.createElement("div"); shots.className = "shots";
  const add = document.createElement("label"); add.className = "add-shot";
  const file = document.createElement("input"); file.type = "file"; file.accept = "image/*,video/*"; file.id = "file-" + key;
  const addTxt = document.createElement("span"); addTxt.textContent = "+ Add POV";
  add.append(file, addTxt); shots.append(add);

  const status = document.createElement("p"); status.className = "status";
  c.append(duty, shots, status);
  step.append(done, c);

  const u = { key, title, step, box, sel, shots, add, addTxt, file, status, collab:c, thumbs:{} };
  box.addEventListener("change", () => onDone(u));
  sel.addEventListener("change", () => writeStep(u.key, { assignee: sel.value || null }));
  file.addEventListener("change", () => onFiles(u));
  return u;
});

function render(){
  const mine = S.uid && S.members[S.uid];
  const going = Object.keys(S.members).filter((id) => S.members[id].going)
    .sort((a,b) => nick(a).localeCompare(nick(b)));
  let doneCount = 0;

  ui.forEach((u) => {
    const d = S.steps[u.key] || {};
    const shots = S.photos.filter((p) => p.step === u.key);
    const done = !!d.done;
    if(done) doneCount++;
    u.collab.hidden = false;
    u.step.classList.toggle("is-done", done);
    u.step.classList.toggle("is-mine", !!S.uid && d.assignee === S.uid && !done);
    u.box.checked = done;
    u.box.disabled = !S.canWrite || !mine || (!done && shots.length === 0);

    // photo duty picker
    if(document.activeElement !== u.sel){
      const ids = going.slice();
      if(d.assignee && !ids.includes(d.assignee)) ids.push(d.assignee);
      u.sel.textContent = "";
      u.sel.append(new Option("Anyone", ""));
      ids.forEach((id) => u.sel.append(new Option(id === S.uid ? nick(id) + " (you)" : nick(id), id)));
      u.sel.value = d.assignee || "";
    }
    u.sel.disabled = !S.canWrite || !mine;

    // thumbnails, keyed by photo id
    const seen = {};
    shots.forEach((p) => {
      seen[p.id] = true;
      if(u.thumbs[p.id]) return;
      const b = document.createElement("button"), img = document.createElement("img");
      b.type = "button"; b.className = "thumb";
      img.src = p.thumb; img.alt = (p.type === "video" ? "Video, " : "Photo, ") + pov(p.by);
      img.addEventListener("error", () => b.classList.add("broken"));
      const tag = document.createElement("span"); tag.className = "pov"; tag.textContent = pov(p.by);
      b.append(img, tag);
      if(p.type === "video") b.classList.add("is-video");
      b.addEventListener("click", () => openPhoto(p.id));
      u.shots.insertBefore(b, u.add);
      u.thumbs[p.id] = b;
    });
    Object.keys(u.thumbs).forEach((id) => { if(!seen[id]){ u.thumbs[id].remove(); delete u.thumbs[id]; } });
    u.add.hidden = !(S.canWrite && mine);

    // status line
    u.status.textContent = "";
    if(done){
      u.status.append("Done, ticked by " + nick(d.doneBy) + ".");
    } else if(shots.length){
      u.status.append(shots.length + (shots.length === 1 ? " POV" : " POVs") + " in. Ready to tick.");
    } else if(d.assignee && d.assignee === S.uid){
      const b = document.createElement("b"); b.textContent = "Your turn: ";
      u.status.append(b, "upload a photo for this stop.");
    } else if(d.assignee){
      u.status.append(nick(d.assignee) + " is on photo duty. Upload a photo to tick this off.");
    } else {
      u.status.append("Upload a photo or video to tick this off.");
    }
  });

  progress.textContent = doneCount === ui.length
    ? "All " + ui.length + " stops done. Goods na!"
    : doneCount + " of " + ui.length + " stops done";
  renderSquad(going);
}

function renderSquad(going){
  const inEl = $("squad-in"), outEl = $("squad-out");
  const out = Object.keys(S.members).filter((id) => !S.members[id].going);
  inEl.textContent = ""; outEl.textContent = "";
  if(!going.length){
    const e = document.createElement("span"); e.className = "empty";
    e.textContent = "No one has checked in yet. Add your nickname to be first.";
    inEl.append(e);
  }
  going.forEach((id) => inEl.append(chip(id, "")));
  out.forEach((id) => outEl.append(chip(id, "out")));
  $("squad-out-wrap").hidden = !out.length;
  const me = S.uid && S.members[S.uid];
  $("squad-me").textContent = me
    ? "You're in as " + me.nickname + (me.going ? ", going." : ", not going.")
    : "Add your nickname to join the list.";
  $("squad-edit").hidden = !(me && S.canWrite);
  $("squad-photo").hidden = !(me && S.canWrite);
  $("squad-photo-txt").textContent = me && me.photo ? "Change my photo" : "Add my photo";
  const on = onlineIds();
  $("squad-online").textContent = on.length ? on.length + " online now" : "";
}
function chip(id, cls){
  const s = document.createElement("span");
  s.className = "chip " + cls + (id === S.uid ? " me" : "");
  const name = document.createElement("span");
  name.textContent = nick(id) + (id === S.uid ? " (you)" : "");
  s.append(avatarEl(id), name);
  return s;
}

// profile photo from the squad card
$("squad-photo-file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  try{
    await saveMyPhoto(await makeAvatar(f));
    toast("Looking good! Your photo is updated.");
  }catch(err){
    toast("Couldn't use that photo. Try a JPG or PNG.");
  }
});

// writes
function writeStep(key, patch){
  const cur = S.steps[key] || {};
  const next = {
    assignee: "assignee" in patch ? patch.assignee : (cur.assignee || null),
    done: "done" in patch ? patch.done : !!cur.done,
    doneBy: "doneBy" in patch ? patch.doneBy : (cur.doneBy || null),
    doneAt: "doneAt" in patch ? patch.doneAt : (cur.doneAt || null)
  };
  return setDoc(doc(S.db, "steps", key), next).catch((e) => {
    toast(e && e.code === "resource-exhausted"
      ? "The site hit today's free limit. It resets at 3 PM Philippine time."
      : "Couldn't save that. Check your connection and try again.");
    render();
  });
}
function onDone(u){
  const on = u.box.checked;
  if(on && !S.photos.some((p) => p.step === u.key)){
    u.box.checked = false; toast("Upload at least one photo or video first."); return;
  }
  writeStep(u.key, { done:on, doneBy: on ? S.uid : null, doneAt: on ? Date.now() : null });
}

// photos are saved as small JPEGs inside the database (no Storage bucket needed)
function loadImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}
function toJpeg(img, max, quality){
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
async function onFiles(u){
  const f = u.file.files && u.file.files[0];
  u.file.value = "";
  if(!f) return;
  u.add.classList.add("busy"); u.addTxt.textContent = "Uploading…";
  try{
    if(f.type.startsWith("video/")) await uploadVideo(u, f);
    else await uploadPhoto(u, f);
  }catch(e){
    if(e && e.code === "too-long") toast("That video is too long. Keep it to " + MAX_SECONDS + " seconds or less.");
    else if(e && e.code === "unsupported") toast("This browser can't prepare videos. Try Chrome, or upload a photo instead.");
    else if(e && (e.code === "decode" || e.message === "decode")) toast("Couldn't read that file. Try a JPG or PNG photo, or an MP4 video.");
    else toast("Upload didn't go through. Check your connection and try again.");
  }finally{
    u.add.classList.remove("busy"); u.addTxt.textContent = "+ Add POV";
  }
}
async function uploadPhoto(u, f){
  const img = await loadImage(f);
  const thumb = toJpeg(img, 320, 0.7);
  let full = toJpeg(img, 1280, 0.75);
  if(full.length > 900000) full = toJpeg(img, 960, 0.6);
  const ref = doc(collection(S.db, "photos"));
  await setDoc(doc(S.db, "photoFull", ref.id), { full, by:S.uid });
  await setDoc(ref, { step:u.key, type:"photo", thumb, by:S.uid, at:Date.now() });
  toast("Your POV is up! You can tick this stop now.");
}
// videos are shrunk in the browser, then split into pieces under the 1 MB record limit
async function uploadVideo(u, f){
  if(!canCompress()){ const e = new Error("unsupported"); e.code = "unsupported"; throw e; }
  u.addTxt.textContent = "Preparing 0%";
  const { blob, poster } = await compressVideo(f, (x) => { u.addTxt.textContent = "Preparing " + Math.round(x * 100) + "%"; });
  u.addTxt.textContent = "Uploading…";
  const data = await blobToDataUrl(blob);
  const ref = doc(collection(S.db, "photos"));
  const n = Math.ceil(data.length / CHUNK);
  for(let i = 0; i < n; i++){
    await setDoc(doc(S.db, "videoChunks", ref.id + "_" + i), { data:data.slice(i * CHUNK, (i + 1) * CHUNK), by:S.uid, i });
    u.addTxt.textContent = "Uploading " + Math.round((i + 1) / n * 100) + "%";
  }
  await setDoc(ref, { step:u.key, type:"video", thumb:poster, chunks:n, by:S.uid, at:Date.now() });
  toast("Your video POV is up! You can tick this stop now.");
}

// photo viewer
const lb = $("lightbox"), lbImg = $("lb-img"), lbVid = $("lb-video"), lbCap = $("lb-cap"), lbRemove = $("lb-remove");
let lbUrl = null;
let lbPhoto = null, armed = false;
function openPhoto(id){
  const p = S.photos.find((x) => x.id === id);
  if(!p) return;
  lbPhoto = p; armed = false;
  const isVid = p.type === "video";
  lbImg.hidden = false; lbVid.hidden = true;
  lbImg.src = p.thumb; lbImg.alt = (isVid ? "Video, " : "Photo, ") + pov(p.by);
  lbCap.textContent = pov(p.by) + (isVid ? " · loading video…" : "");
  lbRemove.textContent = isVid ? "Remove my video" : "Remove my photo";
  lbRemove.hidden = !(S.canWrite && p.by === S.uid);
  lb.hidden = false; $("lb-close").focus();
  if(!isVid){
    getDoc(doc(S.db, "photoFull", id)).then((snap) => {
      if(lbPhoto && lbPhoto.id === id && snap.exists()) lbImg.src = snap.data().full;
    }).catch(() => {});
    return;
  }
  Promise.all(Array.from({ length:p.chunks || 0 }, (_, i) => getDoc(doc(S.db, "videoChunks", id + "_" + i))))
    .then(async (snaps) => {
      if(!lbPhoto || lbPhoto.id !== id) return;
      const blob = await (await fetch(snaps.map((x) => x.exists() ? x.data().data : "").join(""))).blob();
      lbUrl = URL.createObjectURL(blob);
      lbVid.src = lbUrl; lbVid.poster = p.thumb;
      lbImg.hidden = true; lbVid.hidden = false;
      lbCap.textContent = pov(p.by);
    })
    .catch(() => { lbCap.textContent = pov(p.by) + " · couldn't load the video"; });
}
function closePhoto(){
  lb.hidden = true; lbImg.removeAttribute("src");
  lbVid.pause(); lbVid.removeAttribute("src"); lbVid.load();
  if(lbUrl){ URL.revokeObjectURL(lbUrl); lbUrl = null; }
  lbPhoto = null;
}
$("lb-close").addEventListener("click", closePhoto);
lb.addEventListener("click", (e) => { if(e.target === lb) closePhoto(); });
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !lb.hidden) closePhoto(); });
lbRemove.addEventListener("click", async () => {
  if(!lbPhoto) return;
  if(!armed){ armed = true; lbRemove.textContent = "Tap again to remove"; return; }
  const p = lbPhoto; closePhoto();
  try{
    await deleteDoc(doc(S.db, "photos", p.id));
    if(p.type === "video"){
      for(let i = 0; i < (p.chunks || 0); i++) await deleteDoc(doc(S.db, "videoChunks", p.id + "_" + i));
    } else {
      await deleteDoc(doc(S.db, "photoFull", p.id));
    }
    toast(p.type === "video" ? "Video removed." : "Photo removed.");
  }catch(e){ toast("Couldn't remove that photo. Try again."); }
});

// join gate
const gate = $("gate"), form = $("gate-form"), nickIn = $("nick"), gateErr = $("gate-err"), bye = $("bye");
let pendingPhoto = null;
function showGatePhoto(src){
  const box = $("gate-ava");
  box.textContent = "";
  if(src){ const img = document.createElement("img"); img.src = src; img.alt = ""; box.append(img); }
  else box.textContent = "+";
  $("gate-photo-txt").textContent = src ? "Change photo" : "Add your photo (optional)";
}
$("gate-photo").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  try{ pendingPhoto = await makeAvatar(f); showGatePhoto(pendingPhoto); }
  catch(err){ gateErr.textContent = "Couldn't use that photo. Try a JPG or PNG."; }
});
function openGate(){
  const me = S.members[S.uid];
  pendingPhoto = null;
  showGatePhoto(me && me.photo);
  nickIn.value = me ? me.nickname : "";
  $("going-yes").checked = !!(me && me.going);
  $("going-no").checked = !!(me && !me.going);
  gateErr.textContent = "";
  form.hidden = false; bye.hidden = true;
  gate.hidden = false; S.gateOpen = true;
  setTimeout(() => nickIn.focus(), 30);
}
// people who can't come get a goodbye card instead of the site
function showBye(){
  const me = S.members[S.uid];
  $("bye-name").textContent = ((me && me.nickname) || "bestie") + "!";
  $("bye-err").textContent = "";
  form.hidden = true; bye.hidden = false;
  gate.hidden = false; S.gateOpen = true; S.byeShown = true;
  setTimeout(() => $("bye-join").focus(), 30);
}
function closeGate(){ gate.hidden = true; S.gateOpen = false; }
function maybeGate(){
  if(!S.canWrite || !S.uid || !S.membersLoaded || S.gateOpen) return;
  const me = S.members[S.uid];
  if(!me) openGate();
  else if(me.going === false && !S.byeShown) showBye();
}
$("bye-peek").addEventListener("click", closeGate);
$("bye-join").addEventListener("click", async () => {
  const me = S.members[S.uid];
  if(!me) return;
  $("bye-join").disabled = true;
  try{
    await setDoc(doc(S.db, "members", S.uid), { nickname:me.nickname, going:true, at:Date.now() }, { merge:true });
    closeGate();
    toast("Yay! Welcome to the squad, " + me.nickname + "!");
  }catch(err){
    $("bye-err").textContent = "Couldn't save. Check your connection and try again.";
  }finally{
    $("bye-join").disabled = false;
  }
});
$("squad-edit").addEventListener("click", openGate);
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const n = nickIn.value.replace(/\s+/g," ").trim();
  const g = $("going-yes").checked ? true : $("going-no").checked ? false : null;
  if(!n){ gateErr.textContent = "Please enter your nickname."; nickIn.focus(); return; }
  if(g === null){ gateErr.textContent = "Please choose if you're coming."; return; }
  $("gate-save").disabled = true;
  try{
    const data = { nickname:n, going:g, at:Date.now() };
    if(pendingPhoto) data.photo = pendingPhoto;
    await setDoc(doc(S.db, "members", S.uid), data, { merge:true });
    if(g){
      closeGate();
      toast("Welcome to the squad, " + n + "!");
    } else {
      showBye();
    }
  }catch(err){
    gateErr.textContent = "Couldn't save. Check your connection and try again.";
  }finally{
    $("gate-save").disabled = false;
  }
});

// connect
const titleOf = (key) => { const u = ui.find((x) => x.key === key); return u ? u.title : "a stop"; };
if(!configured){
  setNote("Shared check-ins aren't connected yet. Add the Firebase config to turn them on.");
  progress.textContent = "";
} else {
  const fail = () => setNote("Lost the connection to the shared plan. Reload the page to reconnect.");
  let started = false;
  onSquad((sq) => {
    if(sq.failed && !sq.uid){
      setNote("Couldn't connect to the shared plan. Open the site from its web address (not a saved file) and reload.");
      progress.textContent = "";
      return;
    }
    S.members = sq.members; S.membersLoaded = sq.loaded;
    if(!started){
      started = true;
      S.uid = sq.uid; S.canWrite = true; setNote("");
      let firstSteps = true, firstPhotos = true;
      onSnapshot(collection(S.db, "steps"), (snap) => {
        const s = {};
        snap.forEach((d) => { s[d.id] = d.data(); });
        if(!firstSteps){
          Object.keys(s).forEach((k) => {
            const was = S.steps[k] || {}, now = s[k];
            if(now.done && !was.done && now.doneBy !== S.uid) notify(nick(now.doneBy) + " ticked a stop", titleOf(k), "tick-" + k);
          });
        }
        firstSteps = false;
        S.steps = s; render();
      }, fail);
      onSnapshot(query(collection(S.db, "photos"), orderBy("at")), (snap) => {
        if(!firstPhotos){
          snap.docChanges().forEach((ch) => {
            const p = ch.doc.data();
            if(ch.type === "added" && p.by !== S.uid) notify(nick(p.by) + " posted a " + (p.type === "video" ? "video" : "photo") + " POV", titleOf(p.step), "photo");
          });
        }
        firstPhotos = false;
        S.photos = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
        render();
      }, fail);
    }
    render(); maybeGate();
  });
}
