import { supabase, DEFAULT_AVATAR } from './config.js';
import * as auth from './auth.js';
import { toast, formatShortDate } from './utils.js';

export const commentsCache = new Map();
export const likesCache = new Map();
const likesInFlight = new Set();

export function getLikeState(postId) {
  return likesCache.get(String(postId)) || { count: 0, liked: false };
}



export async function fetchPosts() {
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (postsError) throw postsError;

 const { data: profiles } = await supabase.from("profiles").select("id, display_name, tag, avatar_url, bio, region, is_verified");
  const profileMap = {};
  if (profiles) profiles.forEach(p => profileMap[p.id] = p);

  const { data: adminRows } = await supabase.from("admins").select("user_id");
  const adminIds = new Set((adminRows || []).map(a => a.user_id));

  const postIds = (posts || []).map(p => p.id);
  const commentCounts = {};
  const likeCounts = {};
  const userLikes = new Set();

  if (postIds.length > 0) {
    const { data: cRows } = await supabase.from("comments").select("post_id").in("post_id", postIds);
    if (cRows) cRows.forEach(r => { const k = String(r.post_id); commentCounts[k] = (commentCounts[k] || 0) + 1; });

    const { data: lRows } = await supabase.from("likes").select("post_id, user_id").in("post_id", postIds);
    if (lRows) lRows.forEach(r => {
      const k = String(r.post_id);
      likeCounts[k] = (likeCounts[k] || 0) + 1;
      if (auth.currentUser && r.user_id === auth.currentUser.id) userLikes.add(k);
    });
  }

  return (posts || []).map(post => {
    const k = String(post.id);
    likesCache.set(k, { count: likeCounts[k] || 0, liked: userLikes.has(k) });
    
    const authorProfile = profileMap[post.user_id] || { display_name: "Anonymous", tag: "@anon", avatar_url: null, bio: null, region: null, is_verified: false };
    
    return {
      ...post,
      author: authorProfile,
      is_owner: adminIds.has(post.user_id),
      comment_count: commentCounts[k] || 0
    };
  });
}

export async function toggleLike(postId, btnEl) {
  postId = String(postId);
  if (!auth.currentUser) return;
  if (likesInFlight.has(postId)) return;
  likesInFlight.add(postId);

  const state = likesCache.get(postId) || { count: 0, liked: false };
  const wasLiked = state.liked;
  const prevCount = state.count;
  
  state.liked = !wasLiked;
  state.count = wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1;
  likesCache.set(postId, state);
  
  if (btnEl) {
    btnEl.classList.toggle("liked", state.liked);
    btnEl.setAttribute("data-tooltip", state.liked ? "Unlike" : "Like");
    btnEl.querySelector(".like-icon").textContent = state.liked ? "♥" : "♡";
    
    const countEl = btnEl.querySelector(".like-count");
    if (countEl) {
      countEl.textContent = String(state.count);
      countEl.classList.remove("bump");
      void countEl.offsetWidth;
      countEl.classList.add("bump");
    }
    if (state.liked) {
      btnEl.classList.remove("pop");
      void btnEl.offsetWidth;
      btnEl.classList.add("pop");
    }
  }

  let error;
  if (wasLiked) {
    const res = await supabase.from("likes").delete().eq("post_id", postId).eq("user_id", auth.currentUser.id);
    error = res.error;
  } else {
    const res = await supabase.from("likes").insert({ post_id: postId, user_id: auth.currentUser.id });
    error = res.error;
  }
  likesInFlight.delete(postId);

  if (error) {
    state.liked = wasLiked; state.count = prevCount; likesCache.set(postId, state);
    if (btnEl) {
      btnEl.classList.toggle("liked", state.liked);
      btnEl.querySelector(".like-icon").textContent = state.liked ? "♥" : "♡";
      btnEl.querySelector(".like-count").textContent = String(state.count);
    }
    toast("Error updating like.", "error");
  }
}

export async function loadComments(postId, bodyEl) {
  postId = String(postId);
  bodyEl.innerHTML = `<div class="comments-loading"><div class="spinner"></div> Loading...</div>`;
  
  const { data: comments, error } = await supabase.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
  if (error) { bodyEl.innerHTML = `<div class="comments-empty">Could not load comments.</div>`; return; }
  
  const userIds = [...new Set((comments || []).map(c => c.user_id))];
  const pMap = {};
  if (userIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, display_name, tag, avatar_url, is_verified").in("id", userIds);
    (profiles || []).forEach(p => pMap[p.id] = p);
  }

  const { data: adminRows } = await supabase.from("admins").select("user_id");
  const adminIds = new Set((adminRows || []).map(a => a.user_id));
  
  const enriched = (comments || []).map(c => ({ 
    ...c, 
    author: pMap[c.user_id] || { display_name: "Anon", tag: "@anon", avatar_url: null, bio: null, region: null, is_verified: false },
    is_owner: adminIds.has(c.user_id)
  }));
  commentsCache.set(postId, { comments: enriched, loaded: true });
  return enriched;
}

export async function submitComment(postId, content) {
  postId = String(postId);
  if (!auth.currentUser) return null;
  
  if (!auth.currentProfile?.is_verified) {
    throw new Error("VERIFICATION_REQUIRED");
  }

  const { data, error } = await supabase.from("comments").insert({ post_id: postId, user_id: auth.currentUser.id, content }).select().single();
  if (error) throw error;
  
  const entry = commentsCache.get(postId) || { comments: [], loaded: true };
  entry.comments.push({ 
    ...data, 
    author: { 
      display_name: auth.currentProfile?.display_name || auth.currentProfile?.tag, 
      tag: auth.currentProfile?.tag, 
      avatar_url: auth.currentProfile?.avatar_url,
      is_verified: auth.currentProfile?.is_verified
    },
    is_owner: auth.isAdmin
  });
  commentsCache.set(postId, entry);
  return entry.comments;
}

export function clearPostsCache() {
  likesCache.clear();
}

export function clearCommentsCache(postId) {
  commentsCache.delete(String(postId));
}

export async function deleteComment(commentId, postId) {
  postId = String(postId);
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw error;

  // чистим кэш этого поста, чтобы при следующем открытии загрузилось с сервера
  commentsCache.delete(postId);

  return true;
}
