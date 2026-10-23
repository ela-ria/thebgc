// squad chat: nicknames, replies, reactions, photos, @mentions, and birthday confetti
import { configured, db } from "./firebase.js";
import { squad, onSquad, nick, isMember, notify, notifState, enableNotifs, avatarEl, onlineIds, isOnline, toast } from "./squad.js";
import { collection, addDoc, doc, updateDoc, deleteDoc, deleteField, onSnapshot, query, orderBy, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const fab = $("chat-fab"), badge = $("chat-badge"), panel = $("chat-panel"), list = $("chat-list");
const form = $("chat-form"), input = $("chat-input"), send = $("chat-send"), lock = $("chat-lock");
const notifBtn = $("chat-notif"), notifNote = $("chat-notif-note"), newPill = $("chat-newpill");
const QUICK = ["Happy birthday, Jaspher! 🎂", "Nasaan na kayo?", "Nandito na ako!", "Wait lang, papunta na!", "CR lang saglit", "Kain na tayo!"];
const REACTS = ["😂", "❤️", "😮", "😢", "👍", "🎂"];
const BDAY = /\b(hbd|happy\s*b(irth)?day|happy\s*bday|maligayang\s*kaarawan)\b|🎂|🥳/i;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+$/u;
const GROUP_MS = 3 * 60 * 1000, GAP_MS = 20 * 60 * 1000;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let messages = [], byId = {}, rendered = {}, unread = 0, started = false, firstRender = true, loaded = false;
let replyTo = null, attach = null, openRow = null, mentionedUnread = false;
const fmtTime = new Intl.DateTimeFormat("en-PH", { hour:"numeric", minute:"2-digit" });
const fmtDay = new Intl.DateTimeFormat("en-PH", { weekday:"short", hour:"numeric", minute:"2-digit" });

function setBadge(){
  badge.textContent = mentionedUnread ? "@" : unread > 9 ? "9+" : String(unread);
  badge.hidden = !unread;
  if(unread){ badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
}
function nearBottom(){ return list.scrollHeight - list.scrollTop - list.clientHeight < 90; }
function toBottom(smooth){ list.scrollTo({ top:list.scrollHeight, behavior: smooth && !reduceMotion ? "smooth" : "auto" }); }
function snippet(m){ return m.text ? m.text.slice(0, 80) : (m.img ? "📷 Photo" : ""); }
function bigEmoji(t){ return !!t && t.length <= 12 && EMOJI_ONLY.test(t); }

// @mentions: "@nickname" for one person, "@everyone" (or "@all") for the whole squad
const EVERYONE = /@(everyone|all)(?![\p{L}\p{N}])/iu;
function memberIds(){ return Object.keys(squad.members).filter((id) => squad.members[id].nickname); }
function escapeRe(t){ return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
let reCache = { key:null, re:null };
function mentionRe(){
  const names = memberIds().map((id) => nick(id)).sort((a, b) => b.length - a.length);
  const key = names.join("\u0000");
  if(reCache.key !== key){
    reCache = { key, re:new RegExp("@(everyone|all" + (names.length ? "|" + names.map(escapeRe).join("|") : "") + ")(?![\\p{L}\\p{N}])", "giu") };
  }
  reCache.re.lastIndex = 0;
  return reCache.re;
}
function findMentions(text){
  const ids = new Set(), lower = text.toLowerCase();
  memberIds().forEach((id) => {
    const n = "@" + nick(id).toLowerCase();
    const i = lower.indexOf(n);
    if(i >= 0 && !/[\p{L}\p{N}]/u.test(lower.charAt(i + n.length))) ids.add(id);
  });
  ids.delete(squad.uid);
  return { ids:[...ids], everyone:EVERYONE.test(text) };
}
function mentionsMe(m){
  return m.by !== squad.uid && (m.everyone || (Array.isArray(m.mentions) && m.mentions.includes(squad.uid)));
}
// text with @mentions wrapped in highlight spans (built from text nodes, never HTML)
function textWithMentions(text, el){
  const re = mentionRe();
  let last = 0, hit;
  while((hit = re.exec(text))){
    if(hit.index > last) el.append(text.slice(last, hit.index));
    const span = document.createElement("span");
    const word = hit[1].toLowerCase();
    const isMe = word === "everyone" || word === "all" || (!!squad.uid && nick(squad.uid).toLowerCase() === word);
    span.className = "mention" + (isMe ? " me" : "");
    span.textContent = hit[0];
    el.append(span);
    last = hit.index + hit[0].length;
  }
  if(last < text.length) el.append(text.slice(last));
}

// one message row: avatar, then a column with name, bubble, time, reactions, and a floating action bar
function build(m){
  const mine = m.by === squad.uid;
  const row = document.createElement("div");
  row.className = "msg-row" + (mine ? " mine" : "");
  row.dataset.id = m.id;
  row.append(mine ? document.createElement("span") : avatarEl(m.by, "small"));

  const col = document.createElement("div"); col.className = "msg-col";
  const who = document.createElement("span"); who.className = "who"; who.textContent = mine ? "You" : nick(m.by);
  col.append(who);

  const bubble = document.createElement("div");
  const big = bigEmoji(m.text) && !m.img && !m.replyTo;
  bubble.className = "msg" + (mine ? " mine" : "") + (big ? " big" : "") + (m.img && !m.text && !m.replyTo ? " photo-only" : "");
  bubble.tabIndex = 0;
  bubble.setAttribute("aria-label", who.textContent + ": " + (m.text || "photo") + ". Press Enter for reactions and reply.");

  if(m.replyTo){
    const orig = byId[m.replyTo];
    const q = document.createElement("button"); q.type = "button"; q.className = "quote";
    const qn = document.createElement("b"), qt = document.createElement("span");
    const qBy = orig ? orig.by : m.replyBy;
    qn.textContent = "↩ " + (qBy === squad.uid ? "You" : nick(qBy));
    qt.textContent = orig ? snippet(orig) : (m.replyText || "Original message");
    q.append(qn, qt);
    q.addEventListener("click", (e) => { e.stopPropagation(); jumpTo(m.replyTo); });
    bubble.append(q);
  }
  if(m.img){
    const img = document.createElement("img"); img.className = "chat-img"; img.src = m.img; img.alt = "Photo from " + who.textContent;
    img.decoding = "async";
    img.addEventListener("load", () => { if(nearBottom() || row._fresh) toBottom(false); }, { once:true });
    img.addEventListener("click", (e) => { e.stopPropagation(); if(!row._longPressed) openViewer(m.img, img.alt); });
    bubble.append(img);
  }
  if(m.text){ const p = document.createElement("p"); p.className = "txt"; textWithMentions(m.text, p); bubble.append(p); }
  if(mentionsMe(m)) bubble.classList.add("pinged");
  col.append(bubble);

  const time = document.createElement("time"); time.className = "time"; time.textContent = fmtTime.format(new Date(m.at));
  col.append(time);

  // reaction chips
  const counts = {};
  Object.entries(m.reactions || {}).forEach(([uid, e]) => { (counts[e] = counts[e] || []).push(uid); });
  const emojis = Object.keys(counts);
  if(emojis.length){
    const rx = document.createElement("div"); rx.className = "reacts";
    emojis.forEach((e) => {
      const c = document.createElement("button"); c.type = "button";
      c.className = "react-chip" + (counts[e].includes(squad.uid) ? " on" : "");
      const em = document.createElement("span"); em.textContent = e; c.append(em);
      if(counts[e].length > 1){ const n = document.createElement("b"); n.textContent = counts[e].length; c.append(n); }
      c.title = counts[e].map((u) => u === squad.uid ? "You" : nick(u)).join(", ");
      c.setAttribute("aria-label", e + " from " + c.title);
      c.addEventListener("click", (ev) => { ev.stopPropagation(); react(m, e); });
      rx.append(c);
    });
    col.append(rx);
  }

  // floating action bar: reactions, reply, unsend
  const bar = document.createElement("div"); bar.className = "msg-actions"; bar.hidden = true;
  const emojiRow = document.createElement("div"); emojiRow.className = "act-emoji";
  REACTS.forEach((e) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = e;
    b.setAttribute("aria-label", "React " + e);
    if(m.reactions && m.reactions[squad.uid] === e) b.className = "on";
    b.addEventListener("click", (ev) => { ev.stopPropagation(); react(m, e); closeActions(); });
    emojiRow.append(b);
  });
  const txtRow = document.createElement("div"); txtRow.className = "act-text";
  const rb = document.createElement("button"); rb.type = "button"; rb.textContent = "↩ Reply";
  rb.addEventListener("click", (ev) => { ev.stopPropagation(); closeActions(); startReply(m); });
  txtRow.append(rb);
  if(mine){
    const ub = document.createElement("button"); ub.type = "button"; ub.className = "danger"; ub.textContent = "Unsend";
    ub.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if(ub.dataset.armed){
        closeActions();
        row.classList.add("leaving");
        deleteDoc(doc(db, "chat", m.id)).catch(() => { row.classList.remove("leaving"); toast("Couldn't unsend. Try again."); });
      } else { ub.dataset.armed = "1"; ub.textContent = "Tap again to unsend"; }
    });
    txtRow.append(ub);
  }
  bar.append(emojiRow, txtRow);
  col.append(bar);
  row.append(col);
  wireGestures(row, col, bubble, m);
  return row;
}

