import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
  import { getAuth, onAuthStateChanged, updateProfile, signOut, EmailAuthProvider,
           reauthenticateWithCredential, deleteUser }
    from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
  import { initializeFirestore, collection, addDoc, deleteDoc, doc, getDoc, getDocs, setDoc,
           updateDoc, query, where, orderBy, limit, onSnapshot, arrayUnion, arrayRemove }
    from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

  const firebaseConfig = {
  apiKey: "AIzaSyASt_xJLUPi1pFcvN1ZicL1Gj5_x1IuXX8",
  authDomain: "connectup-db617.firebaseapp.com",
  projectId: "connectup-db617",
  storageBucket: "connectup-db617.firebasestorage.app",
  messagingSenderId: "174771443294",
  appId: "1:174771443294:web:28dcb5d14491e717a286cf",
  measurementId: "G-YMRMYF20D7"
};

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { experimentalForceLongPolling: true });
  const $ = (id) => document.getElementById(id);

  function watchBadge(uid) {
    const q = query(collection(db, "notifications"), where("to", "==", uid), where("read", "==", false));
    onSnapshot(q, (s) => {
      const b = document.getElementById("alertBadge");
      if (!b) return;
      b.textContent = s.size > 9 ? "9+" : s.size;
      b.style.display = s.size ? "block" : "none";
    }, () => {});
  }

  function avatarEl(avatar, name) {
    if (avatar) {
      const img = document.createElement("img");
      img.className = "av"; img.src = avatar; img.alt = "";
      return img;
    }
    const d = document.createElement("div");
    d.className = "av";
    d.textContent = (name || "?").charAt(0).toUpperCase();
    return d;
  }

  async function loadMe(user) {
    let name = user.displayName || "";
    let username = localStorage.getItem("username") || "";
    let avatar = "";
    let blocked = [];
    let bio = "";
    try {
      const s = await getDoc(doc(db, "users", user.uid));
      if (s.exists()) {
        const d = s.data();
        name = d.name || name; username = d.username || username; avatar = d.avatar || "";
        blocked = d.blocked || []; bio = d.bio || "";
      }
    } catch (e) { console.error(e); }
    return { uid: user.uid, name, username, avatar, blocked, bio, email: user.email };
  }

  function notify(me, to, type, postId, text) {
    if (!to || to === me.uid) return;
    addDoc(collection(db, "notifications"), {
      to, from: me.uid, fromName: me.name || me.username || "Someone",
      type, postId: postId || "", text: text || "", createdAt: Date.now(), read: false
    }).catch(() => {});
  }

  function timeAgo(ms) {
    if (!ms) return "just now";
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return new Date(ms).toLocaleDateString();
  }


  export { auth, db, $, watchBadge, avatarEl, loadMe, notify, timeAgo, onAuthStateChanged,
           collection, addDoc, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc,
           query, where, orderBy, limit, onSnapshot, arrayUnion, arrayRemove };
