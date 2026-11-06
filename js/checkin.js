import { supabase } from "./supabase.js";

const courseSelect = document.querySelector("#course-select");
const sessionSelect = document.querySelector("#session-select");
const roster = document.querySelector("#roster");
const message = document.querySelector("#message");
const info = document.querySelector("#session-info");

const { data: { user }, error: authError } = await supabase.auth.getUser();
if (authError || !user) location.replace("./index.html");

const { data: profile, error: profileError } = await supabase
  .from("profiles").select("role").eq("id", user.id).single();

if (profileError || !["admin", "staff"].includes(profile?.role)) {
  await supabase.auth.signOut();
  location.replace("./index.html");
}

document.querySelector("#logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("./index.html");
});

async function loadCourses() {
  const { data, error } = await supabase.rpc("get_checkin_courses");
  if (error) { message.textContent = `讀取課程失敗：${error.message}`; return; }
  courseSelect.innerHTML = '<option value="">請選擇課程</option>';
  for (const course of data ?? []) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = [course.name, course.period_label].filter(Boolean).join("｜");
    courseSelect.append(option);
  }
}
async function loadSessions(courseId) {
  sessionSelect.disabled = true;
  sessionSelect.innerHTML = '<option value="">載入日期中…</option>';
  roster.innerHTML = '<p class="muted">請選擇上課日期。</p>';
  info.textContent = "";
  const { data, error } = await supabase.rpc("get_checkin_sessions", { p_course_id: courseId });
  if (error) { message.textContent = `讀取日期失敗：${error.message}`; return; }
  sessionSelect.innerHTML = '<option value="">請選擇日期</option>';
  for (const session of data ?? []) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = `第 ${session.session_no} 堂｜${session.class_date}`;
    sessionSelect.append(option);
  }
  sessionSelect.disabled = false;
}
async function loadRoster(sessionId) {
  roster.innerHTML = '<p class="muted">名單載入中…</p>';
  message.textContent = "";
  const { data, error } = await supabase.rpc("get_checkin_roster", { p_session_id: sessionId });
  if (error) { roster.innerHTML = ""; message.textContent = `讀取名單失敗：${error.message}`; return; }
  if (!data?.length) { roster.innerHTML = '<p class="muted">目前沒有這堂課的在籍學員。</p>'; return; }
  roster.innerHTML = "";
  for (const student of data) {
    const row = document.createElement("div");
    row.className = "student-row";
    const name = document.createElement("strong");
    name.textContent = student.student_name;
    const status = document.createElement("select");
    status.innerHTML = '<option value="unmarked">尚未點名</option><option value="present">已到</option><option value="leave">請假</option>';
    status.value = student.attendance_status;
    status.setAttribute("aria-label", `${student.student_name} 出席狀態`);
    status.addEventListener("change", async () => {
      status.disabled = true;
      const { error: saveError } = await supabase.rpc("set_attendance_status", {
        p_session_id: sessionId,
        p_enrollment_id: student.enrollment_id,
        p_status: status.value
      });
      status.disabled = false;
      message.textContent = saveError ? `儲存失敗：${saveError.message}` : `${student.student_name}：已儲存`;
    });
    row.append(name, status);
    roster.append(row);
  }
}
courseSelect.addEventListener("change", () => {
  message.textContent = "";
  if (courseSelect.value) loadSessions(courseSelect.value);
  else { sessionSelect.disabled = true; sessionSelect.innerHTML = '<option>請先選擇課程</option>'; }
});
sessionSelect.addEventListener("change", () => {
  if (sessionSelect.value) loadRoster(sessionSelect.value);
});
await loadCourses();