// gestures: click/Enter or long-press = actions, double-tap = ❤️, swipe right = reply
function wireGestures(row, col, bubble, m){
  let lastTap = 0, pressTimer = null, sx = 0, sy = 0, dx = 0, mode = null;
  bubble.addEventListener("keydown", (e) => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggleActions(row); } });

  bubble.addEventListener("pointerdown", (e) => {
    row._longPressed = false;
    if(e.pointerType === "mouse") return;
    pressTimer = setTimeout(() => {
      row._longPressed = true;
      if(navigator.vibrate) navigator.vibrate(12);
      toggleActions(row, true);
    }, 420);
  });
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  bubble.addEventListener("pointerup", cancelPress);
  bubble.addEventListener("pointercancel", cancelPress);
  bubble.addEventListener("pointerleave", cancelPress);
  bubble.addEventListener("contextmenu", (e) => { if(row._longPressed) e.preventDefault(); });

  bubble.addEventListener("click", () => {
    if(row._longPressed){ row._longPressed = false; return; }
    const now = Date.now();
    if(now - lastTap < 300){ lastTap = 0; heart(bubble); react(m, "❤️", true); closeActions(); return; }
    lastTap = now;
    // with a mouse, a click opens the menu right away; on touch, long-press does
    if(matchMedia("(hover: hover)").matches) toggleActions(row);
  });

  row.addEventListener("touchstart", (e) => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; mode = null;
    col.style.transition = "none";
  }, { passive:true });
  row.addEventListener("touchmove", (e) => {
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if(!mode) mode = Math.abs(x) > 8 && Math.abs(x) > Math.abs(y) ? "swipe" : (Math.abs(y) > 8 ? "scroll" : null);
    if(mode !== "swipe") return;
    cancelPress();
    dx = Math.max(0, Math.min(x, 90));
    col.style.transform = "translateX(" + (dx < 60 ? dx : 60 + (dx - 60) * .35) + "px)";
    row.classList.toggle("swipe-ready", dx > 60);
    if(dx > 60 && !row._buzzed){ row._buzzed = true; if(navigator.vibrate) navigator.vibrate(8); }
    if(dx <= 60) row._buzzed = false;
  }, { passive:true });
  row.addEventListener("touchend", () => {
    col.style.transition = ""; col.style.transform = "";
    if(mode === "swipe" && dx > 60) startReply(m);
    row.classList.remove("swipe-ready"); row._buzzed = false; mode = null;
  });
}

