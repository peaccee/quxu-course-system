import { supabase } from "./supabase.js";
const $ = s => document.querySelector(s);
const courseSelect=$("#course-select"), sessionSelect=$("#session-select"), roster=$("#roster"), message=$("#message");
const makeupStudent=$("#makeup-student"), makeupDate=$("#makeup-date"), makeupHours=$("#makeup-hours"), makeupNotes=$("#makeup-notes"), saveMakeup=$("#save-makeup"), makeupMessage=$("#makeup-message");
let sessions=[];
const {data:{user},error:authError}=await supabase.auth.getUser();
if(authError||!user) location.replace("./index.html");
const {data:profile,error:profileError}=await supabase.from("profiles").select("role").eq("id",user.id).single();
if(profileError||!["admin","staff"].includes(profile?.role)){await supabase.auth.signOut();location.replace("./index.html");}
$("#logout").addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("./index.html");});
async function loadCourses(){
 const {data,error}=await supabase.rpc("get_checkin_courses");
 if(error){message.textContent=`讀取課程失敗：${error.message}`;return;}
 courseSelect.innerHTML='<option value="">請選擇課程</option>';
 for(const c of data||[]){const o=document.createElement("option");o.value=c.id;o.textContent=[c.name,c.period_label].filter(Boolean).join("｜");courseSelect.append(o);}
}
async function loadMakeupStudents(courseId){
 makeupStudent.disabled=true;makeupStudent.innerHTML='<option value="">載入學員中…</option>';
 const {data,error}=await supabase.rpc("get_checkin_makeup_students",{p_course_id:courseId});
 if(error){makeupStudent.innerHTML='<option value="">無法載入學員</option>';makeupMessage.textContent=`讀取補課名單失敗：${error.message}`;return;}
 makeupStudent.innerHTML='<option value="">請選擇學員</option>';
 for(const s of data||[]){const o=document.createElement("option");o.value=s.enrollment_id;o.textContent=s.student_name;makeupStudent.append(o);}
 makeupStudent.disabled=!(data?.length);
}
async function loadSessions(courseId){
 sessionSelect.disabled=true;sessionSelect.innerHTML='<option value="">載入日期中…</option>';roster.innerHTML='<p class="muted">請選擇上課日期。</p>';
 makeupStudent.innerHTML='<option value="">載入學員中…</option>';makeupStudent.disabled=true;makeupDate.value="";saveMakeup.disabled=true;
 const {data,error}=await supabase.rpc("get_checkin_sessions",{p_course_id:courseId});
 if(error){message.textContent=`讀取日期失敗：${error.message}`;return;}
 sessions=data||[];sessionSelect.innerHTML='<option value="">請選擇日期</option>';
 for(const s of sessions){const o=document.createElement("option");o.value=s.id;o.textContent=`第 ${s.session_no} 堂｜${s.class_date}`;sessionSelect.append(o);}
 sessionSelect.disabled=false;await loadMakeupStudents(courseId);
}
async function loadRoster(sessionId){
 roster.innerHTML='<p class="muted">名單載入中…</p>';message.textContent="";
 const session=sessions.find(s=>s.id===sessionId);makeupDate.value=session?.class_date||"";
 saveMakeup.disabled=!(makeupStudent.value&&session);
 const {data,error}=await supabase.rpc("get_checkin_roster",{p_session_id:sessionId});
 if(error){roster.innerHTML="";message.textContent=`讀取名單失敗：${error.message}`;return;}
 if(!data?.length){roster.innerHTML='<p class="muted">目前沒有這堂課的在籍學員。</p>';return;}
 roster.innerHTML="";
 for(const s of data){
  const row=document.createElement("div");row.className="student-row";
  const name=document.createElement("strong");name.textContent=s.student_name;
  const status=document.createElement("select");status.innerHTML='<option value="unmarked">尚未點名</option><option value="present">已到</option><option value="leave">請假</option>';status.value=s.attendance_status;status.setAttribute("aria-label",`${s.student_name} 出席狀態`);
  status.addEventListener("change",async()=>{status.disabled=true;const {error:e}=await supabase.rpc("set_attendance_status",{p_session_id:sessionId,p_enrollment_id:s.enrollment_id,p_status:status.value});status.disabled=false;message.textContent=e?`儲存失敗：${e.message}`:`${s.student_name}：已儲存`;});
  row.append(name,status);roster.append(row);
 }
}
courseSelect.addEventListener("change",()=>{message.textContent="";makeupMessage.textContent="";if(courseSelect.value)loadSessions(courseSelect.value);else{sessionSelect.disabled=true;sessionSelect.innerHTML='<option>請先選擇課程</option>';makeupStudent.innerHTML='<option>請先選擇班別</option>';makeupStudent.disabled=true;makeupDate.value="";saveMakeup.disabled=true;}});
sessionSelect.addEventListener("change",()=>{if(sessionSelect.value)loadRoster(sessionSelect.value);else{makeupDate.value="";saveMakeup.disabled=true;}});
makeupStudent.addEventListener("change",()=>saveMakeup.disabled=!(makeupStudent.value&&sessionSelect.value));
saveMakeup.addEventListener("click",async()=>{
 const hours=Number(makeupHours.value);
 if(!makeupStudent.value||!makeupDate.value||!Number.isFinite(hours)||hours<=0||hours>12){makeupMessage.textContent="請確認學員、補課日期與實際補課時數（0–12 小時）。";return;}
 saveMakeup.disabled=true;
 const {error}=await supabase.rpc("record_staff_makeup",{p_enrollment_id:makeupStudent.value,p_makeup_date:makeupDate.value,p_duration_hours:hours,p_notes:makeupNotes.value.trim()||null});
 if(error){makeupMessage.textContent=`補課登記失敗：${error.message}`;saveMakeup.disabled=false;return;}
 makeupMessage.textContent=`補課已登記，已扣除 ${hours} 小時；原本點名狀態不變。`;makeupHours.value="";makeupNotes.value="";saveMakeup.disabled=!(makeupStudent.value&&sessionSelect.value);
});
await loadCourses();
