(() => {
  console.log("MONEYJS LOADED ✅");

  // =========================
  // Supabase config
  // =========================
  const SUPABASE_URL = "https://ndenlrgvkxducyxupqcg.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_ryQFuKZHzdxvojEd1oRfGQ_P2cnwu2T";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // =========================
  // Helpers
  // =========================
  const $ = (id) => document.getElementById(id);
  const fmtTHB = (n) => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });

  // ✅ วันที่แบบ Local (แก้ปัญหา UTC ทำวันเลื่อน)
  function isoLocalDate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ✅ ช่วงเดือนแบบ Local (ห้ามใช้ toISOString())
  function monthRangeISO(dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    const y = d.getFullYear();
    const m = d.getMonth();

    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);

    return { start: isoLocalDate(start), endExclusive: isoLocalDate(end) };
  }

  function showToast(el, msg, ok = true) {
    el.textContent = msg;
    el.classList.remove("hidden");
    el.style.borderColor = ok ? "rgba(82,214,255,.35)" : "rgba(255,140,140,.35)";
    setTimeout(() => el.classList.add("hidden"), 3000);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // =========================
  // UI refs
  // =========================
  const viewAuth = $("viewAuth");
  const viewApp = $("viewApp");

  const authEmail = $("authEmail");
  const authPass = $("authPass");
  const authMsg = $("authMsg");
  const btnLogin = $("btnLogin");
  const btnRegister = $("btnRegister");
  const btnGithub = $("btnGithub");

  const btnLogout = $("btnLogout");
  const btnAdd = $("btnAdd");

  const todayLabel = $("todayLabel");
  const monthLabel = $("monthLabel");
  const datePicker = $("datePicker");
  const list = $("list");
  const emptyState = $("emptyState");

  const sumIncomeToday = $("sumIncomeToday");
  const sumExpenseToday = $("sumExpenseToday");
  const sumNetToday = $("sumNetToday");

  const sumIncomeMonth = $("sumIncomeMonth");
  const sumExpenseMonth = $("sumExpenseMonth");
  const sumNetMonth = $("sumNetMonth");

  // modal
  const modal = $("modal");
  const btnCloseModal = $("btnCloseModal");
  const btnSave = $("btnSave");
  const modalMsg = $("modalMsg");
  const modalTitle = $("modalTitle");

  const txDate = $("txDate");
  const txType = $("txType");
  const txCat = $("txCat");
  const txAmt = $("txAmt");
  const txNote = $("txNote");

  // =========================
  // State
  // =========================
  let currentUser = null;
  let currentDate = isoLocalDate(); // ✅ วันนี้ตาม local
  let txCache = [];
  let realtimeChannel = null;
  let editingId = null;

  // =========================
  // Auth + profile
  // =========================
  async function ensureProfile(userId) {
    const { data: existing, error: selErr } = await sb
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) throw selErr;

    if (!existing) {
      const { error: insErr } = await sb.from("profiles").insert({ user_id: userId, mode: "daily" });
      if (insErr) throw insErr;
    }
  }

  async function signUp() {
    const email = authEmail.value.trim();
    const password = authPass.value.trim();
    if (!email || password.length < 6) return showToast(authMsg, "กรอกอีเมล และรหัสผ่านอย่างน้อย 6 ตัว", false);

    // ถ้าคุณปิด confirm email (dev mode) จะสมัครแล้วล็อกอินได้ทันที
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) return showToast(authMsg, error.message, false);

    showToast(authMsg, "สมัครสำเร็จ!", true);

    if (data?.user?.id) await ensureProfile(data.user.id);
  }

  async function signIn() {
    const email = authEmail.value.trim();
    const password = authPass.value.trim();
    if (!email || !password) return showToast(authMsg, "กรอกอีเมลและรหัสผ่าน", false);

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showToast(authMsg, error.message, false);

    currentUser = data.user;
    await ensureProfile(currentUser.id);
    await enterApp();
  }

  async function signInWithGithub() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
    if (error) return showToast(authMsg, error.message, false);
  }

  async function signOut() {
    await sb.auth.signOut();
    currentUser = null;
    exitApp();
  }

  function exitApp() {
    viewApp.classList.add("hidden");
    viewAuth.classList.remove("hidden");
    btnLogout.classList.add("hidden");
  }

  // =========================
  // App view
  // =========================
  async function enterApp() {
    viewAuth.classList.add("hidden");
    viewApp.classList.remove("hidden");
    btnLogout.classList.remove("hidden");

    currentDate = isoLocalDate(); // ✅ ไม่ใช้ toISOString
    txDate.value = currentDate;

    todayLabel.textContent = `วันที่ ${currentDate}`;
    const d = new Date(currentDate + "T00:00:00");
    monthLabel.textContent = `เดือน ${d.toLocaleDateString("th-TH", { month: "long", year: "numeric" })}`;

    fillDatePicker();
    await refreshMonthData();
    renderByDate(currentDate);
    setupRealtime();
  }

  function fillDatePicker() {
    datePicker.innerHTML = "";
    const base = new Date(currentDate + "T00:00:00"); // ✅ ยึดจาก currentDate

    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const iso = isoLocalDate(d); // ✅ ไม่ใช้ toISOString

      const opt = document.createElement("option");
      opt.value = iso;
      opt.textContent = iso;
      if (iso === currentDate) opt.selected = true;
      datePicker.appendChild(opt);
    }
  }

  async function refreshMonthData() {
    if (!currentUser) return;
    const { start, endExclusive } = monthRangeISO(currentDate);

    const { data, error } = await sb
      .from("transactions")
      .select("id, date, type, category, amount, note, created_at")
      // ✅ แนะนำกรอง user_id เผื่อ RLS/ความชัวร์
      .eq("user_id", currentUser.id)
      .gte("date", start)
      .lt("date", endExclusive)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    txCache = data || [];
    renderMonthSummary();
  }

  function renderMonthSummary() {
    const income = txCache.filter((x) => x.type === "income").reduce((s, x) => s + Number(x.amount), 0);
    const expense = txCache.filter((x) => x.type === "expense").reduce((s, x) => s + Number(x.amount), 0);
    sumIncomeMonth.textContent = fmtTHB(income);
    sumExpenseMonth.textContent = fmtTHB(expense);
    sumNetMonth.textContent = fmtTHB(income - expense);
  }

  function renderByDate(dateISO) {
    currentDate = dateISO;
    todayLabel.textContent = `วันที่ ${dateISO}`;

    const dayTx = txCache.filter((x) => x.date === dateISO);

    const income = dayTx.filter((x) => x.type === "income").reduce((s, x) => s + Number(x.amount), 0);
    const expense = dayTx.filter((x) => x.type === "expense").reduce((s, x) => s + Number(x.amount), 0);

    sumIncomeToday.textContent = fmtTHB(income);
    sumExpenseToday.textContent = fmtTHB(expense);
    sumNetToday.textContent = fmtTHB(income - expense);

    list.innerHTML = "";
    if (dayTx.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    for (const t of dayTx) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item-left">
          <div><strong>${escapeHtml(t.category)}</strong></div>
          <div class="tag">${escapeHtml(t.note || "")}</div>
        </div>

        <div class="item-right">
          <div class="amt ${t.type}">
            ${t.type === "income" ? "+" : "-"}${fmtTHB(t.amount)}
          </div>
          <button class="btn ghost btn-edit" data-id="${t.id}">แก้ไข</button>
          <button class="btn danger btn-delete" data-id="${t.id}">ลบ</button>
        </div>
      `;
      list.appendChild(div);
    }

    // ✅ bind events (แยก ไม่ซ้อน)
    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", () => deleteTransaction(btn.dataset.id));
    });

    document.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const tx = txCache.find((x) => String(x.id) === String(id));
        if (!tx) return;
        openModal(tx);
      });
    });
  }

  // =========================
  // Delete
  // =========================
  async function deleteTransaction(id) {
    if (!currentUser) return;

    const { error } = await sb
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", currentUser.id);

    if (error) return showToast(modalMsg, error.message, false);

    await refreshMonthData();
    renderByDate(currentDate);
  }

  // =========================
  // Modal + save
  // =========================
  function openModal(tx = null) {
    modal.classList.remove("hidden");

    if (tx) {
      // โหมดแก้ไข
      editingId = tx.id;
      modalTitle.textContent = "แก้ไขรายการ";
      btnSave.textContent = "บันทึกการแก้ไข";

      txDate.value = tx.date;
      txType.value = tx.type;
      txCat.value = tx.category || "อื่นๆ";
      txAmt.value = tx.amount;
      txNote.value = tx.note || "";
    } else {
      // โหมดเพิ่ม
      editingId = null;
      modalTitle.textContent = "เพิ่มรายการ";
      btnSave.textContent = "บันทึก";

      txDate.value = currentDate;
      txType.value = "income";
      txCat.value = "ค่าแรง";
      txAmt.value = "";
      txNote.value = "";
    }
  }

  function closeModal() {
    modal.classList.add("hidden");
    editingId = null;
    modalTitle.textContent = "เพิ่มรายการ";
    btnSave.textContent = "บันทึก";
  }

  async function saveTransaction() {
    if (!currentUser) return;

    const date = txDate.value;
    const type = txType.value;
    const category = txCat.value.trim();
    const amount = Number(txAmt.value);
    const note = txNote.value.trim();

    if (!date || !category || !Number.isFinite(amount) || amount <= 0) {
      return showToast(modalMsg, "กรอกวันที่/หมวด/จำนวนเงินให้ถูกต้อง", false);
    }

    if (editingId) {
      // UPDATE
      const { error } = await sb
        .from("transactions")
        .update({ date, type, category, amount, note: note || null })
        .eq("id", editingId)
        .eq("user_id", currentUser.id);

      if (error) return showToast(modalMsg, error.message, false);
      showToast(modalMsg, "แก้ไขแล้ว", true);
    } else {
      // INSERT
      const { error } = await sb
        .from("transactions")
        .insert({ user_id: currentUser.id, date, type, category, amount, note: note || null });

      if (error) return showToast(modalMsg, error.message, false);
      showToast(modalMsg, "บันทึกแล้ว", true);
    }

    closeModal();
    await refreshMonthData();
    renderByDate(date);
  }

  // =========================
  // Realtime
  // =========================
  function setupRealtime() {
    if (!currentUser) return;

    if (realtimeChannel) {
      sb.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    realtimeChannel = sb
      .channel("tx-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${currentUser.id}` },
        async () => {
          await refreshMonthData();
          renderByDate(currentDate);
        }
      )
      .subscribe();
  }

  // =========================
  // Events
  // =========================
  btnRegister.addEventListener("click", () => signUp().catch((e) => showToast(authMsg, e.message, false)));
  btnLogin.addEventListener("click", () => signIn().catch((e) => showToast(authMsg, e.message, false)));
  btnGithub.addEventListener("click", () => signInWithGithub().catch((e) => showToast(authMsg, e.message, false)));
  btnLogout.addEventListener("click", () => signOut());

  btnAdd.addEventListener("click", () => openModal());
  btnCloseModal.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  btnSave.addEventListener("click", () => saveTransaction().catch((e) => showToast(modalMsg, e.message, false)));

  datePicker.addEventListener("change", (e) => renderByDate(e.target.value));

  // =========================
  // Boot
  // =========================
  (async function init() {
    const { data } = await sb.auth.getSession();
    currentUser = data?.session?.user ?? null;

    if (currentUser) {
      await ensureProfile(currentUser.id);
      await enterApp();
    } else {
      exitApp();
    }

    sb.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user ?? null;
      if (currentUser) {
        await ensureProfile(currentUser.id);
        await enterApp();
      } else {
        exitApp();
      }
    });
  })();
})();