function heart(bubble){
  if(reduceMotion) return;
  const h = document.createElement("span"); h.className = "heart-burst"; h.textContent = "❤️";
  bubble.append(h);
  setTimeout(() => h.remove(), 750);
}

function sig(m, names){
  const orig = m.replyTo && byId[m.replyTo];
  return [m.text, m.img ? m.img.length : 0, JSON.stringify(m.reactions || {}), (squad.members[m.by] || {}).photo ? 1 : 0,
    m.replyTo, orig ? snippet(orig) + orig.by : "", names].join("|");
}

function separator(at){
  const el = document.createElement("div"); el.className = "chat-sep";
  const span = document.createElement("span");
  const d = new Date(at), today = new Date();
  span.textContent = d.toDateString() === today.toDateString() ? fmtTime.format(d) : fmtDay.format(d);
  el.append(span);
  return el;
}

function render(){
  if(!loaded){ updateOnline(); return; } // wait for the first batch of messages
  const stick = nearBottom();
  const names = memberIds().map((id) => nick(id)).join(",");
  const keep = {};
  const empty = $("chat-empty");
  let cursor = empty;
  const place = (el) => {
    const want = cursor.nextSibling;
    if(want !== el) list.insertBefore(el, want);
    cursor = el;
  };
  let addedOther = false;

  messages.forEach((m, i) => {
    const prev = messages[i - 1], next = messages[i + 1];
    // time separator after a long gap
    if(!prev || m.at - prev.at > GAP_MS){
      const key = "sep:" + m.id;
      keep[key] = true;
      if(!rendered[key]) rendered[key] = separator(m.at);
      place(rendered[key]);
    }
    keep[m.id] = true;
    const s = sig(m, names);
    let row = rendered[m.id];
    if(!row || row._sig !== s){
      const fresh = build(m); fresh._sig = s;
      if(row){ if(openRow === row) openRow = null; row.replaceWith(fresh); }
      else if(!firstRender){
        fresh._fresh = true;
        if(!reduceMotion) fresh.classList.add("pop");
        if(m.by !== squad.uid) addedOther = true;
      }
      row = fresh; rendered[m.id] = row;
    }
    // Messenger-style grouping: same person within a few minutes
    const joinPrev = !!prev && prev.by === m.by && m.at - prev.at < GROUP_MS;
    const joinNext = !!next && next.by === m.by && next.at - m.at < GROUP_MS;
    row.classList.toggle("g-first", !joinPrev);
    row.classList.toggle("g-last", !joinNext);
    place(row);
  });
  Object.keys(rendered).forEach((k) => {
    if(keep[k]) return;
    const el = rendered[k];
    if(openRow === el) openRow = null;
    delete rendered[k];
    if(!reduceMotion && el.classList.contains("msg-row")){
      el.classList.add("leaving"); setTimeout(() => el.remove(), 220);
    } else el.remove();
  });

  empty.hidden = messages.length > 0;
  updateOnline();
  if(firstRender || stick) toBottom(!firstRender);
  else if(addedOther) newPill.hidden = false;
  firstRender = false;
}

