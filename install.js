// "Add to home screen" banner: an Install button where the browser offers one,
// and short steps for iPhone, which only installs from the Share menu
(function(){
  var box = document.getElementById("install"), btn = document.getElementById("install-btn");
  var how = document.getElementById("install-how"), deferred = null;
  var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var dismissed = false;
  try{ dismissed = localStorage.getItem("bgc-install-hidden") === "1"; }catch(e){}
  if(standalone || dismissed) return;

  if(ios){
    var safari = !/crios|fxios|edgios/i.test(navigator.userAgent);
    how.textContent = safari
      ? "Tap the Share button (square with an arrow), then “Add to Home Screen”."
      : "Open this page in Safari, tap Share, then “Add to Home Screen”.";
    box.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", function(e){
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
    box.hidden = false;
  });
  btn.addEventListener("click", function(){
    if(!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function(){ deferred = null; btn.hidden = true; });
  });
  window.addEventListener("appinstalled", function(){ box.hidden = true; });
  document.getElementById("install-x").addEventListener("click", function(){
    box.hidden = true;
    try{ localStorage.setItem("bgc-install-hidden", "1"); }catch(e){}
  });
})();
