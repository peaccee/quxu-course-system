import { supabase, isConfigured } from "./supabase.js";

const form = document.querySelector("#login-form");
const message = document.querySelector("#message");
const button = document.querySelector("#login-button");

if (!isConfigured()) {
  message.textContent = "尚未設定 Supabase URL 與 Publishable key，請先完成 js/supabase.js。";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  if (!isConfigured()) return;
  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  const email = username.toLowerCase() === "checkin"
    ? "checkin@quxu-course-system.invalid"
    : username;
  button.disabled = true;
  button.textContent = "登入中…";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    message.textContent = "登入失敗，請確認帳號與密碼。";
    button.disabled = false;
    button.textContent = "登入系統";
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profileError || !profile) {
    await supabase.auth.signOut();
    message.textContent = "無法確認帳號權限，請聯絡管理者。";
    button.disabled = false;
    button.textContent = "登入系統";
    return;
  }
  location.replace(profile.role === "admin" ? "./admin.html" : "./checkin.html");
});