// online dots and header faces, updated in place (no rebuild)
function updateOnline(){
  panel.querySelectorAll(".msg-row .ava[data-uid]").forEach((a) => a.classList.toggle("online", isOnline(a.dataset.uid)));
  const on = onlineIds();
  $("chat-online").textContent = on.length ? on.length + " online now" : "";
  const stack = $("chat-faces");
  stack.textContent = "";
  on.slice(0, 4).forEach((id) => stack.append(avatarEl(id, "small")));
}

function toggleActions(row, force){
  if(openRow && openRow !== row) closeActions();
  const bar = row.querySelector(".msg-actions");
  const show = force === true ? true : bar.hidden;
  if(!show){ closeActions(); return; }
  // open below the bubble when there's no room above
  const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
  bar.classList.toggle("below", top < 70);
  bar.hidden = false;
  row.classList.add("active");
  openRow = row;
  requestAnimationFrame(() => bar.classList.add("show"));
}
function closeActions(){
  if(!openRow) return;
  const row = openRow, bar = row.querySelector(".msg-actions");
  openRow = null;
  row.classList.remove("active");
  if(!bar) return;
  bar.classList.remove("show");
  setTimeout(() => { if(openRow !== row) bar.hidden = true; }, 160);
}
list.addEventListener("click", (e) => { if(!e.target.closest(".msg-col")) closeActions(); });
list.addEventListener("scroll", () => {
  if(openRow) closeActions();
  if(nearBottom()) newPill.hidden = true;
}, { passive:true });
newPill.addEventListener("click", () => { newPill.hidden = true; toBottom(true); });

