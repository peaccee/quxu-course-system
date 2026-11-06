import { supabase, isConfigured } from "./supabase.js";

const $ = (s) => document.querySelector(s);
const message = $("#admin-message");
let currentUser = null;
let selectedCourse = null;
let courses = [];
let dutyProfiles = [];
let students = [];

function notify(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#a04436" : "#39745b";
}
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function duration(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}
function localDate(date) {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, "0"); const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function showDialog(id) { $("#" + id).showModal(); }
function closeDialog(id) { $("#" + id).close(); }

document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(b.dataset.close)));

async function init() {
  if (!isConfigured()) { notify("請先在 js/supabase.js 填入 Supabase URL 與 Publishable Key。", true); return; }
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) { location.replace("./index.html"); return; }
  currentUser = user;
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profileError || profile?.role !== "admin") { await supabase.auth.signOut(); location.replace("./index.html"); return; }
  await Promise.all([loadCourses(), loadDutyProfiles()]);
  notify(`管理者已登入：${user.email}`);
}

async function loadCourses() {
  const { data, error } = await supabase.from("courses").select("id,name,period_label,total_sessions,status,created_at").order("created_at", { ascending: false });
  if (error) { $("#course-list").innerHTML = `<div class="panel">讀取課程失敗：${esc(error.message)}</div>`; return; }
  courses = data || [];
  renderCourses();
}
function renderCourses() {
  const root = $("#course-list");
  if (!courses.length) { root.innerHTML = '<div class="empty-state"><strong>目前還沒有課程</strong><p>請按「新增課程」建立第一個課程期別。</p></div>'; return; }
  root.innerHTML = courses.map(c => `<article class="course-card ${c.status === "archived" ? "is-archived" : ""}">
    <div class="course-card-main"><div class="course-title-row"><h3>${esc(c.name)}</h3><span class="status-pill ${c.status === "active" ? "active" : "archived"}">${c.status === "active" ? "進行中" : "已封存"}</span></div>
    <p class="muted">${esc(c.period_label)} <span class="dot-sep">·</span> 預計 ${c.total_sessions} 堂</p></div>
    <div class="course-actions"><button class="button-secondary" data-action="sessions" data-id="${c.id}">管理堂次</button><button class="button-secondary" data-action="edit" data-id="${c.id}">編輯</button>${c.status === "active" ? `<button class="text-button" data-action="archive" data-id="${c.id}">封存</button>` : ""}</div>
  </article>`).join("");
  root.querySelectorAll("button[data-action]").forEach(b => b.addEventListener("click", () => handleCourseAction(b.dataset.action, b.dataset.id)));
}
async function loadDutyProfiles() {
  const { data, error } = await supabase.from("profiles").select("id,display_name,role").in("role", ["admin", "staff"]).order("display_name");
  if (error) { notify(`讀取值班人員失敗：${error.message}`, true); return; }
  dutyProfiles = data || [];
  ["#session-duty", "#batch-duty"].forEach(sel => {
    $(sel).innerHTML = '<option value="">未指定</option>' + dutyProfiles.map(p => `<option value="${p.id}">${esc(p.display_name || (p.role === "admin" ? "管理者" : "未命名人員"))}</option>`).join("");
  });
}
async function handleCourseAction(action, id) {
  const course = courses.find(c => c.id === id);
  if (!course) return;
  if (action === "sessions") { selectedCourse = course; await loadSessions(); return; }
  if (action === "edit") { openCourseForm(course); return; }
  if (action === "archive") {
    if (!confirm(`確定將「${course.name}｜${course.period_label}」封存嗎？歷史資料會保留。`)) return;
    const { error } = await supabase.from("courses").update({ status: "archived" }).eq("id", id);
    if (error) notify(`封存失敗：${error.message}`, true); else { notify("課程已封存，歷史資料已保留。"); if (selectedCourse?.id === id) { selectedCourse = { ...course, status: "archived" }; } await loadCourses(); }
  }
}
function openCourseForm(course = null) {
  $("#course-dialog-title").textContent = course ? "編輯課程" : "新增課程";
  $("#course-id").value = course?.id || ""; $("#course-name").value = course?.name || "";
  $("#course-period").value = course?.period_label || ""; $("#course-total").value = course?.total_sessions ?? 12;
  $("#course-status").value = course?.status || "active"; $("#course-error").textContent = ""; showDialog("course-dialog");
}
$("#new-course").addEventListener("click", () => openCourseForm());
$("#course-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("#course-id").value;
  const payload = { name: $("#course-name").value.trim(), period_label: $("#course-period").value.trim(), total_sessions: Number($("#course-total").value), status: $("#course-status").value };
  const result = id ? await supabase.from("courses").update(payload).eq("id", id) : await supabase.from("courses").insert(payload);
  if (result.error) { $("#course-error").textContent = result.error.message; return; }
  closeDialog("course-dialog"); notify(id ? "課程資料已更新。" : "課程已新增。"); await loadCourses();
  if (selectedCourse?.id === id) { selectedCourse = courses.find(c => c.id === id) || selectedCourse; updateDetailHeading(); }
});

