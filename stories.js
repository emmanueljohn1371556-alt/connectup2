import { db, $, collection, query, where, orderBy, limit, onSnapshot, addDoc, deleteDoc, doc } from "./core.js";

export function initStories(me, fileToImage) {
  // ---------- Stories ----------
  let storyGroups = new Map(), storyTimer = null, vUid = null, vIdx = 0;
  const DAY = 24 * 60 * 60 * 1000;

  function storyItem(inner, label, onclick, ring) {
    const b = document.createElement("button");
    b.className = "story";
    const c = document.createElement("div");
    c.className = "scircle" + (ring ? " ring" : "");
    if (typeof inner === "string") c.textContent = inner; else c.appendChild(inner);
    const l = document.createElement("div");
    l.className = "slabel"; l.textContent = label;
    b.append(c, l);
    b.onclick = onclick;
    return b;
  }

  function renderStories() {
    const box = $("stories");
    box.innerHTML = "";
    box.appendChild(storyItem("＋", "Photo", () => $("storyFile").click(), false));
    box.appendChild(storyItem("Aa", "Text", textStory, false));
    const uids = [...storyGroups.keys()].sort((a, b) => (a === me.uid ? -1 : b === me.uid ? 1 : 0));
    uids.forEach((uid) => {
      const arr = storyGroups.get(uid);
      const first = arr[arr.length - 1];
      const av = first.avatar ? Object.assign(document.createElement("img"), { src: first.avatar, alt: "" }) : (first.name || "?").charAt(0).toUpperCase();
      box.appendChild(storyItem(av, uid === me.uid ? "Your story" : (first.name || first.username || "User"), () => openStory(uid, 0), true));
    });
  }

  function startStories() {
    const cutoff = Date.now() - DAY;
    onSnapshot(query(collection(db, "stories"), where("createdAt", ">", cutoff), orderBy("createdAt", "asc"), limit(100)), (snap) => {
      storyGroups = new Map();
      snap.docs.forEach((d) => {
        const st = { id: d.id, ...d.data() };
        if (me.blocked.includes(st.uid)) return;
        if (!storyGroups.has(st.uid)) storyGroups.set(st.uid, []);
        storyGroups.get(st.uid).push(st);
      });
      renderStories();
    }, () => { renderStories(); });
    renderStories();
  }

  function closeStory() {
    clearTimeout(storyTimer);
    $("viewer").style.display = "none";
  }

  function openStory(uid, idx) {
    clearTimeout(storyTimer);
    const arr = storyGroups.get(uid);
    if (!arr || idx < 0 || idx >= arr.length) { closeStory(); return; }
    vUid = uid; vIdx = idx;
    const st = arr[idx];
    $("viewer").style.display = "block";
    $("vname").textContent = st.name || st.username || "User";
    const bars = $("vbars");
    bars.innerHTML = "";
    arr.forEach((_, i) => { const b = document.createElement("div"); if (i <= idx) b.className = "done"; bars.appendChild(b); });
    const img = $("vimg");
    if (st.image) { img.src = st.image; img.style.display = "block"; $("vbody").style.background = "#000"; }
    else { img.style.display = "none"; $("vbody").style.background = "linear-gradient(135deg, var(--accent), #ff1493)"; }
    $("vtext").textContent = st.text || "";
    $("vdel").style.display = st.uid === me.uid ? "inline-block" : "none";
    $("vdel").onclick = async () => {
      if (!confirm("Delete this story?")) return;
      try { await deleteDoc(doc(db, "stories", st.id)); } catch (e) { alert("Could not delete."); }
      closeStory();
    };
    storyTimer = setTimeout(() => openStory(uid, idx + 1), 5000);
  }
  $("vclose").onclick = closeStory;
  $("vnext").onclick = () => openStory(vUid, vIdx + 1);
  $("vprev").onclick = () => openStory(vUid, vIdx - 1);

  async function postStory(image, text) {
    try {
      await addDoc(collection(db, "stories"), {
        uid: me.uid, name: me.name, username: me.username, avatar: me.avatar || "",
        image: image || "", text: (text || "").slice(0, 200), createdAt: Date.now()
      });
    } catch (e) { alert("Could not post story: " + (e.code || e.message)); }
  }
  function textStory() {
    const t = prompt("Write your story (max 200 characters):");
    if (t && t.trim()) postStory("", t.trim());
  }
  $("storyFile").onchange = async () => {
    const f = $("storyFile").files[0];
    if (!f) return;
    try {
      const img = await fileToImage(f);
      if (img.length > 450000) { alert("That photo is too large."); return; }
      const cap = prompt("Add a caption (optional):") || "";
      await postStory(img, cap);
    } catch (e) { alert("Could not read that photo."); }
    $("storyFile").value = "";
  };

  startStories();
}