function jumpTo(id){
  const row = rendered[id];
  if(!row){ toast("That message is too old to show here."); return; }
  row.scrollIntoView({ block:"center", behavior: reduceMotion ? "auto" : "smooth" });
  row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
}

// reactions: one per person per message; tapping your own again removes it
function react(m, emoji, onlyAdd){
  if(!isMember()){ toast("Add your nickname first."); return; }
  const cur = m.reactions && m.reactions[squad.uid];
  if(onlyAdd && cur === emoji) return;
  const next = cur === emoji ? deleteField() : emoji;
  updateDoc(doc(db, "chat", m.id), { ["reactions." + squad.uid]: next })
    .catch((e) => toast(e && e.code === "permission-denied"
      ? "Reactions aren't allowed yet. Publish the updated Firestore rules."
      : "Couldn't react. Check your connection."));
}

// trays above the input (reply, photo) slide instead of popping
function showTray(el, on){
  if(on){ el.hidden = false; requestAnimationFrame(() => el.classList.add("show")); }
  else { el.classList.remove("show"); setTimeout(() => { if(!el.classList.contains("show")) el.hidden = true; }, 180); }
}

// replying
function startReply(m){
  if(!isMember()) return;
  replyTo = m;
  $("reply-who").textContent = "Replying to " + (m.by === squad.uid ? "yourself" : nick(m.by));
  $("reply-text").textContent = snippet(m);
  showTray($("chat-replying"), true);
  input.focus({ preventScroll:true });
}
function cancelReply(){ replyTo = null; showTray($("chat-replying"), false); }
$("reply-cancel").addEventListener("click", cancelReply);

// photos
function shrink(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const make = (max, q) => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", q);
      };
      let d = make(1000, 0.72);
      if(d.length > 380000) d = make(760, 0.6);
      resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}
function clearAttach(){
  attach = null; showTray($("chat-attach"), false);
  setTimeout(() => { if(!attach) $("attach-img").removeAttribute("src"); }, 200);
  updateSend();
}
$("chat-file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  try{
    attach = await shrink(f);
    $("attach-img").src = attach;
    showTray($("chat-attach"), true);
    updateSend();
    input.focus({ preventScroll:true });
  }catch(err){ toast("Couldn't use that photo. Try a JPG or PNG."); }
});
$("attach-cancel").addEventListener("click", clearAttach);

// photo viewer
const viewer = $("chat-viewer");
function openViewer(src, alt){
  $("chat-viewer-img").src = src; $("chat-viewer-img").alt = alt;
  viewer.hidden = false; requestAnimationFrame(() => viewer.classList.add("show"));
  $("chat-viewer-close").focus();
}
function closeViewer(){
  viewer.classList.remove("show");
  setTimeout(() => { viewer.hidden = true; $("chat-viewer-img").removeAttribute("src"); }, 180);
}
$("chat-viewer-close").addEventListener("click", closeViewer);
viewer.addEventListener("click", (e) => { if(e.target === viewer) closeViewer(); });

// confetti for birthday greetings
const canvas = $("confetti");
let confettiOn = false;
function confetti(){
  if(confettiOn || reduceMotion) return;
  confettiOn = true;
  const g = canvas.getContext("2d"), dpr = window.devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.hidden = false;
  g.scale(dpr, dpr);
  const colors = ["#d9608b", "#f9b4cb", "#9b7fd1", "#ffd36e", "#ffffff", "#ff8fb1"];
  const bits = Array.from({ length:140 }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35,
    vx: (Math.random() - .5) * 12, vy: -Math.random() * 13 - 4,
    s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .3,
    c: colors[Math.floor(Math.random() * colors.length)], star: Math.random() < .25
  }));
  const start = performance.now();
  (function tick(t){
    g.clearRect(0, 0, W, H);
    bits.forEach((b) => {
      b.vy += .32; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c;
      if(b.star){ g.font = (b.s * 2) + "px serif"; g.fillText("✦", -b.s, b.s); }
      else g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      g.restore();
    });
    if(t - start < 3200) requestAnimationFrame(tick);
    else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); canvas.hidden = true; confettiOn = false; }
  })(start);
}