async function renumberSessionsByDate() {
  const { error } = await supabase.rpc("renumber_course_sessions_by_date", {
    p_course_id: selectedCourse.id
  });
  if (error) throw error;
}

async function loadSessions() {
  if (!selectedCourse) return;
  updateDetailHeading(); $("#course-detail").hidden = false; $("#session-list").innerHTML = '<p class="muted">載入堂次中…</p>';
  const { data, error } = await supabase.from("course_sessions").select("id,session_no,class_date,start_time,end_time,duration_hours,duty_user_id,equipment_rental_count").eq("course_id", selectedCourse.id).order("session_no");
  if (error) { $("#session-list").innerHTML = `<p class="form-error">讀取堂次失敗：${esc(error.message)}</p>`; return; }
  const dutyMap = Object.fromEntries(dutyProfiles.map(p => [p.id, p.display_name || "未命名人員"]));
  if (!data?.length) { $("#session-list").innerHTML = '<div class="empty-state compact">尚未建立堂次，請新增或批次建立。</div>'; return; }
  $("#session-list").innerHTML = data.map(s => `<div class="session-row"><div class="session-no">第 ${s.session_no} 堂</div><div class="session-info"><strong>${esc(s.class_date)}</strong><span>${esc(String(s.start_time).slice(0,5))}–${esc(String(s.end_time).slice(0,5))}・${Number(s.duration_hours).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} 小時</span><small>值班：${esc(s.duty_user_id ? dutyMap[s.duty_user_id] || "未指定" : "未指定")}</small></div><div class="session-actions"><button class="button-secondary" data-edit-session="${s.id}">編輯</button><button class="text-button danger-text" data-delete-session="${s.id}">刪除</button></div></div>`).join("");
  $("#session-list").querySelectorAll("[data-edit-session]").forEach(b => b.addEventListener("click", () => openSessionForm(data.find(s => s.id === b.dataset.editSession))));
  $("#session-list").querySelectorAll("[data-delete-session]").forEach(b => b.addEventListener("click", () => deleteSession(data.find(s => s.id === b.dataset.deleteSession))));
}

