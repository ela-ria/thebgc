// shrink a phone video in the browser so it fits in the free database:
// replays it into a small canvas (short side 480 px) and records that at a low bitrate
export const MAX_SECONDS = 30;

function once(el, ev){ return new Promise((res, rej) => {
  el.addEventListener(ev, res, { once:true });
  el.addEventListener("error", () => rej(new Error("decode")), { once:true });
}); }

export function canCompress(){
  return typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
}

function pickType(){
  const types = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

// resolves { blob, poster } where poster is a small JPEG of the first frame
export async function compressVideo(file, onProgress){
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.playsInline = true; v.preload = "auto"; v.src = url;
  try{
    await once(v, "loadedmetadata");
    if(!isFinite(v.duration) || v.duration > MAX_SECONDS + 0.5){
      const e = new Error("too-long"); e.code = "too-long"; throw e;
    }
    const k = Math.min(1, 480 / Math.min(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * k / 2) * 2, h = Math.round(v.videoHeight * k / 2) * 2;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");

    // poster from the first frame
    v.currentTime = Math.min(0.1, v.duration / 2);
    await once(v, "seeked");
    g.drawImage(v, 0, 0, w, h);
    const pk = Math.min(1, 320 / Math.max(w, h));
    const pc = document.createElement("canvas"); pc.width = Math.round(w * pk); pc.height = Math.round(h * pk);
    pc.getContext("2d").drawImage(c, 0, 0, pc.width, pc.height);
    const poster = pc.toDataURL("image/jpeg", 0.7);
    v.currentTime = 0;
    await once(v, "seeked");

    const stream = c.captureStream(24);
    let ac = null;
    try{
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest); // recorded, not played out loud
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }catch(e){ v.muted = true; }

    const type = pickType();
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType:type } : {}), videoBitsPerSecond:600000, audioBitsPerSecond:64000 });
    const parts = [];
    rec.ondataavailable = (e) => { if(e.data && e.data.size) parts.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });

    let raf = 0;
    const draw = () => {
      g.drawImage(v, 0, 0, w, h);
      if(onProgress) onProgress(Math.min(1, v.currentTime / v.duration));
      if(!v.ended) raf = requestAnimationFrame(draw);
    };
    rec.start(1000);
    try{ if(ac) await ac.resume(); await v.play(); }
    catch(e){ v.muted = true; await v.play(); }
    draw();
    await once(v, "ended");
    cancelAnimationFrame(raf);
    rec.stop();
    await stopped;
    if(ac) ac.close().catch(() => {});
    return { blob: new Blob(parts, { type: (type || "video/webm").split(";")[0] }), poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
