import { supabase } from "./supabase.js";

const message = document.querySelector("#admin-message");
const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) location.replace("./index.html");

const { data: profile, error: profileError } = await supabase
  .from("profiles").select("role").eq("id", user.id).single();

if (profileError || profile?.role !== "admin") {
  await supabase.auth.signOut();
  location.replace("./index.html");
} else {
  message.textContent = `管理者已登入：${user.email}`;
}

document.querySelector("#logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("./index.html");
});