async function deleteSession(session) {
  if (!session) return;
  // Protect attendance and makeup history from accidental cascade/restrict deletion.
  const [{ count: attendanceCount, error: attendanceError }, { count: makeupCount, error: makeupError }] = await Promise.all([
    supabase.from("attendance").select("id", { count: "exact", head: true }).eq("session_id", session.id),
    supabase.from("makeup_records").select("id", { count: "exact", head: true }).eq("original_session_id", session.id)
  ]);
  if (attendanceError || makeupError) {
    notify(`無法確認堂次是否有相關紀錄：${attendanceError?.message || makeupError?.message}`, true);
    return;
  }
  if ((attendanceCount || 0) > 0 || (makeupCount || 0) > 0) {
    notify(`第 ${session.session_no} 堂已有點名或補課關聯紀錄，為保留歷史資料，不能直接刪除。你仍可使用「編輯」修正日期或時間。`, true);
    return;
  }
  if (!confirm(`確定刪除第 ${session.session_no} 堂（${session.class_date}）嗎？此操作無法復原。`)) return;
  const { error } = await supabase.from("course_sessions").delete().eq("id", session.id).eq("course_id", selectedCourse.id);
  if (error) {
    notify(`刪除失敗：${error.message}`, true);
    return;
  }
  try { await renumberSessionsByDate(); }
  catch (error) { notify(`堂次已刪除，但自動排序失敗：${error.message}`, true); await loadSessions(); return; }
  notify(`堂次已刪除，剩餘堂次已依日期重新排序。`);
  await loadSessions();
}
function updateDetailHeading() { $("#selected-course-title").textContent = selectedCourse.name; $("#selected-course-meta").textContent = `${selectedCourse.period_label}｜預計 ${selectedCourse.total_sessions} 堂｜${selectedCourse.status === "active" ? "進行中" : "已封存"}`; }
$("#close-detail").addEventListener("click", () => { $("#course-detail").hidden = true; selectedCourse = null; });
function openSessionForm(session = null) {
  $("#session-dialog-title").textContent = session ? "編輯堂次" : "新增堂次";
  $("#session-id").value = session?.id || "";
  $("#session-no").value = session?.session_no || ""; $("#session-date").value = session?.class_date || "";
  $("#session-start").value = session?.start_time?.slice(0,5) || "19:00"; $("#session-end").value = session?.end_time?.slice(0,5) || "21:00";
  $("#session-duty").value = session?.duty_user_id || ""; $("#session-error").textContent = ""; showDialog("session-dialog");
}
$("#new-session").addEventListener("click", async () => {
  const { data, error } = await supabase.from("course_sessions").select("session_no").eq("course_id", selectedCourse.id).order("session_no", { ascending: false }).limit(1);
  if (error) { notify(error.message, true); return; }
  openSessionForm({ session_no: (data?.[0]?.session_no || 0) + 1 });
});
$("#session-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("#session-id").value;
  const start = $("#session-start").value; const end = $("#session-end").value;
  const hours = duration(start, end); if (!hours || hours > 12) { $("#session-error").textContent = "請確認開始與結束時間，單堂時數需在 12 小時內。"; return; }
  const payload = { class_date: $("#session-date").value, start_time: start, end_time: end, duration_hours: hours, duty_user_id: $("#session-duty").value || null };
  let result;
  if (id) {
    result = await supabase.from("course_sessions").update(payload).eq("id", id).eq("course_id", selectedCourse.id);
  } else {
    const { data: latest, error: latestError } = await supabase.from("course_sessions").select("session_no").eq("course_id", selectedCourse.id).order("session_no", { ascending: false }).limit(1);
    if (latestError) { $("#session-error").textContent = latestError.message; return; }
    result = await supabase.from("course_sessions").insert({ ...payload, course_id: selectedCourse.id, session_no: (latest?.[0]?.session_no || 0) + 1, equipment_rental_count: 0 });
  }
  if (result.error) { $("#session-error").textContent = result.error.message; return; }
  try { await renumberSessionsByDate(); }
  catch (error) { $("#session-error").textContent = `堂次已儲存，但自動排序失敗：${error.message}。請稍後重新整理或聯絡管理者。`; return; }
  closeDialog("session-dialog"); notify(id ? "堂次已更新，編號已依日期自動排序。" : "堂次已新增，編號已依日期自動排序。"); await loadSessions();
});

$("#batch-sessions").addEventListener("click", () => { $("#batch-error").textContent = ""; $("#batch-start-date").value = localDate(new Date()); $("#batch-count").value = selectedCourse.total_sessions; showDialog("batch-dialog"); });
$("#batch-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const start = $("#batch-start").value; const end = $("#batch-end").value; const hours = duration(start, end);
  if (!hours || hours > 12) { $("#batch-error").textContent = "請確認時間，單堂時數需在 12 小時內。"; return; }
  const count = Number($("#batch-count").value); const interval = Number($("#batch-interval").value);
  const { data: existing, error: readError } = await supabase.from("course_sessions").select("session_no").eq("course_id", selectedCourse.id).order("session_no", { ascending: false }).limit(1);
  if (readError) { $("#batch-error").textContent = readError.message; return; }
  const firstNo = (existing?.[0]?.session_no || 0) + 1; const firstDate = new Date(`${$("#batch-start-date").value}T12:00:00`);
  const rows = Array.from({ length: count }, (_, i) => { const date = new Date(firstDate); date.setDate(date.getDate() + i * interval); return { course_id: selectedCourse.id, session_no: firstNo + i, class_date: localDate(date), start_time: start, end_time: end, duration_hours: hours, duty_user_id: $("#batch-duty").value || null, equipment_rental_count: 0 }; });
  const { error } = await supabase.from("course_sessions").insert(rows);
  if (error) { $("#batch-error").textContent = error.message; return; }
  try { await renumberSessionsByDate(); }
  catch (sortError) { $("#batch-error").textContent = `堂次已建立，但自動排序失敗：${sortError.message}`; return; }
  closeDialog("batch-dialog"); notify(`已批次建立 ${count} 堂課程，編號已依日期自動排序。`); await loadSessions();
});


// Admin module navigation
function switchModule(name) {
  const isStudents = name === "students";
  $("#courses-module").hidden = isStudents;
  $("#students-module").hidden = !isStudents;
  document.querySelectorAll("[data-module]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.module === name);
  });
  if (isStudents) loadStudents();
}
document.querySelectorAll("[data-module]").forEach(button => {
  button.addEventListener("click", () => switchModule(button.dataset.module));
});

