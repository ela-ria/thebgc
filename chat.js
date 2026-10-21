// squad chat: short messages with nicknames, quick "nasaan na kayo?" replies
import { configured, db } from "./firebase.js";
import { squad, onSquad, nick, isMember, notify, notifState, enableNotifs, avatarEl, onlineIds } from "./squad.js";
import { collection, addDoc, onSnapshot, query, orderBy, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const fab = $("chat-fab"), badge = $("chat-badge"), panel = $("chat-panel"), list = $("chat-list");
const form = $("chat-form"), input = $("chat-input"), send = $("chat-send"), lock = $("chat-lock");
const notifBtn = $("chat-notif"), notifNote = $("chat-notif-note");
const QUICK = ["Nasaan na kayo?", "Nandito na ako!", "Wait lang, papunta na!", "CR lang saglit", "Kain na tayo!"];

let messages = [], rendered = {}, unread = 0, started = false;
const fmt = new Intl.DateTimeFormat("en-PH", { hour:"numeric", minute:"2-digit" });

function setBadge(){ badge.textContent = unread > 9 ? "9+" : String(unread); badge.hidden = !unread; }
function nearBottom(){ return list.scrollHeight - list.scrollTop - list.clientHeight < 80; }

function render(){
  const stick = nearBottom();
  const seen = {};
  messages.forEach((m) => {
    seen[m.id] = true;
    let row = rendered[m.id];
    if(!row){
      row = document.createElement("div");
      const bubble = document.createElement("div");
      const who = document.createElement("span"), txt = document.createElement("p"), time = document.createElement("time");
      who.className = "who"; txt.className = "txt"; time.className = "time";
      bubble.append(who, txt, time);
      row.append(document.createElement("span"), bubble);
      list.append(row);
      rendered[m.id] = row;
    }
    const mine = m.by === squad.uid, bubble = row.children[1];
    row.className = "msg-row" + (mine ? " mine" : "");
    row.replaceChild(mine ? document.createElement("span") : avatarEl(m.by, "small"), row.children[0]);
    bubble.className = "msg" + (mine ? " mine" : "");
    bubble.children[0].textContent = mine ? "You" : nick(m.by);
    bubble.children[1].textContent = m.text;
    bubble.children[2].textContent = fmt.format(new Date(m.at));
  });
  const on = onlineIds().length;
  $("chat-online").textContent = on ? on + " online now" : "";
  Object.keys(rendered).forEach((id) => { if(!seen[id]){ rendered[id].remove(); delete rendered[id]; } });
  $("chat-empty").hidden = messages.length > 0;
  if(stick) list.scrollTop = list.scrollHeight;
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

function openChat(){
  panel.hidden = false; fab.setAttribute("aria-expanded", "true");
  unread = 0; setBadge(); renderLock();
  list.scrollTop = list.scrollHeight;
  if(!form.hidden) setTimeout(() => input.focus(), 30);
}
function closeChat(){ panel.hidden = true; fab.setAttribute("aria-expanded", "false"); fab.focus(); }
fab.addEventListener("click", () => panel.hidden ? openChat() : closeChat());
$("chat-close").addEventListener("click", closeChat);
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !panel.hidden) closeChat(); });

async function post(text){
  text = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if(!text || !isMember()) return;
  send.disabled = true;
  try{
    await addDoc(collection(db, "chat"), { by:squad.uid, text, at:Date.now() });
    input.value = "";
  }catch(e){
    notify("Message didn't send", e && e.code === "permission-denied"
      ? "Chat isn't allowed yet. Publish the updated Firestore rules in the Firebase console."
      : e && e.code === "resource-exhausted"
      ? "The site hit today's free limit. It resets at 3 PM Philippine time."
      : "Check your connection and try again.");
  }finally{
    send.disabled = false; input.focus();
  }
}
form.addEventListener("submit", (e) => { e.preventDefault(); post(input.value); });
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

if(configured){
  onSquad((sq) => {
    if(!sq.uid) return;
    fab.hidden = false;
    renderLock(); render();
    if(started) return;
    started = true;
    let first = true;
    onSnapshot(query(collection(db, "chat"), orderBy("at"), limitToLast(80)), (snap) => {
      if(!first){
        snap.docChanges().forEach((ch) => {
          const m = ch.doc.data();
          if(ch.type !== "added" || m.by === squad.uid) return;
          if(panel.hidden || document.hidden){
            if(panel.hidden){ unread++; setBadge(); }
            notify(nick(m.by), m.text, "chat");
          }
        });
      }
      first = false;
      messages = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
      render();
    }, () => { lock.hidden = false; lock.textContent = "Chat lost its connection. Reload the page."; });
  });
}
