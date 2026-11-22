import { supabase } from './config.js';
import { escapeHtml, sanitizeUrl, toast } from './utils.js';

export let currentUser = null;
export let currentProfile = null;
export let isAdmin = false;

export async function refreshSession(onSuccess, onFail, onTagMissing) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session ? session.user : null;
    
    if (!currentUser) {
      if (onFail) onFail();
      return;
    }

    let { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if (!profile) {
      const { data: newProfile } = await supabase.from('profiles').insert({ id: currentUser.id }).select().single();
      profile = newProfile;
    }
    currentProfile = profile;

    const { data: adminRow } = await supabase.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
    isAdmin = !!adminRow;

    if (!currentProfile.tag || currentProfile.tag === '@anon') {
      if (onTagMissing) onTagMissing();
      return;
    }

    if (onSuccess) onSuccess();
  } catch (err) {
    console.error("Session error:", err);
    if (onFail) onFail();
  }
}

export async function handleLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  return data;
}

export async function handleSignup(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin }
  });
  if (error) throw error;
  if (data.user && data.session) currentUser = data.user;
  return data;
}

export async function handleLogout() {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  isAdmin = false;
  window.location.reload();
}

export async function submitTag(tag) {
  let cleanTag = tag.trim();
  if (!cleanTag.startsWith('@')) cleanTag = '@' + cleanTag;
  cleanTag = cleanTag.replace(/\s+/g, '');

  const { data: existing } = await supabase.from('profiles').select('id').eq('tag', cleanTag).maybeSingle();
  if (existing) throw new Error("This tag is already taken.");

  const { error } = await supabase.from('profiles').update({ tag: cleanTag, display_name: cleanTag }).eq('id', currentUser.id);
  if (error) throw error;

  currentProfile.tag = cleanTag;
  currentProfile.display_name = cleanTag;
  return cleanTag;
}

export async function updateProfile(data, avatarFile) {
  let avatarUrl = currentProfile?.avatar_url;

  if (avatarFile) {
    const fileExt = avatarFile.name.split('.').pop();
    const fileName = `${currentUser.id}_${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, avatarFile);
    if (uploadError) throw new Error("Upload error: " + uploadError.message);
    
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
    avatarUrl = publicUrl;
  }

  const { error } = await supabase.from('profiles').update({
    display_name: data.display_name || null,
    tag: data.tag,
    bio: data.bio || null,
    region: data.region || null,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString()
  }).eq('id', currentUser.id);

  if (error) {
    if (error.code === '23505') throw new Error("This tag is already taken.");
    throw error;
  }

  currentProfile.display_name = data.display_name || null;
  currentProfile.tag = data.tag;
  currentProfile.bio = data.bio || null;
  currentProfile.region = data.region || null;
  currentProfile.avatar_url = avatarUrl;

  return avatarUrl;
}
