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
  const modules = ["courses","students","enrollments","staff","stats"];
  modules.forEach(m => { const el = document.getElementById(`${m}-module`); if (el) el.hidden = m !== name; });
  document.querySelectorAll("[data-module]").forEach(button => button.classList.toggle("is-active", button.dataset.module === name));
  if (name === "students") loadStudents();
  if (name === "enrollments") loadEnrollments();
  if (name === "staff") loadStaff();
  if (name === "stats") loadStats();
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

let enrollmentRows = [];
const todayISO = () => new Date().toLocaleDateString("en-CA");
const money = v => `$${Number(v||0).toLocaleString("en-US")}`;
async function loadEnrollments() {
  $("#enrollment-list").innerHTML = '<div class="empty-state">載入報名資料中…</div>';
  const [{data: es,error:e1},{data:ss,error:e2},{data:cs,error:e3}] = await Promise.all([
    supabase.from("enrollments").select("*").order("created_at",{ascending:false}),
    supabase.from("students").select("id,name,is_active"),
    supabase.from("courses").select("id,name,period_label,status")
  ]);
  if(e1||e2||e3){$("#enrollment-list").innerHTML=`<div class="empty-state">讀取失敗：${esc((e1||e2||e3).message)}</div>`;return;}
  const sm=Object.fromEntries((ss||[]).map(x=>[x.id,x])), cm=Object.fromEntries((cs||[]).map(x=>[x.id,x]));
  enrollmentRows=(es||[]).map(e=>({...e,student:sm[e.student_id],course:cm[e.course_id]}));
  renderEnrollments();
}
function renderEnrollments(){
 const q=($("#enrollment-search")?.value||"").toLowerCase(), f=$("#enrollment-filter")?.value||"all";
 const rows=enrollmentRows.filter(e=>(f==="all"|| (f==="active"?e.status==="active":e.status!=="active")) && `${e.student?.name||""} ${e.course?.name||""} ${e.course?.period_label||""}`.toLowerCase().includes(q));
 if(!rows.length){$("#enrollment-list").innerHTML='<div class="empty-state">目前沒有符合條件的報名資料。</div>';return;}
 $("#enrollment-list").innerHTML=rows.map(e=>`<article class="student-card"><div class="student-card-main"><h3>${esc(e.student?.name||"未知學員")}｜${esc(e.course?.name||"未知課程")}</h3><p class="muted">${esc(e.course?.period_label||"")}・${esc(e.status||"未設定狀態")}</p><p>已購 <b>${Number(e.total_sessions||0)}</b> 堂／${Number(e.total_hours||0)} 小時　剩餘 <b>${Number(e.remaining_sessions||0)}</b> 堂／${Number(e.remaining_hours||0)} 小時</p><p class="muted small">學費 ${money(e.tuition_amount)}・器材費 ${money(e.equipment_amount)}</p></div><div class="student-actions"><button class="button-secondary" data-edit-enrollment="${e.id}">編輯報名</button><button class="button-secondary" data-makeup-history="${e.id}">補課紀錄</button><button class="button-secondary" data-ledger="${e.id}">交易紀錄</button></div></article>`).join("");
 $("#enrollment-list").querySelectorAll("[data-edit-enrollment]").forEach(b=>b.onclick=()=>editEnrollment(b.dataset.editEnrollment));
 $("#enrollment-list").querySelectorAll("[data-makeup-history]").forEach(b=>b.onclick=()=>showMakeupHistory(b.dataset.makeupHistory));
 $("#enrollment-list").querySelectorAll("[data-ledger]").forEach(b=>b.onclick=()=>showLedger(b.dataset.ledger));
}
$("#enrollment-search")?.addEventListener("input",renderEnrollments); $("#enrollment-filter")?.addEventListener("change",renderEnrollments);
$("#new-enrollment")?.addEventListener("click",async()=>{
 const [{data:ss},{data:cs}]=await Promise.all([supabase.from("students").select("id,name").eq("is_active",true).order("name"),supabase.from("courses").select("id,name,period_label").eq("status","active").order("name")]);
 $("#enroll-student").innerHTML=(ss||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("");
 $("#enroll-course").innerHTML=(cs||[]).map(c=>`<option value="${c.id}">${esc(c.name)}｜${esc(c.period_label)}</option>`).join("");
 $("#enroll-date").value=todayISO(); $("#enroll-rental").checked=false; $("#enrollment-error").textContent="";
 if(!ss?.length||!cs?.length){notify("請先建立啟用中的學員與課程。",true);return;} showDialog("enrollment-dialog");
});
$("#enrollment-form")?.addEventListener("submit",async ev=>{
 ev.preventDefault(); const student_id=$("#enroll-student").value, course_id=$("#enroll-course").value;
 const needsRental=$("#enroll-rental").checked;
 const payload={student_id,course_id,purchased_on:$("#enroll-date").value,total_hours:0,remaining_hours:0,total_sessions:0,remaining_sessions:0,tuition_amount:0,equipment_amount:0,needs_equipment_rental:needsRental,status:"active"};
 const {data:en,error}=await supabase.from("enrollments").insert(payload).select("id").single();
 if(error){$("#enrollment-error").textContent=error.message;return;}
 const {error:purchaseError}=await supabase.rpc("add_enrollment_purchase",{p_enrollment_id:en.id,p_purchase_type:"initial",p_purchased_sessions:Number($("#enroll-sessions").value),p_purchased_hours:Number($("#enroll-hours").value),p_tuition_amount:Number($("#enroll-tuition").value||0),p_equipment_amount:needsRental?Number($("#enroll-equipment").value||0):0,p_purchased_on:$("#enroll-date").value,p_notes:$("#enroll-notes").value||null});
 if(purchaseError){await supabase.from("enrollments").delete().eq("id",en.id);$("#enrollment-error").textContent=`報名建立後，首次購買紀錄失敗：${purchaseError.message}。已嘗試回復報名資料。`;return;}
 closeDialog("enrollment-dialog");notify("報名與首次購買堂數、時數已建立。");await loadEnrollments();
});

async function editEnrollment(id){
 const e=enrollmentRows.find(x=>x.id===id); if(!e)return;
 const [{data:ss,error:se},{data:cs,error:ce}]=await Promise.all([
  supabase.from("students").select("id,name").order("name"),
  supabase.from("courses").select("id,name,period_label").order("name")
 ]);
 if(se||ce){notify(`讀取選項失敗：${(se||ce).message}`,true);return;}
 const choose=(label,items,current)=>{const list=items.map((x,i)=>`${i+1}. ${x.label}${x.id===current?"（目前）":""}`).join("\n");const answer=prompt(`${label}，輸入編號：\n${list}`,String(Math.max(1,items.findIndex(x=>x.id===current)+1)));if(answer===null)return null;const n=Number(answer);return Number.isInteger(n)&&n>=1&&n<=items.length?items[n-1].id:undefined;};
 const student=choose("選擇學員",(ss||[]).map(x=>({id:x.id,label:x.name})),e.student_id);if(student===null)return;if(!student){notify("學員編號無效。",true);return;}
 const course=choose("選擇課程期別",(cs||[]).map(x=>({id:x.id,label:`${x.name}｜${x.period_label}`})),e.course_id);if(course===null)return;if(!course){notify("課程編號無效。",true);return;}
 const ask=(label,value)=>prompt(label,value==null?"":String(value));
 const date=ask("報名日期（YYYY-MM-DD）",e.purchased_on||"");if(date===null)return;
 const totalSessions=ask("購買總堂數",e.total_sessions);if(totalSessions===null)return;
 const totalHours=ask("購買總時數（最多一位小數）",e.total_hours);if(totalHours===null)return;
 const remainingSessions=ask("剩餘堂數（可人工調整）",e.remaining_sessions);if(remainingSessions===null)return;
 const remainingHours=ask("剩餘時數（最多一位小數，可人工調整）",e.remaining_hours);if(remainingHours===null)return;
 const tuition=ask("學費",e.tuition_amount);if(tuition===null)return;
 const rental=ask("是否租借器材？輸入 y 或 n",e.needs_equipment_rental?"y":"n");if(rental===null)return;
 if(!["y","n"].includes(rental.trim().toLowerCase())){notify("器材租借請輸入 y 或 n。",true);return;}
 const equipment=ask("器材租借費",e.equipment_amount);if(equipment===null)return;
 const status=ask("報名狀態（沿用系統狀態值，例如 active）",e.status||"active");if(status===null)return;
 const reason=ask("請填寫本次修改原因（必填；若剩餘額度變動會寫入交易紀錄）","");if(reason===null)return;
 const intPattern=/^\d+$/,decimalPattern=/^\d+(?:\.\d)?$/;
 if(!intPattern.test(totalSessions)||!intPattern.test(remainingSessions)||!decimalPattern.test(totalHours)||!decimalPattern.test(remainingHours)||![tuition,equipment].every(v=>/^\d+(?:\.\d{1,2})?$/.test(v))){notify("數值格式不正確：堂數需為整數，時數最多一位小數，費用請輸入非負數。",true);return;}
 const {error}=await supabase.rpc("admin_update_enrollment",{p_enrollment_id:id,p_student_id:student,p_course_id:course,p_purchased_on:date,p_total_sessions:Number(totalSessions),p_total_hours:Number(totalHours),p_remaining_sessions:Number(remainingSessions),p_remaining_hours:Number(remainingHours),p_tuition_amount:Number(tuition),p_needs_equipment_rental:rental.trim().toLowerCase()==="y",p_equipment_amount:Number(equipment),p_status:status.trim(),p_reason:reason.trim()});
 if(error){notify(`更新失敗：${error.message}`,true);return;}
 notify("報名資料已更新；剩餘堂數／時數異動已寫入交易紀錄。");await loadEnrollments();
}

async function showMakeupHistory(id){
 const {data,error}=await supabase.from("makeup_records").select("makeup_date,duration_hours,status,created_at,notes").eq("enrollment_id",id).order("makeup_date",{ascending:false});
 if(error){notify(`讀取補課紀錄失敗：${error.message}`,true);return;}
 alert((data||[]).map(x=>`${x.makeup_date}｜${Number(x.duration_hours).toFixed(2)} 小時｜${x.status==="completed"?"已完成":x.status==="cancelled"?"已取消":"已預約"}${x.notes?"｜"+x.notes:""}`).join("\\n")||"此報名尚無補課紀錄。");
}
async function showLedger(id){
 const {data,error}=await supabase.from("enrollment_transactions").select("transaction_type,hours_delta,sessions_delta,description,created_at").eq("enrollment_id",id).order("created_at",{ascending:false});
 if(error){notify(`讀取交易紀錄失敗：${error.message}`,true);return;}
 alert((data||[]).map(x=>`${new Date(x.created_at).toLocaleString("zh-TW")}｜${x.transaction_type}｜${Number(x.sessions_delta||0)>0?"+":""}${Number(x.sessions_delta||0)} 堂｜${Number(x.hours_delta)>0?"+":""}${x.hours_delta} 小時｜${x.description||""}`).join("\\n")||"尚無交易紀錄");
}
async function loadStaff(){
 const {data,error}=await supabase.from("profiles").select("id,display_name,role,created_at").order("role").order("display_name");
 if(error){$("#staff-list").textContent=error.message;return;}
 $("#staff-list").innerHTML=(data||[]).map(p=>`<article class="student-card"><div><h3>${esc(p.display_name||"未命名")}</h3><p class="muted">${p.role}</p></div><button class="button-secondary" data-edit-profile="${p.id}">修改顯示名稱</button></article>`).join("");
 $("#staff-list").querySelectorAll("[data-edit-profile]").forEach(b=>b.onclick=async()=>{const p=data.find(x=>x.id===b.dataset.editProfile);const name=prompt("輸入顯示名稱",p.display_name||"");if(name===null)return;const {error}=await supabase.from("profiles").update({display_name:name.trim()}).eq("id",p.id);if(error)notify(error.message,true);else{notify("顯示名稱已更新。");loadStaff();}});
}
async function loadStats(){
 const tables=["students","courses","course_sessions","enrollments","attendance","enrollment_purchases","enrollment_transactions","makeup_records"];
 const counts=await Promise.all(tables.map(async t=>{const {count,error}=await supabase.from(t).select("*",{count:"exact",head:true});return {t,count:count||0,error};}));
 $("#stats-grid").innerHTML=counts.map(x=>`<article class="stat-card"><span>${x.t}</span><strong>${x.error?"—":x.count}</strong></article>`).join("");
 const {data:att,error}=await supabase.from("attendance").select("status,session_id");
 if(error){$("#attendance-stats").textContent=error.message;return;}
 const present=(att||[]).filter(x=>x.status==="present").length,leave=(att||[]).filter(x=>x.status==="leave").length;
 $("#attendance-stats").innerHTML=`<p>已點名紀錄：${att?.length||0} 筆　出席：${present} 筆　請假：${leave} 筆</p>`;
}
$("#refresh-stats")?.addEventListener("click",loadStats);

await init();
