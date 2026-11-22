export const SUPABASE_CONFIG = {
  url: "https://wzsrquzwjpjqxoeqjhkc.supabase.co",
  key: "sb_publishable_YwbG9xnz3CxXWndHbLch-w_0iY1I21x"
};

export const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239c9891' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'></path><circle cx='12' cy='7' r='4'></circle></svg>";

export const supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