async function loadStudents() {
  $("#student-list").innerHTML = '<div class="empty-state">載入學員資料中…</div>';
  const { data, error } = await supabase
    .from("students")
    .select("id,name,phone,notes,is_active,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    $("#student-list").innerHTML = `<div class="empty-state">讀取學員失敗：${esc(error.message)}</div>`;
    notify(`讀取學員失敗：${error.message}`, true);
    return;
  }
  students = data || [];
  renderStudents();
}

function renderStudents() {
  const query = $("#student-search").value.trim().toLowerCase();
  const status = $("#student-status-filter").value;
  const filtered = students.filter(student => {
    const matchesStatus = status === "all" || (status === "active" ? student.is_active : !student.is_active);
    const haystack = `${student.name || ""} ${student.phone || ""}`.toLowerCase();
    return matchesStatus && haystack.includes(query);
  });
  $("#student-count").textContent = `共 ${filtered.length} 位學員`;
  if (!filtered.length) {
    $("#student-list").innerHTML = '<div class="empty-state"><strong>沒有符合條件的學員</strong><p>可以調整搜尋文字或狀態篩選。</p></div>';
    return;
  }
  $("#student-list").innerHTML = filtered.map(student => `
    <article class="student-card ${student.is_active ? "" : "is-inactive"}">
      <div class="student-card-main">
        <div class="student-name-line"><h3>${esc(student.name)}</h3><span class="status-pill ${student.is_active ? "active" : "archived"}">${student.is_active ? "啟用中" : "已停用"}</span></div>
        <p class="student-phone">${student.phone ? esc(student.phone) : "尚未填寫電話"}</p>
        ${student.notes ? `<p class="student-notes">${esc(student.notes)}</p>` : ""}
      </div>
      <div class="student-actions">
        <button type="button" class="button-secondary" data-edit-student="${student.id}">編輯</button>
        <button type="button" class="text-button ${student.is_active ? "danger-text" : ""}" data-toggle-student="${student.id}">${student.is_active ? "停用" : "重新啟用"}</button>
      </div>
    </article>`).join("");
  $("#student-list").querySelectorAll("[data-edit-student]").forEach(button => {
    button.addEventListener("click", () => openStudentForm(students.find(s => s.id === button.dataset.editStudent)));
  });
  $("#student-list").querySelectorAll("[data-toggle-student]").forEach(button => {
    button.addEventListener("click", () => toggleStudent(students.find(s => s.id === button.dataset.toggleStudent)));
  });
}

$("#student-search").addEventListener("input", renderStudents);
$("#student-status-filter").addEventListener("change", renderStudents);
$("#new-student").addEventListener("click", () => openStudentForm());

function openStudentForm(student = null) {
  $("#student-dialog-title").textContent = student ? "編輯學員資料" : "新增學員";
  $("#student-id").value = student?.id || "";
  $("#student-name").value = student?.name || "";
  $("#student-phone").value = student?.phone || "";
  $("#student-notes").value = student?.notes || "";
  $("#student-error").textContent = "";
  showDialog("student-dialog");
}

$("#student-form").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("#student-id").value;
  const name = $("#student-name").value.trim();
  if (!name) { $("#student-error").textContent = "請填寫學員姓名。"; return; }
  const payload = {
    name,
    phone: $("#student-phone").value.trim() || null,
    notes: $("#student-notes").value.trim() || null
  };
  const result = id
    ? await supabase.from("students").update(payload).eq("id", id)
    : await supabase.from("students").insert({ ...payload, is_active: true });
  if (result.error) {
    $("#student-error").textContent = `儲存失敗：${result.error.message}`;
    return;
  }
  closeDialog("student-dialog");
  notify(id ? "學員資料已更新。" : "學員已新增。");
  await loadStudents();
});

async function toggleStudent(student) {
  if (!student) return;
  const nextActive = !student.is_active;
  const action = nextActive ? "重新啟用" : "停用";
  const explanation = nextActive
    ? `確定重新啟用「${student.name}」嗎？`
    : `確定停用「${student.name}」嗎？既有報名、點名與時數紀錄會保留。`;
  if (!confirm(explanation)) return;
  const { error } = await supabase.from("students").update({ is_active: nextActive }).eq("id", student.id);
  if (error) { notify(`${action}失敗：${error.message}`, true); return; }
  notify(`已${action}學員「${student.name}」。`);
  await loadStudents();
}

$("#logout").addEventListener("click", async () => { await supabase.auth.signOut(); location.replace("./index.html"); });
await init();
