import { auth, db, $, watchBadge, avatarEl, loadMe, notify, timeAgo, onAuthStateChanged,
         collection, addDoc, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc,
         query, where, orderBy, limit, onSnapshot, arrayUnion, arrayRemove } from "./core.js";
import { initStories } from "./stories.js";

  // Video uploads use a free Cloudinary account (see setup steps)
  const CLOUD_NAME = "uvqtjbds";
  const UPLOAD_PRESET = "User_upload";
  let pendingVideo = "", pendingVideoUrl = "", uploading = false;
  function parseVideo(u) {
    u = (u || "").trim();
    let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return "https://www.youtube.com/embed/" + m[1];
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return "https://player.vimeo.com/video/" + m[1];
    return "";
  }
  $("linkBtn").onclick = () => {
    const u = prompt("Paste a YouTube or Vimeo link:");
    if (!u) return;
    const v = parseVideo(u);
    if (!v) { $("status").textContent = "Only YouTube and Vimeo links work here."; return; }
    pendingVideo = v; pendingVideoUrl = "";
    $("videoChip").textContent = "🔗 Video link attached (tap to remove)";
    $("videoChip").style.display = "block";
  };
  $("videoChip").onclick = () => {
    if (uploading) return;
    pendingVideo = ""; pendingVideoUrl = ""; $("videoChip").style.display = "none";
  };

  function videoDuration(file) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      v.preload = "metadata";
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration || 0); };
      v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      v.src = url;
    });
  }

  function uploadVideo(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CLOUD_NAME + "/video/upload");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        try {
          const r = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && r.secure_url) resolve(r.secure_url);
          else reject(new Error((r.error && r.error.message) || "Upload failed"));
        } catch (e) { reject(new Error("Upload failed")); }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", UPLOAD_PRESET);
      xhr.send(fd);
    });
  }

  $("videoBtn").onclick = () => $("videoFile").click();
  $("videoFile").onchange = async () => {
    const f = $("videoFile").files[0];
    $("videoFile").value = "";
    if (!f) return;
    $("status").textContent = "";
    if (CLOUD_NAME === "YOUR_CLOUD_NAME") { $("status").textContent = "Video uploads are not set up yet."; return; }
    if (!f.type.startsWith("video/")) { $("status").textContent = "Please choose a video file."; return; }
    if (f.size > 100 * 1024 * 1024) { $("status").textContent = "Video must be under 100 MB."; return; }
    const dur = await videoDuration(f);
    if (dur > 60) { $("status").textContent = "Videos can be at most 60 seconds."; return; }
    uploading = true;
    $("postBtn").disabled = true;
    $("videoChip").style.display = "block";
    $("videoChip").textContent = "🎬 Uploading… 0%";
    try {
      const url = await uploadVideo(f, (pct) => { $("videoChip").textContent = "🎬 Uploading… " + pct + "%"; });
      pendingVideoUrl = url; pendingVideo = "";
      $("videoChip").textContent = "🎬 Video ready (tap to remove)";
    } catch (e) {
      $("videoChip").style.display = "none";
      $("status").textContent = "Upload failed: " + e.message;
    }
    uploading = false;
    $("postBtn").disabled = false;
  };

  let pendingImage = "";
  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let out = c.toDataURL("image/jpeg", 0.7);
        if (out.length > 350000) out = c.toDataURL("image/jpeg", 0.5);
        resolve(out);
      };
      img.onerror = () => reject(new Error("bad image"));
      img.src = url;
    });
  }
  $("photoBtn").onclick = () => $("photoFile").click();
  $("photoFile").onchange = async () => {
    const f = $("photoFile").files[0];
    if (!f) return;
    try {
      pendingImage = await fileToImage(f);
      if (pendingImage.length > 450000) { pendingImage = ""; $("status").textContent = "That photo is too large."; return; }
      $("preview").src = pendingImage;
      $("preview").style.display = "block";
    } catch (e) { $("status").textContent = "Could not read that photo."; }
  };
  let me = null, started = false, mode = "all", followIds = [], postsUnsub = null, gotData = false;
  const openPosts = new Set();
  let commentUnsubs = [];

  function buildComments(postId, ownerUid) {
    const box = document.createElement("div");
    box.className = "comments";
    const list = document.createElement("div");
    const row = document.createElement("div");
    row.className = "crow";
    const input = document.createElement("input");
    input.className = "cinput"; input.maxLength = 200; input.placeholder = "Write a comment…";
    const send = document.createElement("button");
    send.textContent = "Send";
    row.append(input, send);
    box.append(list, row);

    send.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        await addDoc(collection(db, "posts", postId, "comments"), {
          uid: me.uid, name: me.name, username: me.username, text, createdAt: Date.now()
        });
        notify(me, ownerUid, "comment", postId, text);
        input.value = "";
      } catch (e) { alert("Could not comment: " + (e.code || e.message)); }
      send.disabled = false;
    };

    const q = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"), limit(50));
    commentUnsubs.push(onSnapshot(q, (snap) => {
      list.innerHTML = "";
      snap.forEach((d) => {
        const c = d.data();
        if (me.blocked.includes(c.uid)) return;
        const line = document.createElement("div");
        line.className = "comment";
        const b = document.createElement("b");
        b.textContent = (c.name || c.username || "User") + " ";
        const t = document.createElement("span");
        t.textContent = c.text;
        line.append(b, t);
        if (c.uid === me.uid) {
          const x = document.createElement("button");
          x.className = "del"; x.textContent = "✕";
          x.onclick = () => deleteDoc(doc(db, "posts", postId, "comments", d.id)).catch(() => alert("Could not delete."));
          line.appendChild(x);
        }
        list.appendChild(line);
      });
    }, () => {}));
    return box;
  }

  function renderPost(id, p) {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "head";
    const who = document.createElement("div");
    who.className = "grow";
    const author = document.createElement("a");
    author.href = "Profile.html?u=" + encodeURIComponent(p.uid);
    author.style.cssText = "color:inherit;text-decoration:none";
    author.className = "author";
    author.textContent = p.name || p.username || "User";
    const handle = document.createElement("span");
    handle.className = "handle";
    handle.textContent = p.username ? "  @" + p.username : "";
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = timeAgo(p.createdAt);
    who.append(author, handle, time);
    head.append(avatarEl(p.avatar, p.name || p.username), who);

    if (p.uid === me.uid) {
      const del = document.createElement("button");
      del.className = "del"; del.textContent = "Delete";
      del.onclick = async () => {
        if (!confirm("Delete this post?")) return;
        try { await deleteDoc(doc(db, "posts", id)); } catch (e) { alert("Could not delete."); }
      };
      head.appendChild(del);
    }

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = p.text;

    const likes = p.likedBy || [];
    const liked = likes.includes(me.uid);
    const likeBtn = document.createElement("button");
    likeBtn.className = "pill" + (liked ? " on" : "");
    likeBtn.textContent = (liked ? "♥ " : "♡ ") + likes.length;
    likeBtn.onclick = async () => {
      try {
        await updateDoc(doc(db, "posts", id), { likedBy: liked ? arrayRemove(me.uid) : arrayUnion(me.uid) });
        if (!liked) notify(me, p.uid, "like", id, p.text);
      } catch (e) { alert("Like failed: " + (e.code || e.message)); }
    };

    const cBtn = document.createElement("button");
    cBtn.className = "pill";
    cBtn.textContent = "💬 Comments";
    let cBox = null;
    cBtn.onclick = () => {
      if (cBox) { cBox.remove(); cBox = null; openPosts.delete(id); }
      else { cBox = buildComments(id, p.uid); card.appendChild(cBox); openPosts.add(id); }
    };

    card.append(head, text);
    if (p.image) {
      const im = document.createElement("img");
      im.className = "postimg"; im.src = p.image; im.alt = "Photo";
      card.appendChild(im);
    }
    if (p.video && /^https:\/\/(www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(p.video)) {
      const wrap = document.createElement("div");
      wrap.className = "vid";
      const fr = document.createElement("iframe");
      fr.src = p.video; fr.loading = "lazy"; fr.allowFullscreen = true;
      fr.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      fr.setAttribute("allow", "accelerometer; encrypted-media; gyroscope; picture-in-picture");
      wrap.appendChild(fr);
      card.appendChild(wrap);
    }
    if (p.videoUrl && /^https:\/\/res\.cloudinary\.com\//.test(p.videoUrl)) {
      const v = document.createElement("video");
      v.src = p.videoUrl; v.controls = true; v.playsInline = true; v.preload = "metadata";
      v.className = "postimg"; v.style.background = "#000"; v.style.width = "100%";
      v.poster = p.videoUrl.replace(/\.[A-Za-z0-9]+$/, ".jpg");
      card.appendChild(v);
    }
    card.append(likeBtn, cBtn);
    if (p.uid !== me.uid) {
      const rep = document.createElement("button");
      rep.className = "del"; rep.textContent = "Report";
      rep.onclick = async () => {
        const reason = prompt("Why are you reporting this post?");
        if (!reason) return;
        try {
          await addDoc(collection(db, "reports"), { reporter: me.uid, postId: id, postUid: p.uid, reason: reason.slice(0, 200), createdAt: Date.now() });
          alert("Thanks, your report was sent.");
        } catch (e) { alert("Could not send the report."); }
      };
      const blk = document.createElement("button");
      blk.className = "del"; blk.textContent = "Block";
      blk.onclick = async () => {
        if (!confirm("Block " + (p.name || p.username || "this user") + "? You will no longer see their posts.")) return;
        try {
          await updateDoc(doc(db, "users", me.uid), { blocked: arrayUnion(p.uid) });
          me.blocked.push(p.uid);
          subscribePosts();
        } catch (e) { alert("Could not block: " + (e.code || e.message)); }
      };
      card.append(rep, blk);
    }
    if (openPosts.has(id)) { cBox = buildComments(id, p.uid); card.appendChild(cBox); }
    return card;
  }

  function subscribePosts() {
    if (postsUnsub) postsUnsub();
    let q;
    if (mode === "all") {
      q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
    } else {
      const ids = [me.uid, ...followIds].slice(0, 30);
      q = query(collection(db, "posts"), where("uid", "in", ids), limit(100));
    }
    postsUnsub = onSnapshot(q, (snap) => {
      gotData = true;
      $("status").textContent = "";
      commentUnsubs.forEach((u) => u());
      commentUnsubs = [];
      const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() })).filter((d) => !me.blocked.includes(d.data.uid));
      if (mode !== "all") docs.sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0));
      const feed = $("feed");
      feed.innerHTML = "";
      docs.slice(0, 50).forEach((d) => feed.appendChild(renderPost(d.id, d.data)));
      const empty = $("empty");
      empty.textContent = mode === "all" ? "No posts yet. Be the first!" : "No posts yet. Follow people in Search to see their posts here.";
      empty.style.display = docs.length ? "none" : "block";
    }, (err) => {
      $("status").textContent = "Could not load posts: " + err.code;
    });
  }

  function startFeed() {
    setTimeout(() => { if (!gotData) $("status").textContent = "Still connecting to the database…"; }, 8000);
    onSnapshot(query(collection(db, "follows"), where("follower", "==", me.uid)), (s) => {
      followIds = s.docs.map((d) => d.data().following);
      if (mode === "following") subscribePosts();
    }, () => {});
    subscribePosts();
  }

  function setMode(m) {
    mode = m;
    $("tabAll").classList.toggle("on", m === "all");
    $("tabFollowing").classList.toggle("on", m === "following");
    subscribePosts();
  }
  $("tabAll").onclick = () => setMode("all");
  $("tabFollowing").onclick = () => setMode("following");

  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }
    me = await loadMe(user);
    watchBadge(user.uid);
    $("loading").style.display = "none";
    $("app").style.display = "block";
    if (!started) { started = true; startFeed(); initStories(me, fileToImage); }
  });

  $("postText").addEventListener("input", () => {
    $("count").textContent = $("postText").value.length + " / 280";
  });

  $("postBtn").onclick = async () => {
    const text = $("postText").value.trim();
    $("status").textContent = "";
    if (uploading) { $("status").textContent = "Wait for the video to finish uploading."; return; }
    if (!text && !pendingImage && !pendingVideo && !pendingVideoUrl) { $("status").textContent = "Write something or add a photo first."; return; }
    $("postBtn").disabled = true;
    try {
      await addDoc(collection(db, "posts"), {
        uid: me.uid, name: me.name, username: me.username,
        avatar: me.avatar || "", text, image: pendingImage || "", video: pendingVideo || "", videoUrl: pendingVideoUrl || "", likedBy: [], createdAt: Date.now()
      });
      pendingVideo = ""; pendingVideoUrl = ""; $("videoChip").style.display = "none";
      pendingImage = "";
      $("preview").style.display = "none";
      $("photoFile").value = "";
      $("postText").value = "";
      $("count").textContent = "0 / 280";
    } catch (e) {
      $("status").textContent = "Could not post: " + (e.code || e.message);
    }
    $("postBtn").disabled = false;
  };
