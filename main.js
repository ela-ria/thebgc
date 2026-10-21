(function(){
  var target = new Date("2026-10-24T09:00:00+08:00").getTime();
  var d=document.getElementById("cd-d"),
      h=document.getElementById("cd-h"),
      m=document.getElementById("cd-m"),
      s=document.getElementById("cd-s"),
      note=document.getElementById("cd-note");
  function pad(n){return String(n).padStart(2,"0")}
  function tick(){
    var diff = target - Date.now();
    if(diff <= 0){
      d.textContent=h.textContent=m.textContent=s.textContent="00";
      note.textContent = (Date.now() - target) < 24*3600*1000
        ? "It's gala day."
        : "Thanks for coming along.";
      return;
    }
    var sec = Math.floor(diff/1000);
    d.textContent = pad(Math.floor(sec/86400));
    h.textContent = pad(Math.floor(sec%86400/3600));
    m.textContent = pad(Math.floor(sec%3600/60));
    s.textContent = pad(sec%60);
  }
  tick();
  setInterval(tick,1000);

  // download .ics (Apple Calendar, Outlook, etc.)
  var icsBtn = document.getElementById("ics");
  if(icsBtn){
    icsBtn.addEventListener("click", function(){
      var lines = [
        "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//BGC Gala//EN","BEGIN:VEVENT",
        "UID:bgc-gala-20261024@thebgc","DTSTAMP:20261013T000000Z",
        "DTSTART:20261024T010000Z","DTEND:20261024T130000Z",
        "SUMMARY:BGC Gala Day","LOCATION:Saint Rose Transit Terminal\\, Calamba Crossing",
        "DESCRIPTION:Bus leaves Saint Rose Transit Terminal\\, Calamba Crossing at 9:00 AM. Bus home at 9:00 PM from Market Market.",
        "BEGIN:VALARM","TRIGGER:-PT90M","ACTION:DISPLAY","DESCRIPTION:BGC Gala Day","END:VALARM",
        "END:VEVENT","END:VCALENDAR"
      ];
      var blob = new Blob([lines.join("\r\n")], {type:"text/calendar"});
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "bgc-gala-day.ics";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(a.href)}, 1000);
    });
  }

  // remember pack list ticks on this device only
  var boxes = document.querySelectorAll("#packlist input");
  boxes.forEach(function(box, i){
    try{ box.checked = localStorage.getItem("bgc-pack-"+i) === "1"; }catch(e){}
    box.addEventListener("change", function(){
      try{ localStorage.setItem("bgc-pack-"+i, box.checked ? "1" : "0"); }catch(e){}
    });
  });
})();