function renderLock(){
  const ok = isMember();
  lock.hidden = ok;
  form.hidden = !ok;
  $("chat-quick").hidden = !ok;
  const st = notifState();
  notifBtn.hidden = st !== "default";
  notifNote.hidden = st !== "denied";
}

// open/close with a soft scale-and-fade from the Chat button
function isOpen(){ return panel.classList.contains("show"); }
function openChat(){
  panel.hidden = false;
  document.documentElement.classList.add("chat-open");
  requestAnimationFrame(() => panel.classList.add("show"));
  fab.setAttribute("aria-expanded", "true"); fab.classList.add("active");
  unread = 0; mentionedUnread = false; setBadge(); renderLock();
  newPill.hidden = true;
  toBottom(false);
  if(!form.hidden && matchMedia("(hover: hover)").matches) setTimeout(() => input.focus({ preventScroll:true }), 60);
}
function closeChat(){
  closeActions(); closePick();
  panel.classList.remove("show");
  document.documentElement.classList.remove("chat-open");
  fab.setAttribute("aria-expanded", "false"); fab.classList.remove("active");
  setTimeout(() => { if(!isOpen()) panel.hidden = true; }, reduceMotion ? 0 : 220);
  fab.focus({ preventScroll:true });
}
fab.addEventListener("click", () => isOpen() ? closeChat() : openChat());
$("chat-close").addEventListener("click", closeChat);
document.addEventListener("keydown", (e) => {
  if(e.key !== "Escape") return;
  if(!viewer.hidden) closeViewer();
  else if(openRow) closeActions();
  else if(replyTo) cancelReply();
  else if(isOpen()) closeChat();
});

function updateSend(){ send.disabled = !input.value.trim() && !attach; }
input.addEventListener("input", updateSend);

async function post(text){
  text = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if((!text && !attach) || !isMember()) return;
  const data = { by:squad.uid, text, at:Date.now() };
  if(attach) data.img = attach;
  if(replyTo){ data.replyTo = replyTo.id; data.replyBy = replyTo.by; data.replyText = snippet(replyTo); }
  const men = findMentions(text);
  if(men.ids.length) data.mentions = men.ids.slice(0, 30);
  if(men.everyone) data.everyone = true;
  // clear the composer right away so sending feels instant
  const saved = input.value;
  input.value = ""; cancelReply(); clearAttach(); updateSend();
  send.classList.add("sending");
  try{
    await addDoc(collection(db, "chat"), data);
    toBottom(true);
  }catch(e){
    input.value = saved; updateSend();
    notify("Message didn't send", e && e.code === "permission-denied"
      ? "Chat isn't allowed yet. Publish the updated Firestore rules in the Firebase console."
      : e && e.code === "resource-exhausted"
      ? "The site hit today's free limit. It resets at 3 PM Philippine time."
      : "Check your connection and try again.");
  }finally{
    send.classList.remove("sending");
  }
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if(!pick.hidden && pickItems.length){ choose(pickIdx); return; }
  post(input.value);
  input.focus({ preventScroll:true });
});
QUICK.forEach((q) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "quick"; b.textContent = q;
  b.addEventListener("click", () => post(q));
  $("chat-quick").append(b);
});
notifBtn.addEventListener("click", async () => {
  const st = await enableNotifs();
  renderLock();
  if(st === "granted") notify("Notifications are on", "We'll ping you when the squad posts.");
});

