// birthday wishes for Jaspher: one wish per person, everyone can read them
import { configured, db } from "./firebase.js";
import { squad, onSquad, nick, isMember, toast, notify, avatarEl } from "./squad.js";
import { collection, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $("wish-form"), text = $("wish-text"), save = $("wish-save"), count = $("wish-count");
const wall = $("wish-wall"), lock = $("wish-lock"), empty = $("wish-empty");
let wishes = {}, started = false, typed = false;
const fmt = new Intl.DateTimeFormat("en-PH", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });

function render(){
  const member = isMember();
  form.hidden = !member;
  lock.hidden = member;
  const mine = squad.uid && wishes[squad.uid];
  save.textContent = mine ? "Update my wish" : "Post my wish";
  if(mine && !typed && document.activeElement !== text){ text.value = mine.text; count.textContent = text.value.length + " / 600"; }

  wall.querySelectorAll(".wish").forEach((n) => n.remove());
  const ids = Object.keys(wishes).filter((id) => wishes[id].text).sort((a, b) => wishes[b].at - wishes[a].at);
  empty.hidden = ids.length > 0;
  ids.forEach((id) => {
    const w = wishes[id];
    const card = document.createElement("article"); card.className = "wish" + (id === squad.uid ? " mine" : "");
    const head = document.createElement("header");
    const who = document.createElement("b"); who.textContent = id === squad.uid ? nick(id) + " (you)" : nick(id);
    const when = document.createElement("time"); when.textContent = fmt.format(new Date(w.at));
    head.append(avatarEl(id), who, when);
    const body = document.createElement("p"); body.textContent = w.text;
    card.append(head, body);
    wall.append(card);
  });
}

text.addEventListener("input", () => { typed = true; count.textContent = text.value.length + " / 600"; });
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = text.value.trim().slice(0, 600);
  if(!t){ toast("Write a wish first."); text.focus(); return; }
  save.disabled = true;
  try{
    await setDoc(doc(db, "wishes", squad.uid), { text:t, at:Date.now() });
    typed = false;
    toast("Wish posted! Jaspher's going to love it.");
  }catch(err){
    toast("Couldn't post your wish. Check your connection and try again.");
  }finally{ save.disabled = false; }
});

if(!configured){
  lock.textContent = "Wishes open once the shared plan is connected.";
} else {
  onSquad((sq) => {
    if(!sq.uid) return;
    render();
    if(started) return;
    started = true;
    let first = true;
    const listen = () => onSnapshot(collection(db, "wishes"), (snap) => {
      if(!first){
        snap.docChanges().forEach((ch) => {
          if(ch.type === "added" && ch.doc.id !== squad.uid) notify(nick(ch.doc.id) + " left a birthday wish", ch.doc.data().text, "wish");
        });
      }
      first = false;
      const w = {};
      snap.forEach((d) => { w[d.id] = d.data(); });
      wishes = w; render();
    }, () => setTimeout(listen, 10000));
    listen();
  });
}