// suggestion list while typing "@"
const pick = $("mention-list");
let pickItems = [], pickIdx = 0, pickStart = -1;
function closePick(){ pick.hidden = true; pickItems = []; pickStart = -1; }
function renderPick(){
  pick.textContent = "";
  pickItems.forEach((it, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "mention-opt" + (i === pickIdx ? " on" : "");
    b.setAttribute("role", "option"); b.setAttribute("aria-selected", i === pickIdx ? "true" : "false");
    if(it.id) b.append(avatarEl(it.id, "small"));
    else { const sp = document.createElement("span"); sp.className = "ava small every"; sp.textContent = "@"; b.append(sp); }
    const n = document.createElement("span"); n.textContent = it.label; b.append(n);
    if(!it.id){ const h = document.createElement("small"); h.textContent = "notify the whole squad"; b.append(h); }
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => choose(i));
    pick.append(b);
  });
  pick.hidden = !pickItems.length;
}
function updatePick(){
  const pos = input.selectionStart || 0, before = input.value.slice(0, pos);
  const at = before.lastIndexOf("@");
  if(at < 0 || (at > 0 && !/\s/.test(before.charAt(at - 1)))){ closePick(); return; }
  const q = before.slice(at + 1).toLowerCase();
  if(q.length > 24){ closePick(); return; }
  const people = memberIds().filter((id) => id !== squad.uid && squad.members[id].going !== false)
    .map((id) => ({ id, label:nick(id) }))
    .filter((it) => it.label.toLowerCase().startsWith(q) || it.label.toLowerCase().includes(" " + q))
    .sort((a, b) => a.label.localeCompare(b.label)).slice(0, 6);
  const items = ("everyone".startsWith(q) ? [{ id:null, label:"everyone" }] : []).concat(people);
  pickStart = at; pickItems = items; pickIdx = 0; renderPick();
}
function choose(i){
  const it = pickItems[i]; if(!it) return;
  const pos = input.selectionStart || 0;
  const insert = "@" + it.label + " ";
  input.value = input.value.slice(0, pickStart) + insert + input.value.slice(pos);
  const caret = pickStart + insert.length;
  input.setSelectionRange(caret, caret);
  closePick(); updateSend(); input.focus();
}
input.addEventListener("input", updatePick);
input.addEventListener("click", updatePick);
input.addEventListener("blur", () => setTimeout(closePick, 150));
input.addEventListener("keydown", (e) => {
  if(pick.hidden || !pickItems.length) return;
  if(e.key === "ArrowDown"){ e.preventDefault(); pickIdx = (pickIdx + 1) % pickItems.length; renderPick(); }
  else if(e.key === "ArrowUp"){ e.preventDefault(); pickIdx = (pickIdx - 1 + pickItems.length) % pickItems.length; renderPick(); }
  else if(e.key === "Tab"){ e.preventDefault(); choose(pickIdx); }
  else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closePick(); }
});
// "@" button for phones, where the @ key is buried
$("chat-mention-btn").addEventListener("click", () => {
  const pos = input.selectionStart ?? input.value.length;
  const pre = input.value.slice(0, pos), needSpace = pre && !/\s$/.test(pre);
  input.value = pre + (needSpace ? " @" : "@") + input.value.slice(pos);
  const caret = pos + (needSpace ? 2 : 1);
  input.focus(); input.setSelectionRange(caret, caret); updatePick(); updateSend();
});

updateSend();
if(configured){
  onSquad((sq) => {
    if(!sq.uid) return;
    fab.hidden = false;
    renderLock();
    // later squad updates (presence ticks) only rebuild rows whose names or photos changed
    if(started){ render(); return; }
    started = true;
    let first = true;
    onSnapshot(query(collection(db, "chat"), orderBy("at"), limitToLast(80)), (snap) => {
      if(!first){
        snap.docChanges().forEach((ch) => {
          const m = ch.doc.data();
          if(ch.type !== "added") return;
          if(m.text && BDAY.test(m.text)) confetti();
          if(m.by === squad.uid) return;
          const body = m.text || "📷 Sent a photo";
          if(mentionsMe(m)){
            // mentions always ping, even with the chat open
            if(!isOpen()){ unread++; mentionedUnread = true; setBadge(); }
            notify(nick(m.by) + (m.everyone ? " → @everyone" : " mentioned you"), body, "mention-" + ch.doc.id);
          } else if(!isOpen() || document.hidden){
            if(!isOpen()){ unread++; setBadge(); }
            notify(nick(m.by), body, "chat");
          }
        });
      }
      first = false;
      messages = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
      byId = {}; messages.forEach((m) => { byId[m.id] = m; });
      loaded = true;
      render();
    }, () => { lock.hidden = false; lock.textContent = "Chat lost its connection. Reload the page."; });
  });
}
